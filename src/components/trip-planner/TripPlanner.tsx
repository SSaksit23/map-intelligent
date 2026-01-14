"use client";

import { useState, useCallback } from "react";
import { Plane, Sparkles, X, PanelLeftClose, PanelLeft, Maximize2, Minimize2, Upload, Download, PlaneTakeoff, Train } from "lucide-react";
import { LocationSearch } from "./LocationSearch";
import { TripStopsList } from "./TripStopsList";
import { TripMap } from "./TripMap";
import { DocumentUpload } from "./DocumentUpload";
import { ExportItinerary } from "./ExportItinerary";
import { FlightInput } from "./FlightInput";
import { TrainInput } from "./TrainInput";
import { Button } from "@/components/ui/button";
import type { TripLocation, RouteInfo, GeminiResponse, GeocodeResult, FlightInfo, TrainInfo } from "@/types/trip";
import { calculateDistance } from "@/lib/utils";

function generateId(): string {
  return Math.random().toString(36).substring(2, 9);
}

export function TripPlanner() {
  const [locations, setLocations] = useState<TripLocation[]>([]);
  const [routes, setRoutes] = useState<RouteInfo[]>([]);
  const [selectedLocationId, setSelectedLocationId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [aiMessage, setAiMessage] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [days, setDays] = useState<number[]>([1]);
  const [visibleDays, setVisibleDays] = useState<Set<number>>(new Set([1]));
  const [visibleTypes, setVisibleTypes] = useState<Set<string>>(new Set(["attraction", "restaurant", "hotel", "landmark", "city", "airport", "station", "custom"]));
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [showFlightModal, setShowFlightModal] = useState(false);
  const [showTrainModal, setShowTrainModal] = useState(false);
  const [flights, setFlights] = useState<FlightInfo[]>([]);
  const [trains, setTrains] = useState<TrainInfo[]>([]);
  const [editingFlight, setEditingFlight] = useState<FlightInfo | null>(null);

  // Fetch route between two points using OSRM
  const fetchRoute = useCallback(async (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): Promise<RouteInfo | null> => {
    // Validate coordinates
    if (!from.lat || !from.lng || !to.lat || !to.lng ||
        from.lat === 0 || from.lng === 0 || to.lat === 0 || to.lng === 0 ||
        isNaN(from.lat) || isNaN(from.lng) || isNaN(to.lat) || isNaN(to.lng)) {
      console.warn("Invalid coordinates for route:", { from, to });
      // Return a direct line as fallback
      return {
        coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
        duration: 0,
        distance: 0,
      };
    }

    try {
      // Add timeout to prevent hanging
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`,
        { signal: controller.signal }
      );
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        console.warn("OSRM API error:", response.status);
        // Return direct line as fallback
        return {
          coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
          duration: 0,
          distance: 0,
        };
      }
      
      const data = await response.json();
      
      if (data.routes?.[0]) {
        return {
          coordinates: data.routes[0].geometry.coordinates,
          duration: data.routes[0].duration,
          distance: data.routes[0].distance,
        };
      }
      
      // Return direct line as fallback if no route found
      return {
        coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
        duration: 0,
        distance: 0,
      };
    } catch (error) {
      // Handle network errors gracefully - return direct line
      if (error instanceof Error && error.name === 'AbortError') {
        console.warn("Route fetch timeout");
      } else {
        console.warn("Route fetch error (using direct line):", error);
      }
      return {
        coordinates: [[from.lng, from.lat], [to.lng, to.lat]],
        duration: 0,
        distance: 0,
      };
    }
  }, []);

  // Calculate routes for all locations (preserving flight routes)
  // Max distance for land routes (1000 km) - beyond this, locations should be connected by flight
  const MAX_LAND_ROUTE_DISTANCE = 1000000; // meters (1000 km)
  
  const calculateRoutes = useCallback(async (locs: TripLocation[], currentFlights?: FlightInfo[]) => {
    // Use provided flights or get from state
    const flightsList = currentFlights || flights;
    
    // Build a set of location IDs that are flight-related (departure/arrival airports)
    const flightLocationIds = new Set<string>();
    flightsList.forEach(f => {
      flightLocationIds.add(`${f.id}-dep`);
      flightLocationIds.add(`${f.id}-arr`);
    });
    
    // Build a set of location pairs to skip (flight-connected pairs)
    const skipPairs = new Set<string>();
    
    for (let i = 0; i < locs.length - 1; i++) {
      const loc = locs[i];
      const nextLoc = locs[i + 1];
      
      // Skip if both are flight-related locations (airports from flights)
      if (flightLocationIds.has(loc.id) && flightLocationIds.has(nextLoc.id)) {
        skipPairs.add(`${i}-${i + 1}`);
        continue;
      }
      
      // Skip if both locations are airports
      if (loc.type === 'airport' && nextLoc.type === 'airport') {
        skipPairs.add(`${i}-${i + 1}`);
        continue;
      }
      
      // Skip if these are consecutive airports that are part of the same flight
      const locIsFlightDep = loc.id.includes('-dep') && loc.id.startsWith('flight-');
      const nextLocIsFlightArr = nextLoc.id.includes('-arr') && nextLoc.id.startsWith('flight-');
      
      if (locIsFlightDep && nextLocIsFlightArr) {
        skipPairs.add(`${i}-${i + 1}`);
        continue;
      }
      
      // Skip if either location is an airport (arrival/departure)
      // This prevents land routes connecting to/from airports
      if (loc.type === 'airport' || nextLoc.type === 'airport') {
        skipPairs.add(`${i}-${i + 1}`);
        continue;
      }
      
      // Skip if locations are too far apart for land travel (> 1000 km)
      // These should be connected by flights instead
      const distance = calculateDistance(loc.coordinates, nextLoc.coordinates);
      if (distance > MAX_LAND_ROUTE_DISTANCE) {
        console.log(`Skipping land route: ${loc.name} to ${nextLoc.name} (${Math.round(distance/1000)}km - too far for land travel)`);
        skipPairs.add(`${i}-${i + 1}`);
        continue;
      }
      
      // Skip if locations are on different days (prevents cross-day land routes)
      if (loc.day !== nextLoc.day) {
        skipPairs.add(`${i}-${i + 1}`);
        continue;
      }
    }

    const newLandRoutes: RouteInfo[] = [];
    for (let i = 0; i < locs.length - 1; i++) {
      // Skip if this pair should not have a land route
      if (skipPairs.has(`${i}-${i + 1}`)) {
        continue;
      }
      
      const route = await fetchRoute(locs[i].coordinates, locs[i + 1].coordinates);
      if (route) {
        newLandRoutes.push(route);
      }
    }
    
    // Update routes: preserve existing flight routes, replace land routes
    setRoutes(prevRoutes => {
      const existingFlightRoutes = prevRoutes.filter(r => r.isFlight);
      return [...existingFlightRoutes, ...newLandRoutes];
    });
  }, [fetchRoute, flights]);

  // Add a location from geocode result
  const handleLocationSelect = useCallback(async (result: GeocodeResult) => {
    const currentMaxDay = Math.max(...days, 1);
    const newLocation: TripLocation = {
      id: generateId(),
      name: result.name,
      coordinates: { lat: result.lat, lng: result.lng },
      type: "custom",
      day: currentMaxDay,
      order: locations.length,
    };
    
    const newLocations = [...locations, newLocation];
    setLocations(newLocations);
    setSelectedLocationId(newLocation.id);
    await calculateRoutes(newLocations);
  }, [locations, days, calculateRoutes]);

  // AI-powered search using Gemini
  const handleAISearch = useCallback(async (query: string) => {
    setIsLoading(true);
    setAiMessage(null);
    setSuggestions([]);

    try {
      const context = locations.length > 0
        ? `Current stops: ${locations.map(l => l.name.split(",")[0]).join(", ")}`
        : undefined;

      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, context }),
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data: GeminiResponse = await response.json();
      
      if (data.message) {
        setAiMessage(data.message);
      }
      
      if (data.suggestions) {
        setSuggestions(data.suggestions);
      }

      if (data.locations && data.locations.length > 0) {
        const newLocations: TripLocation[] = data.locations.map((loc, index) => ({
          id: generateId(),
          name: loc.name,
          description: loc.description,
          address: loc.address,
          coordinates: loc.coordinates,
          type: loc.type as TripLocation["type"],
          day: loc.day || 1,
          order: locations.length + index,
        }));

        // Update days array to include all days from the new locations
        const newDays = [...new Set([...days, ...newLocations.map(l => l.day || 1)])].sort((a, b) => a - b);
        setDays(newDays);
        // Also make new days visible
        setVisibleDays(prev => new Set([...prev, ...newLocations.map(l => l.day || 1)]));

        const allLocations = [...locations, ...newLocations];
        setLocations(allLocations);
        
        if (newLocations.length > 0) {
          setSelectedLocationId(newLocations[0].id);
        }
        
        await calculateRoutes(allLocations);
      }
    } catch (error) {
      console.error("AI search error:", error);
      setAiMessage("Sorry, I couldn't process your request. Please try again.");
    } finally {
      setIsLoading(false);
    }
  }, [locations, days, calculateRoutes]);

  // Add location to a specific day using AI
  const handleAddLocationToDay = useCallback(async (query: string, targetDay: number) => {
    setIsLoading(true);

    try {
      const response = await fetch("/api/gemini", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          query: `Find this location: ${query}. Return only this single location.`,
          context: `Adding to Day ${targetDay} of trip`
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to get AI response");
      }

      const data: GeminiResponse = await response.json();

      if (data.locations && data.locations.length > 0) {
        // Take only the first location and assign it to the target day
        const loc = data.locations[0];
        const newLocation: TripLocation = {
          id: generateId(),
          name: loc.name,
          description: loc.description,
          address: loc.address,
          coordinates: loc.coordinates,
          type: loc.type as TripLocation["type"],
          day: targetDay,
          order: locations.filter(l => l.day === targetDay).length,
        };

        const allLocations = [...locations, newLocation];
        // Sort by day
        allLocations.sort((a, b) => (a.day || 1) - (b.day || 1));
        setLocations(allLocations);
        setSelectedLocationId(newLocation.id);
        await calculateRoutes(allLocations);
      }
    } catch (error) {
      console.error("Add location error:", error);
    } finally {
      setIsLoading(false);
    }
  }, [locations, calculateRoutes]);

  // Remove a location
  const handleLocationRemove = useCallback(async (id: string) => {
    const newLocations = locations.filter(l => l.id !== id);
    setLocations(newLocations);
    if (selectedLocationId === id) {
      setSelectedLocationId(null);
    }
    await calculateRoutes(newLocations);
  }, [locations, selectedLocationId, calculateRoutes]);

  // Reorder locations
  const handleReorder = useCallback(async (fromIndex: number, toIndex: number) => {
    const newLocations = [...locations];
    const [removed] = newLocations.splice(fromIndex, 1);
    newLocations.splice(toIndex, 0, removed);
    setLocations(newLocations);
    await calculateRoutes(newLocations);
  }, [locations, calculateRoutes]);

  // Change location day
  const handleDayChange = useCallback(async (locationId: string, newDay: number) => {
    const newLocations = locations.map(loc => 
      loc.id === locationId ? { ...loc, day: newDay } : loc
    );
    // Sort by day, then by original order within day
    newLocations.sort((a, b) => {
      if ((a.day || 1) !== (b.day || 1)) {
        return (a.day || 1) - (b.day || 1);
      }
      return a.order - b.order;
    });
    setLocations(newLocations);
    await calculateRoutes(newLocations);
  }, [locations, calculateRoutes]);

  // Add a new day
  const handleAddDay = useCallback(() => {
    const maxDay = Math.max(...days, 0);
    const newDay = maxDay + 1;
    setDays([...days, newDay]);
    setVisibleDays(prev => new Set([...prev, newDay]));
  }, [days]);

  // Add a new day after a specific day
  const handleAddDayAfter = useCallback((afterDay: number) => {
    const newDay = afterDay + 1;
    // Check if newDay already exists
    if (days.includes(newDay)) {
      // Shift all days >= newDay up by 1
      const shiftedDays = days.map(d => d >= newDay ? d + 1 : d);
      setDays([...shiftedDays, newDay].sort((a, b) => a - b));
      // Update locations
      setLocations(prev => prev.map(loc => ({
        ...loc,
        day: (loc.day || 1) >= newDay ? (loc.day || 1) + 1 : (loc.day || 1)
      })));
      // Update flights
      setFlights(prev => prev.map(f => ({
        ...f,
        day: (f.day || 1) >= newDay ? (f.day || 1) + 1 : (f.day || 1)
      })));
      // Update trains
      setTrains(prev => prev.map(t => ({
        ...t,
        day: (t.day || 1) >= newDay ? (t.day || 1) + 1 : (t.day || 1)
      })));
    } else {
      setDays([...days, newDay].sort((a, b) => a - b));
    }
    setVisibleDays(prev => new Set([...prev, newDay]));
  }, [days]);

  // Swap two days (move all content from one day to another)
  const handleSwapDays = useCallback(async (fromDay: number, toDay: number) => {
    // Swap the day assignments for all locations
    const newLocations = locations.map(loc => {
      if ((loc.day || 1) === fromDay) {
        return { ...loc, day: toDay };
      } else if ((loc.day || 1) === toDay) {
        return { ...loc, day: fromDay };
      }
      return loc;
    });
    
    // Swap flights
    setFlights(prev => prev.map(f => {
      if ((f.day || 1) === fromDay) {
        return { ...f, day: toDay };
      } else if ((f.day || 1) === toDay) {
        return { ...f, day: fromDay };
      }
      return f;
    }));

    // Swap trains
    setTrains(prev => prev.map(t => {
      if ((t.day || 1) === fromDay) {
        return { ...t, day: toDay };
      } else if ((t.day || 1) === toDay) {
        return { ...t, day: fromDay };
      }
      return t;
    }));

    // Sort locations by day
    newLocations.sort((a, b) => (a.day || 1) - (b.day || 1));
    setLocations(newLocations);
    await calculateRoutes(newLocations);
  }, [locations, calculateRoutes]);

  // Handle data extracted from document upload (locations, flights, trains)
  const handleDocumentExtracted = useCallback(async (data: {
    locations: Array<{
      name: string;
      description?: string;
      address?: string;
      coordinates: { lat: number; lng: number };
      type: string;
      day?: number;
    }>;
    flights?: Array<{
      flightNumber: string;
      airline?: string;
      departureAirport?: string;
      departureCode: string;
      arrivalAirport?: string;
      arrivalCode: string;
      departureTime?: string;
      arrivalTime?: string;
      day?: number;
    }>;
    trains?: Array<{
      trainNumber: string;
      trainType?: "high-speed" | "normal" | "metro" | "other";
      operator?: string;
      departureStation: string;
      arrivalStation: string;
      departureTime?: string;
      arrivalTime?: string;
      day?: number;
    }>;
    message?: string;
    estimatedDays?: number;
  }) => {
    const allDays: number[] = [];
    let allNewLocations: TripLocation[] = [];
    
    // Process locations - filter out those without valid coordinates
    if (data.locations && data.locations.length > 0) {
      const validDataLocations = data.locations.filter(loc => 
        loc.coordinates && 
        typeof loc.coordinates.lat === 'number' && 
        typeof loc.coordinates.lng === 'number' &&
        !isNaN(loc.coordinates.lat) && 
        !isNaN(loc.coordinates.lng) &&
        loc.coordinates.lat !== 0 && 
        loc.coordinates.lng !== 0
      );
      
      const newLocations: TripLocation[] = validDataLocations.map((loc, index) => ({
        id: generateId(),
        name: loc.name,
        description: loc.description,
        address: loc.address,
        coordinates: loc.coordinates,
        type: loc.type as TripLocation["type"],
        day: loc.day || 1,
        order: locations.length + index,
      }));
      allNewLocations = [...allNewLocations, ...newLocations];
      allDays.push(...newLocations.map(l => l.day || 1));
      
      // Log if any locations were filtered out
      const filteredCount = data.locations.length - validDataLocations.length;
      if (filteredCount > 0) {
        console.warn(`${filteredCount} location(s) filtered out due to invalid coordinates`);
      }
    }

    // Process extracted flights
    if (data.flights && data.flights.length > 0) {
      for (const flight of data.flights) {
        // Look up airport coordinates
        let depCoords = { lat: 0, lng: 0 };
        let arrCoords = { lat: 0, lng: 0 };
        
        try {
          // Fetch departure airport
          const depResponse = await fetch(`/api/airport?code=${flight.departureCode}`);
          if (depResponse.ok) {
            const depData = await depResponse.json();
            depCoords = { lat: depData.lat, lng: depData.lon || depData.lng };
          }
          
          // Fetch arrival airport
          const arrResponse = await fetch(`/api/airport?code=${flight.arrivalCode}`);
          if (arrResponse.ok) {
            const arrData = await arrResponse.json();
            arrCoords = { lat: arrData.lat, lng: arrData.lon || arrData.lng };
          }
        } catch (e) {
          console.error("Failed to fetch airport coordinates:", e);
        }

        // Only add if we have valid coordinates
        if (depCoords.lat !== 0 && arrCoords.lat !== 0) {
          const flightDay = flight.day || 1;
          allDays.push(flightDay);

          const flightInfo: FlightInfo = {
            id: `flight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            flightNumber: flight.flightNumber,
            airline: flight.airline || extractAirlineFromNumber(flight.flightNumber),
            departure: {
              airport: flight.departureAirport || `${flight.departureCode} Airport`,
              iata: flight.departureCode,
              city: "",
              coordinates: depCoords,
              scheduledTime: flight.departureTime,
            },
            arrival: {
              airport: flight.arrivalAirport || `${flight.arrivalCode} Airport`,
              iata: flight.arrivalCode,
              city: "",
              coordinates: arrCoords,
              scheduledTime: flight.arrivalTime,
            },
            status: "Extracted",
            day: flightDay,
          };

          // Add to flights state
          setFlights(prev => [...prev, flightInfo]);

          // Add departure and arrival as locations
          const depLocation: TripLocation = {
            id: `${flightInfo.id}-dep`,
            name: `${flightInfo.departure.airport} (${flight.departureCode})`,
            description: `Flight ${flight.flightNumber} departure`,
            coordinates: depCoords,
            type: "airport",
            day: flightDay,
            order: locations.length + allNewLocations.length,
          };

          const arrLocation: TripLocation = {
            id: `${flightInfo.id}-arr`,
            name: `${flightInfo.arrival.airport} (${flight.arrivalCode})`,
            description: `Flight ${flight.flightNumber} arrival`,
            coordinates: arrCoords,
            type: "airport",
            day: flightDay,
            order: locations.length + allNewLocations.length + 1,
          };

          allNewLocations = [...allNewLocations, depLocation, arrLocation];

          // Add flight route
          const flightRoute: RouteInfo = {
            coordinates: [
              [depCoords.lng, depCoords.lat],
              [arrCoords.lng, arrCoords.lat],
            ],
            duration: 0,
            distance: calculateFlightDistance(depCoords, arrCoords),
            isFlight: true,
          };
          setRoutes(prev => [...prev, flightRoute]);
        }
      }
    }

    // Process extracted trains
    if (data.trains && data.trains.length > 0) {
      for (const train of data.trains) {
        // Look up station coordinates via geocoding
        let depCoords = { lat: 0, lng: 0 };
        let arrCoords = { lat: 0, lng: 0 };
        
        try {
          // Geocode departure station
          const depResponse = await fetch(`/api/geocode?q=${encodeURIComponent(train.departureStation + " station")}`);
          if (depResponse.ok) {
            const depData = await depResponse.json();
            if (depData.results && depData.results.length > 0) {
              depCoords = { lat: depData.results[0].lat, lng: depData.results[0].lng };
            }
          }
          
          // Geocode arrival station
          const arrResponse = await fetch(`/api/geocode?q=${encodeURIComponent(train.arrivalStation + " station")}`);
          if (arrResponse.ok) {
            const arrData = await arrResponse.json();
            if (arrData.results && arrData.results.length > 0) {
              arrCoords = { lat: arrData.results[0].lat, lng: arrData.results[0].lng };
            }
          }
        } catch (e) {
          console.error("Failed to geocode stations:", e);
        }

        // Only add if we have valid coordinates
        if (depCoords.lat !== 0 && arrCoords.lat !== 0) {
          const trainDay = train.day || 1;
          allDays.push(trainDay);

          const trainInfo: TrainInfo = {
            id: `train-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            trainNumber: train.trainNumber,
            trainType: train.trainType || "normal",
            operator: train.operator,
            departure: {
              station: train.departureStation,
              city: "",
              coordinates: depCoords,
              time: train.departureTime,
            },
            arrival: {
              station: train.arrivalStation,
              city: "",
              coordinates: arrCoords,
              time: train.arrivalTime,
            },
            day: trainDay,
          };

          // Add to trains state
          setTrains(prev => [...prev, trainInfo]);

          // Add departure and arrival as locations
          const depLocation: TripLocation = {
            id: `${trainInfo.id}-dep`,
            name: train.departureStation,
            description: `Train ${train.trainNumber} departure`,
            coordinates: depCoords,
            type: "station",
            day: trainDay,
            order: locations.length + allNewLocations.length,
          };

          const arrLocation: TripLocation = {
            id: `${trainInfo.id}-arr`,
            name: train.arrivalStation,
            description: `Train ${train.trainNumber} arrival`,
            coordinates: arrCoords,
            type: "station",
            day: trainDay,
            order: locations.length + allNewLocations.length + 1,
          };

          allNewLocations = [...allNewLocations, depLocation, arrLocation];

          // Calculate train route
          const trainRoute = await fetchRoute(depCoords, arrCoords);
          if (trainRoute) {
            setRoutes(prev => [...prev, trainRoute]);
          }
        }
      }
    }

    // Update state with all new locations
    if (allNewLocations.length > 0) {
      // Update days array
      const newDays = [...new Set([...days, ...allDays])].sort((a, b) => a - b);
      setDays(newDays);
      setVisibleDays(prev => new Set([...prev, ...allDays]));

      const allLocations = [...locations, ...allNewLocations];
      setLocations(allLocations);

      setSelectedLocationId(allNewLocations[0].id);
      await calculateRoutes(allLocations.filter(l => l.type !== "airport")); // Don't recalculate for flights
    }

    // Show AI message if provided
    if (data.message) {
      setAiMessage(data.message);
    }
  }, [locations, days, calculateRoutes, fetchRoute]);

  // Helper to extract airline from flight number
  const extractAirlineFromNumber = (fn: string): string => {
    const codes: Record<string, string> = {
      "CZ": "China Southern", "MU": "China Eastern", "CA": "Air China",
      "TG": "Thai Airways", "FD": "Thai AirAsia", "SL": "Thai Lion Air",
      "SQ": "Singapore Airlines", "CX": "Cathay Pacific",
      "JL": "Japan Airlines", "NH": "ANA", "KE": "Korean Air",
      "VN": "Vietnam Airlines", "QR": "Qatar Airways", "EK": "Emirates",
      "LH": "Lufthansa", "BA": "British Airways", "AF": "Air France",
      "AA": "American Airlines", "UA": "United", "DL": "Delta",
    };
    const code = fn.substring(0, 2).toUpperCase();
    return codes[code] || `${code} Airlines`;
  };

  // Remove a day and all its content
  const handleRemoveDay = useCallback(async (dayToRemove: number) => {
    // Remove locations for this day
    const newLocations = locations.filter(l => (l.day || 1) !== dayToRemove);
    
    // Remove flights for this day
    const flightsToRemove = flights.filter(f => (f.day || 1) === dayToRemove);
    setFlights(prev => prev.filter(f => (f.day || 1) !== dayToRemove));
    
    // Remove trains for this day
    setTrains(prev => prev.filter(t => (t.day || 1) !== dayToRemove));
    
    // Remove flight routes
    flightsToRemove.forEach(() => {
      setRoutes(prev => prev.filter(r => !r.isFlight));
    });
    
    setLocations(newLocations);
    
    const newDays = days.filter(d => d !== dayToRemove);
    if (newDays.length === 0) {
      setDays([1]);
      setVisibleDays(new Set([1]));
    } else {
      setDays(newDays);
      setVisibleDays(prev => {
        const newVisible = new Set(prev);
        newVisible.delete(dayToRemove);
        if (newVisible.size === 0) {
          return new Set(newDays);
        }
        return newVisible;
      });
    }
    
    await calculateRoutes(newLocations);
  }, [days, locations, flights, calculateRoutes]);

  // Add a flight
  const handleFlightAdd = useCallback(async (flight: FlightInfo) => {
    // Add departure and arrival airports as locations
    const departureLocation: TripLocation = {
      id: `${flight.id}-dep`,
      name: `${flight.departure.airport} (${flight.departure.iata})`,
      description: `Departure: ${flight.flightNumber} - ${flight.airline}`,
      coordinates: flight.departure.coordinates,
      type: "airport",
      day: flight.day || Math.max(...days, 1),
      order: locations.length,
    };

    const arrivalLocation: TripLocation = {
      id: `${flight.id}-arr`,
      name: `${flight.arrival.airport} (${flight.arrival.iata})`,
      description: `Arrival: ${flight.flightNumber} - ${flight.airline}`,
      coordinates: flight.arrival.coordinates,
      type: "airport",
      day: flight.day || Math.max(...days, 1),
      order: locations.length + 1,
    };

    const newLocations = [...locations, departureLocation, arrivalLocation];
    
    // Create flight route (will be rendered as curved line)
    const flightRoute: RouteInfo = {
      coordinates: [
        [flight.departure.coordinates.lng, flight.departure.coordinates.lat],
        [flight.arrival.coordinates.lng, flight.arrival.coordinates.lat],
      ],
      duration: flight.duration || 0,
      distance: calculateFlightDistance(
        flight.departure.coordinates,
        flight.arrival.coordinates
      ),
      isFlight: true,
    };

    // Update state
    setFlights(prev => [...prev, flight]);
    setLocations(newLocations);
    
    // Set routes directly - only the flight route for now (no land route between airports)
    setRoutes(prev => {
      const existingFlightRoutes = prev.filter(r => r.isFlight);
      return [...existingFlightRoutes, flightRoute];
    });
    
    setSelectedLocationId(departureLocation.id);
  }, [locations, days]);

  // Remove a flight
  const handleFlightRemove = useCallback((flightId: string) => {
    setFlights(prev => prev.filter(f => f.id !== flightId));
    // Remove associated locations
    setLocations(prev => prev.filter(l => !l.id.startsWith(flightId)));
    // Remove the flight route (we need to recalculate which routes to keep)
    setRoutes(prev => {
      // Keep only non-flight routes or flight routes for remaining flights
      const remainingFlightIds = flights.filter(f => f.id !== flightId).map(f => f.id);
      return prev.filter(r => {
        if (!r.isFlight) return true;
        // This is a simplification - ideally we'd track which route belongs to which flight
        return remainingFlightIds.length > 0;
      });
    });
  }, [flights]);

  // Edit a flight
  const handleFlightEdit = useCallback(async (updatedFlight: FlightInfo) => {
    // Remove old flight data
    const oldFlight = flights.find(f => f.id === updatedFlight.id);
    if (!oldFlight) return;

    // Update flights array
    setFlights(prev => prev.map(f => f.id === updatedFlight.id ? updatedFlight : f));

    // Update associated locations
    setLocations(prev => {
      const filtered = prev.filter(l => !l.id.startsWith(updatedFlight.id));
      
      const departureLocation: TripLocation = {
        id: `${updatedFlight.id}-dep`,
        name: `${updatedFlight.departure.airport} (${updatedFlight.departure.iata})`,
        description: `Departure: ${updatedFlight.flightNumber} - ${updatedFlight.airline}`,
        coordinates: updatedFlight.departure.coordinates,
        type: "airport",
        day: updatedFlight.day || Math.max(...days, 1),
        order: filtered.length,
      };

      const arrivalLocation: TripLocation = {
        id: `${updatedFlight.id}-arr`,
        name: `${updatedFlight.arrival.airport} (${updatedFlight.arrival.iata})`,
        description: `Arrival: ${updatedFlight.flightNumber} - ${updatedFlight.airline}`,
        coordinates: updatedFlight.arrival.coordinates,
        type: "airport",
        day: updatedFlight.day || Math.max(...days, 1),
        order: filtered.length + 1,
      };

      return [...filtered, departureLocation, arrivalLocation];
    });

    // Update flight route
    const flightRoute: RouteInfo = {
      coordinates: [
        [updatedFlight.departure.coordinates.lng, updatedFlight.departure.coordinates.lat],
        [updatedFlight.arrival.coordinates.lng, updatedFlight.arrival.coordinates.lat],
      ],
      duration: updatedFlight.duration || 0,
      distance: calculateFlightDistance(
        updatedFlight.departure.coordinates,
        updatedFlight.arrival.coordinates
      ),
      isFlight: true,
    };

    setRoutes(prev => {
      // Replace the flight route (simplified - assumes one flight route)
      const nonFlightRoutes = prev.filter(r => !r.isFlight);
      return [...nonFlightRoutes, flightRoute];
    });

    setEditingFlight(null);
  }, [flights, days]);

  // Open flight edit modal
  const handleOpenFlightEdit = useCallback((flight: FlightInfo) => {
    setEditingFlight(flight);
    setShowFlightModal(true);
  }, []);

  // Add a train
  const handleTrainAdd = useCallback(async (train: TrainInfo) => {
    setTrains(prev => [...prev, train]);
    
    // Add departure and arrival stations as locations
    const departureLocation: TripLocation = {
      id: `${train.id}-dep`,
      name: train.departure.station,
      description: `Departure: ${train.trainNumber} - ${train.operator || "Railway"}`,
      coordinates: train.departure.coordinates,
      type: "station",
      day: train.day || Math.max(...days, 1),
      order: locations.length,
    };

    const arrivalLocation: TripLocation = {
      id: `${train.id}-arr`,
      name: train.arrival.station,
      description: `Arrival: ${train.trainNumber} - ${train.operator || "Railway"}`,
      coordinates: train.arrival.coordinates,
      type: "station",
      day: train.day || Math.max(...days, 1),
      order: locations.length + 1,
    };

    const newLocations = [...locations, departureLocation, arrivalLocation];
    setLocations(newLocations);
    
    // Calculate route between stations (using OSRM for ground transportation)
    const trainRoute = await fetchRoute(
      train.departure.coordinates,
      train.arrival.coordinates
    );
    
    if (trainRoute) {
      // Override duration if provided
      if (train.duration) {
        trainRoute.duration = train.duration;
      }
      setRoutes(prev => [...prev, trainRoute]);
    }
    
    setSelectedLocationId(departureLocation.id);
  }, [locations, days, fetchRoute]);

  // Calculate great circle distance for flights
  function calculateFlightDistance(
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): number {
    const R = 6371000; // Earth's radius in meters
    const φ1 = (from.lat * Math.PI) / 180;
    const φ2 = (to.lat * Math.PI) / 180;
    const Δφ = ((to.lat - from.lat) * Math.PI) / 180;
    const Δλ = ((to.lng - from.lng) * Math.PI) / 180;

    const a =
      Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
      Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
  }

  return (
    <div className="h-screen w-full flex flex-col bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950">
      {/* Header */}
      <header className={`flex-shrink-0 border-b border-border/30 bg-background/40 backdrop-blur-xl relative z-50 transition-all ${mapExpanded ? "hidden" : ""}`}>
        <div className="container mx-auto px-4 py-3">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <div className="size-9 rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-violet-500/20">
                <Plane className="size-4 text-white" />
              </div>
              <div>
                <h1 className="text-lg font-bold bg-gradient-to-r from-violet-400 to-indigo-400 bg-clip-text text-transparent">
                  Voyage AI
                </h1>
                <p className="text-[10px] text-muted-foreground">AI-Powered Trip Planner</p>
              </div>
            </div>
          </div>
          
          <div className="flex gap-2">
            <div className="flex-1">
              <LocationSearch
                onLocationSelect={handleLocationSelect}
                onAISearch={handleAISearch}
                isLoading={isLoading}
                placeholder="Try: 'Plan a 3-day trip to Paris' or 'Road trip from LA to San Francisco'"
              />
            </div>
            <Button
              onClick={() => setShowUploadModal(true)}
              variant="outline"
              className="h-12 px-4 gap-2 border-violet-500/30 hover:border-violet-500/50 hover:bg-violet-500/10"
              title="Upload itinerary document"
            >
              <Upload className="size-4" />
              <span className="hidden sm:inline">Upload</span>
            </Button>
            <Button
              onClick={() => setShowFlightModal(true)}
              variant="outline"
              className="h-12 px-4 gap-2 border-sky-500/30 hover:border-sky-500/50 hover:bg-sky-500/10"
              title="Add flight"
            >
              <PlaneTakeoff className="size-4" />
              <span className="hidden sm:inline">Flight</span>
            </Button>
            <Button
              onClick={() => setShowTrainModal(true)}
              variant="outline"
              className="h-12 px-4 gap-2 border-emerald-500/30 hover:border-emerald-500/50 hover:bg-emerald-500/10"
              title="Add train"
            >
              <Train className="size-4" />
              <span className="hidden sm:inline">Train</span>
            </Button>
            <Button
              onClick={() => setShowExportModal(true)}
              variant="outline"
              className="h-12 px-4 gap-2 border-green-500/30 hover:border-green-500/50 hover:bg-green-500/10"
              title="Export itinerary"
              disabled={locations.length === 0}
            >
              <Download className="size-4" />
              <span className="hidden sm:inline">Export</span>
            </Button>
          </div>

          {/* AI Message */}
          {aiMessage && (
            <div className="mt-3 p-3 rounded-xl bg-gradient-to-r from-violet-500/10 to-indigo-500/10 border border-violet-500/20 relative">
              <button
                onClick={() => {
                  setAiMessage(null);
                  setSuggestions([]);
                }}
                className="absolute top-2 right-2 p-1 rounded-lg hover:bg-white/10 transition-colors group"
                aria-label="Close message"
              >
                <X className="size-3.5 text-muted-foreground group-hover:text-foreground transition-colors" />
              </button>
              <div className="flex items-start gap-2 pr-6">
                <div className="size-7 rounded-lg bg-gradient-to-br from-violet-600 to-indigo-600 flex items-center justify-center flex-shrink-0">
                  <Sparkles className="size-3.5 text-white" />
                </div>
                <div className="flex-1">
                  <p className="text-xs text-foreground/90">{aiMessage}</p>
                  {suggestions.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mt-2">
                      {suggestions.map((suggestion, index) => (
                        <button
                          key={index}
                          onClick={() => handleAISearch(suggestion)}
                          className="px-2 py-1 text-[10px] rounded-full bg-background/50 hover:bg-background/80 border border-border/50 transition-colors"
                        >
                          {suggestion}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 flex overflow-hidden relative min-h-0">
        {/* Sidebar - Trip Stops */}
        <aside 
          className={`
            flex-shrink-0 border-r border-border/30 bg-background/20 backdrop-blur-sm
            transition-all duration-300 ease-in-out
            flex flex-col min-h-0
            ${sidebarCollapsed ? "w-0 overflow-hidden" : "w-[280px] sm:w-[300px] md:w-[340px]"}
            ${mapExpanded ? "hidden" : ""}
          `}
        >
          <div className="flex-1 min-h-0 overflow-hidden">
            <TripStopsList
              locations={locations}
              routes={routes}
              flights={flights}
              selectedLocationId={selectedLocationId}
              onLocationSelect={setSelectedLocationId}
              onLocationRemove={handleLocationRemove}
              onReorder={handleReorder}
              onDayChange={handleDayChange}
              onAddDay={handleAddDay}
              onAddDayAfter={handleAddDayAfter}
              onRemoveDay={handleRemoveDay}
              onSwapDays={handleSwapDays}
              onAddLocationToDay={handleAddLocationToDay}
              onFlightEdit={handleOpenFlightEdit}
              onFlightRemove={handleFlightRemove}
              days={days}
              isSearching={isLoading}
              visibleDays={visibleDays}
              onVisibleDaysChange={setVisibleDays}
              visibleTypes={visibleTypes}
              onVisibleTypesChange={setVisibleTypes}
            />
          </div>
        </aside>

        {/* Sidebar Toggle Button */}
        <button
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
          className={`
            absolute top-3 z-20 p-2 rounded-lg bg-background/90 backdrop-blur-sm 
            shadow-md border border-border/50 hover:bg-accent transition-all
            ${sidebarCollapsed ? "left-3" : "left-[292px] sm:left-[312px] md:left-[352px]"}
            ${mapExpanded ? "hidden" : ""}
          `}
          title={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="size-4" />
          ) : (
            <PanelLeftClose className="size-4" />
          )}
        </button>

        {/* Map Expand Button */}
        <button
          onClick={() => setMapExpanded(!mapExpanded)}
          className={`
            absolute top-3 z-20 p-2 rounded-lg bg-background/90 backdrop-blur-sm 
            shadow-md border border-border/50 hover:bg-accent transition-all
            ${mapExpanded ? "right-3 top-3" : "right-3"}
          `}
          title={mapExpanded ? "Exit fullscreen" : "Fullscreen map"}
        >
          {mapExpanded ? (
            <Minimize2 className="size-4" />
          ) : (
            <Maximize2 className="size-4" />
          )}
        </button>

        {/* Map */}
        <main className={`flex-1 relative z-0 min-h-0 ${mapExpanded ? "absolute inset-0" : ""}`}>
          <TripMap
            locations={locations}
            routes={routes}
            flights={flights}
            selectedLocationId={selectedLocationId}
            onLocationClick={setSelectedLocationId}
            visibleDays={visibleDays}
            visibleTypes={visibleTypes}
            days={days}
            onVisibleDaysChange={setVisibleDays}
          />
        </main>
      </div>

      {/* Footer */}
      <footer className={`flex-shrink-0 border-t border-border/30 bg-background/40 backdrop-blur-xl py-2 px-4 ${mapExpanded ? "hidden" : ""}`}>
        <p className="text-center text-xs text-muted-foreground">
          This app made by <span className="font-medium text-foreground/80">Saksit Saelow</span>
        </p>
      </footer>

      {/* Document Upload Modal */}
      <DocumentUpload
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onDataExtracted={handleDocumentExtracted}
      />

      {/* Export Itinerary Modal */}
      <ExportItinerary
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        locations={locations}
        routes={routes}
        flights={flights}
        days={[...visibleDays].sort((a, b) => a - b)}
      />

      {/* Flight Input Modal */}
      <FlightInput
        isOpen={showFlightModal}
        onClose={() => {
          setShowFlightModal(false);
          setEditingFlight(null);
        }}
        onFlightAdd={handleFlightAdd}
        onFlightEdit={handleFlightEdit}
        editFlight={editingFlight}
        currentDay={Math.max(...days, 1)}
        totalDays={days.length}
      />

      {/* Train Input Modal */}
      <TrainInput
        isOpen={showTrainModal}
        onClose={() => setShowTrainModal(false)}
        onTrainAdd={handleTrainAdd}
        currentDay={Math.max(...days, 1)}
        totalDays={days.length}
      />
    </div>
  );
}
