"use client";

import { useState, useCallback } from "react";
import { Plane, Sparkles, X, PanelLeftClose, PanelLeft, Maximize2, Minimize2, Upload, Download } from "lucide-react";
import { LocationSearch } from "./LocationSearch";
import { TripStopsList } from "./TripStopsList";
import { TripMap } from "./TripMap";
import { DocumentUpload } from "./DocumentUpload";
import { ExportItinerary } from "./ExportItinerary";
import { Button } from "@/components/ui/button";
import type { TripLocation, RouteInfo, GeminiResponse, GeocodeResult } from "@/types/trip";

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mapExpanded, setMapExpanded] = useState(false);
  const [showUploadModal, setShowUploadModal] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);

  // Fetch route between two points using OSRM
  const fetchRoute = useCallback(async (
    from: { lat: number; lng: number },
    to: { lat: number; lng: number }
  ): Promise<RouteInfo | null> => {
    try {
      const response = await fetch(
        `https://router.project-osrm.org/route/v1/driving/${from.lng},${from.lat};${to.lng},${to.lat}?overview=full&geometries=geojson`
      );
      const data = await response.json();
      
      if (data.routes?.[0]) {
        return {
          coordinates: data.routes[0].geometry.coordinates,
          duration: data.routes[0].duration,
          distance: data.routes[0].distance,
        };
      }
      return null;
    } catch (error) {
      console.error("Route fetch error:", error);
      return null;
    }
  }, []);

  // Calculate routes for all locations
  const calculateRoutes = useCallback(async (locs: TripLocation[]) => {
    if (locs.length < 2) {
      setRoutes([]);
      return;
    }

    const newRoutes: RouteInfo[] = [];
    for (let i = 0; i < locs.length - 1; i++) {
      const route = await fetchRoute(locs[i].coordinates, locs[i + 1].coordinates);
      if (route) {
        newRoutes.push(route);
      }
    }
    setRoutes(newRoutes);
  }, [fetchRoute]);

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

  // Handle locations extracted from document upload
  const handleDocumentExtracted = useCallback(async (data: {
    locations: Array<{
      name: string;
      description?: string;
      address?: string;
      coordinates: { lat: number; lng: number };
      type: string;
      day?: number;
    }>;
    message?: string;
    estimatedDays?: number;
  }) => {
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

      // Show AI message if provided
      if (data.message) {
        setAiMessage(data.message);
      }
    }
  }, [locations, days, calculateRoutes]);

  // Remove a day (only if empty)
  const handleRemoveDay = useCallback((dayToRemove: number) => {
    const locationsInDay = locations.filter(l => (l.day || 1) === dayToRemove);
    if (locationsInDay.length > 0) return; // Don't remove if has locations
    
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
  }, [days, locations]);

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
              selectedLocationId={selectedLocationId}
              onLocationSelect={setSelectedLocationId}
              onLocationRemove={handleLocationRemove}
              onReorder={handleReorder}
              onDayChange={handleDayChange}
              onAddDay={handleAddDay}
              onRemoveDay={handleRemoveDay}
              onAddLocationToDay={handleAddLocationToDay}
              days={days}
              isSearching={isLoading}
              visibleDays={visibleDays}
              onVisibleDaysChange={setVisibleDays}
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
            selectedLocationId={selectedLocationId}
            onLocationClick={setSelectedLocationId}
            visibleDays={visibleDays}
          />
        </main>
      </div>

      {/* Document Upload Modal */}
      <DocumentUpload
        isOpen={showUploadModal}
        onClose={() => setShowUploadModal(false)}
        onLocationsExtracted={handleDocumentExtracted}
      />

      {/* Export Itinerary Modal */}
      <ExportItinerary
        isOpen={showExportModal}
        onClose={() => setShowExportModal(false)}
        locations={locations}
        routes={routes}
        days={[...visibleDays].sort((a, b) => a - b)}
      />
    </div>
  );
}
