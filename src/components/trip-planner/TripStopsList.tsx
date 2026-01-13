"use client";

import { useState, useRef } from "react";
import { GripVertical, Trash2, MapPin, Clock, Route, Calendar, Building2, Plus, X, ChevronDown, ChevronRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { TripLocation, RouteInfo } from "@/types/trip";

interface TripStopsListProps {
  locations: TripLocation[];
  routes: RouteInfo[];
  selectedLocationId?: string | null;
  onLocationSelect: (id: string) => void;
  onLocationRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onDayChange: (locationId: string, newDay: number) => void;
  onAddDay: () => void;
  onRemoveDay: (day: number) => void;
  days: number[];
}

const typeLabels: Record<string, string> = {
  attraction: "Attraction",
  restaurant: "Restaurant",
  hotel: "Hotel",
  landmark: "Landmark",
  city: "City",
  airport: "Airport",
  station: "Station",
  custom: "Location",
};

const typeColors: Record<string, string> = {
  attraction: "bg-orange-500/10 text-orange-600 border-orange-500/20",
  restaurant: "bg-red-500/10 text-red-600 border-red-500/20",
  hotel: "bg-violet-500/10 text-violet-600 border-violet-500/20",
  landmark: "bg-cyan-500/10 text-cyan-600 border-cyan-500/20",
  city: "bg-blue-500/10 text-blue-600 border-blue-500/20",
  airport: "bg-slate-500/10 text-slate-600 border-slate-500/20",
  station: "bg-green-500/10 text-green-600 border-green-500/20",
  custom: "bg-pink-500/10 text-pink-600 border-pink-500/20",
};

// Day colors for visual distinction
export const dayColors = [
  { bg: "#f97316", light: "bg-orange-500/10", text: "text-orange-500", border: "border-orange-500/30" }, // Day 1 - Orange
  { bg: "#3b82f6", light: "bg-blue-500/10", text: "text-blue-500", border: "border-blue-500/30" },       // Day 2 - Blue
  { bg: "#22c55e", light: "bg-green-500/10", text: "text-green-500", border: "border-green-500/30" },    // Day 3 - Green
  { bg: "#a855f7", light: "bg-purple-500/10", text: "text-purple-500", border: "border-purple-500/30" }, // Day 4 - Purple
  { bg: "#ec4899", light: "bg-pink-500/10", text: "text-pink-500", border: "border-pink-500/30" },       // Day 5 - Pink
  { bg: "#14b8a6", light: "bg-teal-500/10", text: "text-teal-500", border: "border-teal-500/30" },       // Day 6 - Teal
  { bg: "#f59e0b", light: "bg-amber-500/10", text: "text-amber-500", border: "border-amber-500/30" },    // Day 7 - Amber
  { bg: "#6366f1", light: "bg-indigo-500/10", text: "text-indigo-500", border: "border-indigo-500/30" }, // Day 8 - Indigo
];

export function getDayColor(day: number | undefined) {
  if (!day || day < 1) return dayColors[0];
  return dayColors[(day - 1) % dayColors.length];
}

function formatDuration(seconds: number): string {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

export function TripStopsList({
  locations,
  routes,
  selectedLocationId,
  onLocationSelect,
  onLocationRemove,
  onReorder,
  onDayChange,
  onAddDay,
  onRemoveDay,
  days,
}: TripStopsListProps) {
  const [collapsedDays, setCollapsedDays] = useState<Set<number>>(new Set());
  const [draggedItem, setDraggedItem] = useState<string | null>(null);
  const [dragOverDay, setDragOverDay] = useState<number | null>(null);
  const dragCounter = useRef(0);

  const toggleDayCollapse = (day: number) => {
    setCollapsedDays(prev => {
      const newSet = new Set(prev);
      if (newSet.has(day)) {
        newSet.delete(day);
      } else {
        newSet.add(day);
      }
      return newSet;
    });
  };

  if (locations.length === 0 && days.length <= 1) {
    return (
      <div className="flex flex-col h-full">
        {/* Day Management Header */}
        <div className="p-3 border-b border-border/50 flex items-center justify-between">
          <span className="text-sm font-medium text-muted-foreground">Trip Days</span>
          <Button
            variant="outline"
            size="sm"
            onClick={onAddDay}
            className="h-7 text-xs gap-1"
          >
            <Plus className="size-3" />
            Add Day
          </Button>
        </div>

        <div className="flex flex-col items-center justify-center flex-1 py-12 px-4 text-center">
          <div className="size-16 rounded-full bg-primary/10 flex items-center justify-center mb-4">
            <MapPin className="size-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">No destinations yet</h3>
          <p className="text-sm text-muted-foreground max-w-[250px]">
            Search for places or use AI to plan your perfect trip
          </p>
        </div>
      </div>
    );
  }

  const totalDistance = routes.reduce((sum, r) => sum + r.distance, 0);
  const totalDuration = routes.reduce((sum, r) => sum + r.duration, 0);

  // Group locations by day
  const locationsByDay = days.reduce((acc, day) => {
    acc[day] = locations.filter(l => (l.day || 1) === day);
    return acc;
  }, {} as Record<number, TripLocation[]>);

  // Create a map of location index to route
  const getRouteForLocation = (locationId: string) => {
    const locIndex = locations.findIndex(l => l.id === locationId);
    return locIndex >= 0 && locIndex < routes.length ? routes[locIndex] : null;
  };

  const handleDragStart = (e: React.DragEvent, locationId: string) => {
    setDraggedItem(locationId);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", locationId);
  };

  const handleDragEnd = () => {
    setDraggedItem(null);
    setDragOverDay(null);
    dragCounter.current = 0;
  };

  const handleDragEnterDay = (day: number) => {
    dragCounter.current++;
    setDragOverDay(day);
  };

  const handleDragLeaveDay = () => {
    dragCounter.current--;
    if (dragCounter.current === 0) {
      setDragOverDay(null);
    }
  };

  const handleDropOnDay = (e: React.DragEvent, targetDay: number) => {
    e.preventDefault();
    const locationId = e.dataTransfer.getData("text/plain");
    if (locationId && draggedItem) {
      const location = locations.find(l => l.id === locationId);
      if (location && location.day !== targetDay) {
        onDayChange(locationId, targetDay);
      }
    }
    setDraggedItem(null);
    setDragOverDay(null);
    dragCounter.current = 0;
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Day Management Header */}
      <div className="p-3 border-b border-border/50 flex items-center justify-between flex-shrink-0">
        <span className="text-sm font-medium text-muted-foreground">
          {days.length} {days.length === 1 ? "Day" : "Days"}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={onAddDay}
          className="h-7 text-xs gap-1"
        >
          <Plus className="size-3" />
          Add Day
        </Button>
      </div>

      {/* Trip Summary */}
      {routes.length > 0 && (
        <div className="p-3 border-b border-border/50 flex-shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Route className="size-4 text-muted-foreground" />
                <span className="font-medium text-sm">{formatDistance(totalDistance)}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <Clock className="size-4 text-muted-foreground" />
                <span className="font-medium text-sm">{formatDuration(totalDuration)}</span>
              </div>
            </div>
            <Badge variant="secondary" className="font-normal text-xs">
              {locations.length} stops
            </Badge>
          </div>
        </div>
      )}

      {/* Stops List by Day - Scrollable Container */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="p-3 space-y-3">
          {days.map((day) => {
            const dayColor = getDayColor(day);
            const dayLocations = locationsByDay[day] || [];
            const isCollapsed = collapsedDays.has(day);
            const isDragOver = dragOverDay === day;
            const canRemoveDay = days.length > 1 && dayLocations.length === 0;

            return (
              <div
                key={day}
                className={`rounded-lg border transition-all ${
                  isDragOver 
                    ? "border-2 border-dashed bg-accent/30" 
                    : "border-border/50"
                }`}
                style={{ borderColor: isDragOver ? dayColor.bg : undefined }}
                onDragEnter={() => handleDragEnterDay(day)}
                onDragLeave={handleDragLeaveDay}
                onDragOver={handleDragOver}
                onDrop={(e) => handleDropOnDay(e, day)}
              >
                {/* Day Header */}
                <div
                  className="flex items-center gap-2 p-2 cursor-pointer hover:bg-accent/30 rounded-t-lg"
                  onClick={() => toggleDayCollapse(day)}
                >
                  <button className="p-0.5">
                    {isCollapsed ? (
                      <ChevronRight className="size-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="size-4 text-muted-foreground" />
                    )}
                  </button>
                  <div
                    className="size-6 rounded-md flex items-center justify-center"
                    style={{ backgroundColor: dayColor.bg }}
                  >
                    <Calendar className="size-3.5 text-white" />
                  </div>
                  <span className="font-semibold text-sm flex-1" style={{ color: dayColor.bg }}>
                    Day {day}
                  </span>
                  <Badge variant="secondary" className="text-[10px] h-5">
                    {dayLocations.length} stops
                  </Badge>
                  {canRemoveDay && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-6 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveDay(day);
                      }}
                    >
                      <X className="size-3" />
                    </Button>
                  )}
                </div>

                {/* Day Content */}
                {!isCollapsed && (
                  <div className="p-2 pt-0 space-y-1">
                    {dayLocations.length === 0 ? (
                      <div className="text-center py-4 text-xs text-muted-foreground">
                        Drag items here or search to add stops
                      </div>
                    ) : (
                      dayLocations.map((location) => {
                        const globalIndex = locations.findIndex(l => l.id === location.id);
                        const routeToNext = getRouteForLocation(location.id);
                        const isHotel = location.type === "hotel";
                        const isLastInDay = dayLocations[dayLocations.length - 1]?.id === location.id;
                        const isDragging = draggedItem === location.id;

                        return (
                          <div key={location.id}>
                            <Card
                              draggable
                              onDragStart={(e) => handleDragStart(e, location.id)}
                              onDragEnd={handleDragEnd}
                              className={`
                                p-2.5 cursor-pointer transition-all duration-200
                                hover:bg-accent/50 
                                ${dayColor.border} border-l-4
                                ${selectedLocationId === location.id ? "ring-2 ring-primary bg-accent/30" : ""}
                                ${isDragging ? "opacity-50 scale-95" : ""}
                              `}
                              onClick={() => onLocationSelect(location.id)}
                            >
                              <div className="flex items-start gap-2">
                                <div className="flex items-center gap-1.5">
                                  <GripVertical className="size-3.5 text-muted-foreground/50 cursor-grab active:cursor-grabbing" />
                                  <div
                                    className="size-6 rounded-full flex items-center justify-center text-white text-xs font-bold shadow-sm"
                                    style={{ backgroundColor: dayColor.bg }}
                                  >
                                    {isHotel ? "🏨" : globalIndex + 1}
                                  </div>
                                </div>

                                <div className="flex-1 min-w-0">
                                  <div className="flex items-start justify-between gap-1">
                                    <div className="min-w-0">
                                      <div className="flex items-center gap-1.5">
                                        {isHotel && <Building2 className="size-3.5 text-violet-500 flex-shrink-0" />}
                                        <p className="font-medium text-xs truncate">{location.name.split(",")[0]}</p>
                                      </div>
                                      {location.description && (
                                        <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                                          {location.description}
                                        </p>
                                      )}
                                      {isHotel && location.address && (
                                        <p className="text-[10px] text-violet-400 mt-0.5 line-clamp-1">
                                          📍 {location.address}
                                        </p>
                                      )}
                                    </div>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="size-6 text-muted-foreground hover:text-destructive flex-shrink-0"
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onLocationRemove(location.id);
                                      }}
                                    >
                                      <Trash2 className="size-3" />
                                    </Button>
                                  </div>

                                  <div className="flex items-center gap-1.5 mt-1.5">
                                    <Badge
                                      variant="outline"
                                      className={`text-[9px] px-1 py-0 ${typeColors[location.type || "custom"]}`}
                                    >
                                      {typeLabels[location.type || "custom"]}
                                    </Badge>
                                  </div>
                                </div>
                              </div>
                            </Card>

                            {/* Route info to next stop */}
                            {routeToNext && !isLastInDay && (
                              <div className="flex items-center gap-1.5 py-1.5 px-2 ml-6">
                                <div
                                  className="w-0.5 h-4 rounded-full"
                                  style={{ backgroundColor: dayColor.bg, opacity: 0.5 }}
                                />
                                <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                                  <span className="flex items-center gap-0.5">
                                    <Route className="size-2.5" />
                                    {formatDistance(routeToNext.distance)}
                                  </span>
                                  <span className="flex items-center gap-0.5">
                                    <Clock className="size-2.5" />
                                    {formatDuration(routeToNext.duration)}
                                  </span>
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
