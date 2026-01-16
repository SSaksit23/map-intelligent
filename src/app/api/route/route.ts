/**
 * Routing API Proxy
 * Tries routing services in order:
 * 1. OpenRouteService (if API key configured) - Most reliable
 * 2. Local OSMnx service (if running in Docker)
 * 3. Public OSRM API (fallback)
 * 4. Haversine calculation (last resort)
 */

import { NextResponse } from "next/server";

interface RouteRequest {
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  mode?: "drive" | "walk" | "bike";
}

export async function POST(request: Request) {
  try {
    const body: RouteRequest = await request.json();

    // Validate request
    if (!body.origin || !body.destination) {
      return NextResponse.json(
        { error: "Missing origin or destination" },
        { status: 400 }
      );
    }

    const { origin, destination, mode = "drive" } = body;

    // 1. Try OpenRouteService first (most reliable, requires API key)
    const orsApiKey = process.env.OPENROUTESERVICE_API_KEY;
    if (orsApiKey && orsApiKey !== "your_openrouteservice_api_key_here") {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000);

        // Map mode to ORS profile
        const orsProfile = mode === "walk" ? "foot-walking" : mode === "bike" ? "cycling-regular" : "driving-car";
        
        console.log(`[Route API] Calling OpenRouteService (${orsProfile})`);
        
        const orsResponse = await fetch(
          `https://api.openrouteservice.org/v2/directions/${orsProfile}?api_key=${orsApiKey}&start=${origin.lng},${origin.lat}&end=${destination.lng},${destination.lat}`,
          { signal: controller.signal }
        );

        clearTimeout(timeoutId);

        if (orsResponse.ok) {
          const orsData = await orsResponse.json();
          
          if (orsData.features?.[0]?.properties?.segments?.[0]) {
            const segment = orsData.features[0].properties.segments[0];
            const coordinates = orsData.features[0].geometry.coordinates;
            
            console.log(`[Route API] ✓ OpenRouteService success: ${(segment.distance / 1000).toFixed(1)} km, ${(segment.duration / 60).toFixed(0)} min`);
            
            return NextResponse.json({
              distance_km: segment.distance / 1000,
              duration_minutes: segment.duration / 60,
              mode,
              path_coordinates: coordinates,
              success: true,
              source: "openrouteservice",
            });
          }
        } else {
          const errorText = await orsResponse.text();
          console.warn(`[Route API] OpenRouteService error ${orsResponse.status}:`, errorText);
        }
      } catch (orsError) {
        console.log("[Route API] OpenRouteService error:", orsError instanceof Error ? orsError.message : "Unknown error");
      }
    }

    // 2. Try local OSMnx routing service (Docker environment) - short timeout
    const osmnxServiceUrl = process.env.OSMNX_SERVICE_URL || "http://routing-service:8001";
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout (fast fail)

      console.log(`[Route API] Trying local OSMnx service...`);
      
      const localResponse = await fetch(`${osmnxServiceUrl}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { lat: origin.lat, lng: origin.lng },
          destination: { lat: destination.lat, lng: destination.lng },
          mode,
        }),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (localResponse.ok) {
        const data = await localResponse.json();
        console.log(`[Route API] ✓ OSMnx success: ${data.distance_km} km, ${data.duration_minutes} min`);
        return NextResponse.json({ ...data, source: "osmnx" });
      } else {
        console.warn(`[Route API] OSMnx error: ${localResponse.status}`);
      }
    } catch (localError) {
      console.log("[Route API] OSMnx skipped (not ready)");
    }

    // 3. Fall back to public OSRM API
    console.log("[Route API] Trying OSRM API");
    
    try {
      const osrmUrl = `https://router.project-osrm.org/route/v1/driving/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson`;
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 30000);

      const osrmResponse = await fetch(osrmUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (osrmResponse.ok) {
        const osrmData = await osrmResponse.json();
        
        if (osrmData.routes?.[0]) {
          const route = osrmData.routes[0];
          console.log(`[Route API] ✓ OSRM success: ${(route.distance / 1000).toFixed(1)} km, ${(route.duration / 60).toFixed(0)} min`);
          
          return NextResponse.json({
            distance_km: route.distance / 1000,
            duration_minutes: route.duration / 60,
            mode,
            path_coordinates: route.geometry.coordinates,
            success: true,
            source: "osrm",
          });
        }
      }
    } catch (osrmError) {
      console.warn("[Route API] OSRM API error:", osrmError);
    }

    // 4. Calculate Haversine distance as final fallback
    const R = 6371; // Earth's radius in km
    const lat1 = (origin.lat * Math.PI) / 180;
    const lat2 = (destination.lat * Math.PI) / 180;
    const dLat = ((destination.lat - origin.lat) * Math.PI) / 180;
    const dLng = ((destination.lng - origin.lng) * Math.PI) / 180;

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    const directDistance = R * c;

    // Apply road factor (roads are ~1.4x direct distance on average)
    const roadDistance = directDistance * 1.4;
    const avgSpeed = mode === "walk" ? 5 : mode === "bike" ? 15 : 60; // km/h
    const duration = (roadDistance / avgSpeed) * 60; // minutes

    console.log(`[Route API] ⚠ Using Haversine fallback: ${roadDistance.toFixed(2)} km (straight line on map)`);
    console.log(`[Route API] 💡 For road-based routes, get a FREE API key from https://openrouteservice.org/dev/#/signup`);

    return NextResponse.json({
      distance_km: roadDistance,
      duration_minutes: duration,
      mode,
      path_coordinates: [
        [origin.lng, origin.lat],
        [destination.lng, destination.lat],
      ],
      success: true,
      source: "haversine",
      note: "Straight line - for road routes, add OPENROUTESERVICE_API_KEY to .env.local",
    });
  } catch (error) {
    console.error("[Route API] Error:", error);
    return NextResponse.json(
      { error: "Failed to calculate route", details: String(error) },
      { status: 500 }
    );
  }
}
