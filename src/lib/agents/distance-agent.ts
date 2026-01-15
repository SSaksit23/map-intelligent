/**
 * Distance Calculation Agent
 * Responsible for calculating distances between geolocated entities
 * 
 * Uses OSMnx-based routing service for accurate street network distances
 * Based on: https://geoffboeing.com/2016/11/osmnx-python-street-networks/
 * 
 * Falls back to OSRM and Haversine if OSMnx service is unavailable
 */

import { BaseAgent } from "./base-agent";
import type {
  AgentContext,
  Task,
  TaskResult,
  GeolocatedEntity,
  DistanceResult,
} from "./types";

// OSMnx service configuration
const OSMNX_SERVICE_URL = process.env.OSMNX_SERVICE_URL || "http://localhost:8001";

interface OSMnxRouteResponse {
  distance_km: number;
  duration_minutes: number;
  mode: string;
  path_coordinates?: number[][];
  success: boolean;
  error?: string;
}

export class DistanceCalculationAgent extends BaseAgent {
  private osmnxAvailable: boolean | null = null;

  constructor(context: AgentContext) {
    super(
      {
        name: "DistanceCalculationAgent",
        goal: "Calculate accurate distances and travel times between all trip locations using OSMnx street networks",
        backstory: `You are a distance and route calculation expert using OSMnx, 
        a Python package for street network analysis based on OpenStreetMap data.
        You can compute accurate driving, walking, and biking routes using real
        street network topology. For flights, you use great-circle distances.`,
        verbose: true,
      },
      context
    );
  }

  /**
   * Check if OSMnx service is available
   */
  private async checkOSMnxService(): Promise<boolean> {
    if (this.osmnxAvailable !== null) {
      return this.osmnxAvailable;
    }

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);

      const response = await fetch(`${OSMNX_SERVICE_URL}/health`, {
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        this.log(`OSMnx service available (v${data.osmnx_version})`);
        this.osmnxAvailable = true;
        return true;
      }
    } catch (e) {
      this.log("OSMnx service not available, using fallback routing");
    }

    this.osmnxAvailable = false;
    return false;
  }

  /**
   * Get route from OSMnx service
   */
  private async getOSMnxRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number },
    mode: "drive" | "walk" | "bike" = "drive"
  ): Promise<{ distanceKm: number; durationMinutes: number; path?: number[][] } | null> {
    try {
      const response = await fetch(`${OSMNX_SERVICE_URL}/route`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          origin: { lat: from.lat, lng: from.lng },
          destination: { lat: to.lat, lng: to.lng },
          mode,
        }),
      });

      if (response.ok) {
        const data: OSMnxRouteResponse = await response.json();
        if (data.success) {
          return {
            distanceKm: data.distance_km,
            durationMinutes: data.duration_minutes,
            path: data.path_coordinates,
          };
        }
      }
    } catch (e) {
      this.log("OSMnx route request failed", e);
    }

    return null;
  }

  async execute(task: Task): Promise<TaskResult<DistanceResult[]>> {
    const startTime = Date.now();
    this.log("Starting distance calculation task", { taskId: task.id });

    try {
      // Get geolocated entities from previous task or shared memory
      const entities =
        this.getPreviousResult<GeolocatedEntity[]>("geolocation") ||
        this.getSharedMemory<GeolocatedEntity[]>("geolocatedEntities");

      if (!entities || entities.length === 0) {
        return this.error("No geolocated entities available for distance calculation");
      }

      // Filter entities that have valid coordinates
      const validEntities = entities.filter(
        (e) =>
          e.coordinates &&
          typeof e.coordinates.lat === "number" &&
          typeof e.coordinates.lng === "number" &&
          !isNaN(e.coordinates.lat) &&
          !isNaN(e.coordinates.lng) &&
          e.coordinates.lat !== 0 &&
          e.coordinates.lng !== 0
      );

      this.log(`Processing ${validEntities.length} entities with valid coordinates`);

      const distances: DistanceResult[] = [];

      // Group entities by day
      const entitiesByDay = this.groupByDay(validEntities);
      const days = Array.from(entitiesByDay.keys()).sort((a, b) => a - b);

      // Calculate distances within each day
      for (const day of days) {
        const dayEntities = entitiesByDay.get(day) || [];
        this.log(`Calculating distances for Day ${day} (${dayEntities.length} locations)`);

        for (let i = 0; i < dayEntities.length - 1; i++) {
          const from = dayEntities[i];
          const to = dayEntities[i + 1];

          if (!from.coordinates || !to.coordinates) continue;

          const distance = await this.calculateDistance(from, to);
          if (distance) {
            distances.push(distance);
          }
        }
      }

      // Calculate cross-day distances (last of day N to first of day N+1)
      for (let i = 0; i < days.length - 1; i++) {
        const currentDay = days[i];
        const nextDay = days[i + 1];
        const currentDayEntities = entitiesByDay.get(currentDay) || [];
        const nextDayEntities = entitiesByDay.get(nextDay) || [];

        if (currentDayEntities.length > 0 && nextDayEntities.length > 0) {
          const lastOfCurrentDay = currentDayEntities[currentDayEntities.length - 1];
          const firstOfNextDay = nextDayEntities[0];

          if (lastOfCurrentDay.coordinates && firstOfNextDay.coordinates) {
            this.log(
              `Calculating cross-day distance: Day ${currentDay} -> Day ${nextDay}`
            );
            const distance = await this.calculateDistance(lastOfCurrentDay, firstOfNextDay);
            if (distance) {
              distances.push({
                ...distance,
                from: `${distance.from} (Day ${currentDay})`,
                to: `${distance.to} (Day ${nextDay})`,
              });
            }
          }
        }
      }

      // Store results in shared memory
      this.setSharedMemory("distances", distances);

      // Calculate summary statistics
      const totalDistance = distances.reduce((sum, d) => sum + d.distanceKm, 0);
      const totalDuration = distances.reduce((sum, d) => sum + (d.durationMinutes || 0), 0);
      this.setSharedMemory("totalDistance", totalDistance);
      this.setSharedMemory("totalDuration", totalDuration);

      const executionTime = Date.now() - startTime;
      this.log(`Distance calculation complete in ${executionTime}ms`, {
        routes: distances.length,
        totalDistanceKm: Math.round(totalDistance),
        totalDurationMinutes: Math.round(totalDuration),
      });

      return this.success(distances, executionTime);
    } catch (error) {
      this.log("Distance calculation failed", error);
      return this.error(`Distance calculation failed: ${error}`);
    }
  }

  private groupByDay(entities: GeolocatedEntity[]): Map<number, GeolocatedEntity[]> {
    const map = new Map<number, GeolocatedEntity[]>();

    for (const entity of entities) {
      const day = entity.day || 1;
      if (!map.has(day)) {
        map.set(day, []);
      }
      map.get(day)!.push(entity);
    }

    // Sort entities within each day by their order
    for (const [day, dayEntities] of map) {
      dayEntities.sort((a, b) => (a.order || 0) - (b.order || 0));
      this.log(`Day ${day} entities (sorted by order):`, 
        dayEntities.map(e => ({ name: e.name.substring(0, 25), order: e.order })));
    }

    return map;
  }

  private async calculateDistance(
    from: GeolocatedEntity,
    to: GeolocatedEntity
  ): Promise<DistanceResult | null> {
    if (!from.coordinates || !to.coordinates) {
      return null;
    }

    // Determine the mode of transport
    const mode = this.determineMode(from, to);

    // For flights, use great circle distance
    if (mode === "flight") {
      const distanceKm = this.haversineDistance(from.coordinates, to.coordinates);
      const durationMinutes = this.estimateFlightDuration(distanceKm);

      return {
        from: from.name,
        to: to.name,
        distanceKm: Math.round(distanceKm * 10) / 10,
        durationMinutes: Math.round(durationMinutes),
        mode: "flight",
      };
    }

    // For trains, use approximate rail distance (1.3x straight line)
    if (mode === "train") {
      const straightLineKm = this.haversineDistance(from.coordinates, to.coordinates);
      const railDistanceKm = straightLineKm * 1.3; // Approximate rail route factor
      const durationMinutes = this.estimateTrainDuration(railDistanceKm, from, to);

      return {
        from: from.name,
        to: to.name,
        distanceKm: Math.round(railDistanceKm * 10) / 10,
        durationMinutes: Math.round(durationMinutes),
        mode: "train",
      };
    }

    // For driving/walking, try OSMnx service first (most accurate)
    const osmnxAvailable = await this.checkOSMnxService();
    if (osmnxAvailable) {
      const osmnxResult = await this.getOSMnxRoute(from.coordinates, to.coordinates, "drive");
      if (osmnxResult) {
        this.log(`OSMnx route: ${from.name} → ${to.name}: ${osmnxResult.distanceKm}km`);
        return {
          from: from.name,
          to: to.name,
          distanceKm: Math.round(osmnxResult.distanceKm * 10) / 10,
          durationMinutes: Math.round(osmnxResult.durationMinutes),
          mode: "driving",
        };
      }
    }

    // Fallback to OSRM
    const osrmResult = await this.getOSRMRoute(from.coordinates, to.coordinates);
    if (osrmResult) {
      return {
        from: from.name,
        to: to.name,
        distanceKm: Math.round(osrmResult.distanceKm * 10) / 10,
        durationMinutes: Math.round(osrmResult.durationMinutes),
        mode: "driving",
      };
    }

    // Final fallback: straight-line distance with driving factor
    const straightLineKm = this.haversineDistance(from.coordinates, to.coordinates);
    const drivingDistanceKm = straightLineKm * 1.4; // Approximate driving factor
    const drivingDurationMinutes = (drivingDistanceKm / 50) * 60; // Assume 50 km/h average

    this.log(`Fallback calculation: ${from.name} → ${to.name}: ${drivingDistanceKm.toFixed(1)}km`);

    return {
      from: from.name,
      to: to.name,
      distanceKm: Math.round(drivingDistanceKm * 10) / 10,
      durationMinutes: Math.round(drivingDurationMinutes),
      mode: "driving",
    };
  }

  private determineMode(from: GeolocatedEntity, to: GeolocatedEntity): DistanceResult["mode"] {
    // Both airports = flight
    if (from.type === "airport" && to.type === "airport") {
      return "flight";
    }

    // Both stations = train
    if (from.type === "station" && to.type === "station") {
      return "train";
    }

    // Check metadata for flight/train info
    const fromMeta = from.metadata as Record<string, unknown> | undefined;
    const toMeta = to.metadata as Record<string, unknown> | undefined;

    if (fromMeta?.flightNumber || toMeta?.flightNumber) {
      return "flight";
    }

    if (fromMeta?.trainNumber || toMeta?.trainNumber) {
      return "train";
    }

    // Check distance - flights typically for > 500km
    if (from.coordinates && to.coordinates) {
      const distance = this.haversineDistance(from.coordinates, to.coordinates);
      if (distance > 500) {
        // Could be flight, but default to driving for safety
        return "driving";
      }
    }

    return "driving";
  }

  /**
   * Calculate great circle distance using Haversine formula
   */
  private haversineDistance(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): number {
    const R = 6371; // Earth's radius in km

    const lat1 = (from.lat * Math.PI) / 180;
    const lat2 = (to.lat * Math.PI) / 180;
    const deltaLat = ((to.lat - from.lat) * Math.PI) / 180;
    const deltaLng = ((to.lng - from.lng) * Math.PI) / 180;

    const a =
      Math.sin(deltaLat / 2) * Math.sin(deltaLat / 2) +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(deltaLng / 2) * Math.sin(deltaLng / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  /**
   * Estimate flight duration based on distance
   */
  private estimateFlightDuration(distanceKm: number): number {
    // Average commercial flight speed: 800 km/h
    // Add 30 minutes for takeoff/landing
    const flightHours = distanceKm / 800;
    return flightHours * 60 + 30;
  }

  /**
   * Estimate train duration based on distance and type
   */
  private estimateTrainDuration(
    distanceKm: number,
    from: GeolocatedEntity,
    to: GeolocatedEntity
  ): number {
    // Determine train type from metadata
    const metadata = (from.metadata || to.metadata) as Record<string, unknown> | undefined;
    const trainNumber = metadata?.trainNumber as string | undefined;

    // High-speed trains (G/C prefix): ~300 km/h average
    // Normal high-speed (D prefix): ~200 km/h average
    // Regular trains: ~100 km/h average
    let avgSpeed = 100;

    if (trainNumber) {
      if (trainNumber.startsWith("G") || trainNumber.startsWith("C")) {
        avgSpeed = 300;
      } else if (trainNumber.startsWith("D")) {
        avgSpeed = 200;
      }
    }

    return (distanceKm / avgSpeed) * 60;
  }

  /**
   * Get driving route from OSRM
   */
  private async getOSRMRoute(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): Promise<{ distanceKm: number; durationMinutes: number } | null> {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);

      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=false`,
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      if (response.ok) {
        const data = await response.json();
        if (data.routes && data.routes.length > 0) {
          return {
            distanceKm: data.routes[0].distance / 1000,
            durationMinutes: data.routes[0].duration / 60,
          };
        }
      }
    } catch (e) {
      this.log("OSRM route fetch failed", e);
    }

    return null;
  }
}
