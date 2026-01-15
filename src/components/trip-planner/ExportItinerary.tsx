"use client";

import { useState, useRef, useMemo, useCallback } from "react";
import { Download, FileText, X, Printer, Copy, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { TripLocation, RouteInfo, FlightInfo } from "@/types/trip";
import { getDayColor } from "./TripStopsList";
import { calculateDistance } from "@/lib/utils";

interface ExportItineraryProps {
  locations: TripLocation[];
  routes: RouteInfo[];
  flights?: FlightInfo[];
  days: number[];
  isOpen: boolean;
  onClose: () => void;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return "0 min";
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  const hours = Math.floor(mins / 60);
  const remainingMins = mins % 60;
  return remainingMins > 0 ? `${hours}h ${remainingMins}m` : `${hours}h`;
}

function formatDistance(meters: number): string {
  if (!meters || meters <= 0) return "0 m";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// Estimate flight duration based on distance (avg 800 km/h for commercial flights)
function estimateFlightDuration(distanceKm: number): number {
  const avgSpeedKmH = 800;
  const hours = distanceKm / avgSpeedKmH;
  return hours * 3600; // Return in seconds
}

export function ExportItinerary({ 
  locations, 
  routes, 
  flights = [],
  days, 
  isOpen, 
  onClose,
}: ExportItineraryProps) {
  const [copied, setCopied] = useState(false);
  const [exporting, setExporting] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);

  if (!isOpen) return null;

  // Group locations by day
  const locationsByDay = days.reduce((acc, day) => {
    acc[day] = locations.filter(l => (l.day || 1) === day);
    return acc;
  }, {} as Record<number, TripLocation[]>);

  // Helper to get the first location of the next day
  const getFirstLocationOfNextDay = (currentDay: number) => {
    const sortedDays = [...days].sort((a, b) => a - b);
    const currentIndex = sortedDays.indexOf(currentDay);
    if (currentIndex === -1 || currentIndex >= sortedDays.length - 1) return null;
    
    const nextDay = sortedDays[currentIndex + 1];
    const nextDayLocations = locationsByDay[nextDay] || [];
    return nextDayLocations.length > 0 ? nextDayLocations[0] : null;
  };

  // Build a map of flight connections for quick lookup
  const flightConnections = useMemo(() => {
    const map = new Map<string, { distance: number; duration: number; isFlight: boolean }>();
    flights.forEach(flight => {
      const depId = `${flight.id}-dep`;
      const arrId = `${flight.id}-arr`;
      const distance = calculateDistance(flight.departure.coordinates, flight.arrival.coordinates);
      const duration = flight.duration || estimateFlightDuration(distance / 1000);
      map.set(`${depId}->${arrId}`, { distance, duration, isFlight: true });
    });
    return map;
  }, [flights]);

  // Get route info between two consecutive locations
  const getRouteBetween = useCallback((fromLoc: TripLocation, toLoc: TripLocation) => {
      // Check if these are flight departure/arrival locations
      // Flight locations have IDs like "flight-xxx-dep" and "flight-xxx-arr"
      if (fromLoc.id.includes('-dep') && toLoc.id.includes('-arr')) {
        // Extract flight ID from location IDs
        const fromFlightId = fromLoc.id.replace('-dep', '').replace('-arr', '');
        const toFlightId = toLoc.id.replace('-dep', '').replace('-arr', '');
        
        // If they're from the same flight, get the flight route
        if (fromFlightId === toFlightId) {
          const flight = flights.find(f => f.id === fromFlightId);
          if (flight) {
            const distance = calculateDistance(flight.departure.coordinates, flight.arrival.coordinates);
            const duration = flight.duration || estimateFlightDuration(distance / 1000);
            return { distance, duration, isFlight: true };
          }
        }
      }
      
      // For airports on same day, calculate direct distance (they'd fly)
      if (fromLoc.type === 'airport' && toLoc.type === 'airport' && fromLoc.day === toLoc.day) {
        const distance = calculateDistance(fromLoc.coordinates, toLoc.coordinates);
        if (distance !== Infinity && distance > 0) {
          return { 
            distance, 
            duration: estimateFlightDuration(distance / 1000),
            isFlight: true 
          };
        }
      }
      
      // For regular locations, find matching land route
      const fromIndex = locations.findIndex(l => l.id === fromLoc.id);
      const toIndex = locations.findIndex(l => l.id === toLoc.id);
      
      // Check if they're consecutive in the locations array
      if (toIndex === fromIndex + 1) {
        // Find a land route that could connect these (by counting non-skipped pairs)
        const landRoutes = routes.filter(r => !r.isFlight);
        let routeIndex = 0;
        for (let i = 0; i < locations.length - 1; i++) {
          const loc1 = locations[i];
          const loc2 = locations[i + 1];
          
          // Skip airports and different days (matching the skip logic in TripPlanner)
          if (loc1.type === 'airport' || loc2.type === 'airport') continue;
          if (loc1.day !== loc2.day) continue;
          
          // Check distance threshold
          const dist = calculateDistance(loc1.coordinates, loc2.coordinates);
          if (dist > 1000000) continue; // > 1000 km
          
          if (i === fromIndex && routeIndex < landRoutes.length) {
            return { ...landRoutes[routeIndex], isFlight: false };
          }
          routeIndex++;
        }
      }
      
      // Fallback: calculate direct distance (only if same day)
      if (fromLoc.day === toLoc.day) {
        const directDistance = calculateDistance(fromLoc.coordinates, toLoc.coordinates);
        if (directDistance !== Infinity && directDistance > 0 && directDistance <= 1000000) {
          // Estimate land travel time (avg 60 km/h)
          const duration = (directDistance / 1000) / 60 * 3600;
          return { distance: directDistance, duration, isFlight: false };
        }
      }
      
      return null;
  }, [locations, routes, flights, flightConnections]);

  // Calculate total stats (including cross-day routes)
  const { totalDistance, totalDuration } = useMemo(() => {
    let distance = 0;
    let duration = 0;
    
    // Calculate within-day routes
    for (let i = 0; i < locations.length - 1; i++) {
      const route = getRouteBetween(locations[i], locations[i + 1]);
      if (route) {
        distance += route.distance || 0;
        duration += route.duration || 0;
      }
    }
    
    // Add cross-day routes (last of day N to first of day N+1)
    const sortedDays = [...days].sort((a, b) => a - b);
    for (let i = 0; i < sortedDays.length - 1; i++) {
      const currentDay = sortedDays[i];
      const nextDay = sortedDays[i + 1];
      
      const currentDayLocs = locationsByDay[currentDay] || [];
      const nextDayLocs = locationsByDay[nextDay] || [];
      
      if (currentDayLocs.length > 0 && nextDayLocs.length > 0) {
        const lastOfCurrentDay = currentDayLocs[currentDayLocs.length - 1];
        const firstOfNextDay = nextDayLocs[0];
        
        // Only add if not already counted (same day locations are adjacent in locations array)
        const lastIdx = locations.findIndex(l => l.id === lastOfCurrentDay.id);
        const firstIdx = locations.findIndex(l => l.id === firstOfNextDay.id);
        
        // If they're not adjacent in the array, we need to add this cross-day route
        if (lastIdx !== -1 && firstIdx !== -1 && firstIdx !== lastIdx + 1) {
          const crossDayRoute = getRouteBetween(lastOfCurrentDay, firstOfNextDay);
          if (crossDayRoute) {
            distance += crossDayRoute.distance || 0;
            duration += crossDayRoute.duration || 0;
          }
        }
      }
    }
    
    return { totalDistance: distance, totalDuration: duration };
  }, [locations, days, locationsByDay, getRouteBetween]);

  // Helper to get route to next location within the same day
  const getRouteToNext = (location: TripLocation, dayLocations: TripLocation[], index: number) => {
    if (index >= dayLocations.length - 1) return null;
    const nextLoc = dayLocations[index + 1];
    return getRouteBetween(location, nextLoc);
  };

  // Generate text content for export
  const generateTextContent = () => {
    let content = "═══════════════════════════════════════\n";
    content += "        VOYAGE AI TRIP ITINERARY\n";
    content += "═══════════════════════════════════════\n\n";
    content += `📊 Trip Summary\n`;
    content += `   Total Distance: ${formatDistance(totalDistance)}\n`;
    content += `   Total Duration: ${formatDuration(totalDuration)}\n`;
    content += `   Total Stops: ${locations.length}\n`;
    content += `   Days: ${days.length}\n\n`;

    days.forEach(day => {
      const dayLocations = locationsByDay[day] || [];
      
      // Calculate day stats
      let dayDistance = 0;
      let dayDuration = 0;
      dayLocations.forEach((loc, idx) => {
        const route = getRouteToNext(loc, dayLocations, idx);
        if (route) {
          dayDistance += route.distance || 0;
          dayDuration += route.duration || 0;
        }
      });

      content += `───────────────────────────────────────\n`;
      content += `📅 DAY ${day}\n`;
      content += `   Distance: ${formatDistance(dayDistance)} | Duration: ${formatDuration(dayDuration)}\n`;
      content += `───────────────────────────────────────\n\n`;

      dayLocations.forEach((location, index) => {
        const globalIndex = locations.findIndex(l => l.id === location.id) + 1;
        const route = getRouteToNext(location, dayLocations, index);
        const isLast = index === dayLocations.length - 1;

        content += `   ${globalIndex}. ${location.name.split(",")[0]}\n`;
        if (location.description) {
          content += `      ${location.description}\n`;
        }
        if (location.address) {
          content += `      📍 ${location.address}\n`;
        }
        content += `      Type: ${location.type || "Location"}\n`;
        if (location.coordinates?.lat && location.coordinates?.lng) {
          content += `      Coordinates: ${location.coordinates.lat.toFixed(4)}, ${location.coordinates.lng.toFixed(4)}\n`;
        }

        if (route && !isLast) {
          const emoji = route.isFlight ? "✈️" : "↓";
          content += `\n      ${emoji} ${formatDistance(route.distance)} (${formatDuration(route.duration)})\n\n`;
        } else if (isLast) {
          // Check for cross-day route to next day's first location
          const nextDayFirstLoc = getFirstLocationOfNextDay(day);
          if (nextDayFirstLoc) {
            const crossDayRoute = getRouteBetween(location, nextDayFirstLoc);
            if (crossDayRoute) {
              const emoji = crossDayRoute.isFlight ? "✈️" : "🌙";
              const sortedDays = [...days].sort((a, b) => a - b);
              const nextDay = sortedDays[sortedDays.indexOf(day) + 1];
              content += `\n      ${emoji} To Day ${nextDay}: ${formatDistance(crossDayRoute.distance)} (${formatDuration(crossDayRoute.duration)})\n`;
            }
          }
          content += "\n";
        } else {
          content += "\n";
        }
      });

      content += "\n";
    });

    content += "═══════════════════════════════════════\n";
    content += "  Generated by Voyage AI Trip Planner\n";
    content += "═══════════════════════════════════════\n";

    return content;
  };

  // Generate HTML content for printing
  const generateHTMLContent = () => {
    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Trip Itinerary - Voyage AI</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; padding: 20px; color: #333; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #6366f1; }
    .header h1 { color: #6366f1; font-size: 28px; margin-bottom: 5px; }
    .header p { color: #666; }
    .summary { display: flex; justify-content: center; gap: 30px; margin-bottom: 30px; padding: 15px; background: #f8f9fa; border-radius: 10px; }
    .summary-item { text-align: center; }
    .summary-item .value { font-size: 24px; font-weight: bold; color: #6366f1; }
    .summary-item .label { font-size: 12px; color: #666; }
    .day { margin-bottom: 30px; page-break-inside: avoid; }
    .day-header { padding: 10px 15px; border-radius: 8px; margin-bottom: 15px; color: white; display: flex; justify-content: space-between; align-items: center; }
    .day-header h2 { font-size: 18px; }
    .day-header .stats { font-size: 12px; opacity: 0.9; }
    .location { padding: 15px; border-left: 3px solid #ddd; margin-left: 20px; margin-bottom: 10px; }
    .location-header { display: flex; align-items: center; gap: 10px; margin-bottom: 5px; }
    .location-number { width: 28px; height: 28px; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 14px; }
    .location-name { font-weight: 600; font-size: 16px; }
    .location-type { font-size: 11px; padding: 2px 8px; border-radius: 10px; background: #f0f0f0; color: #666; }
    .location-desc { color: #666; font-size: 13px; margin: 5px 0 5px 38px; }
    .location-address { color: #8b5cf6; font-size: 12px; margin-left: 38px; }
    .route-info { margin: 10px 0 10px 38px; padding: 8px 12px; background: #f8f9fa; border-radius: 6px; font-size: 12px; color: #666; display: inline-block; }
    .route-info strong { color: #333; }
    .footer { text-align: center; margin-top: 30px; padding-top: 20px; border-top: 1px solid #ddd; color: #999; font-size: 12px; }
    @media print { body { padding: 0; } .day { page-break-inside: avoid; } }
  </style>
</head>
<body>
  <div class="header">
    <h1>✈️ Trip Itinerary</h1>
    <p>Generated by Voyage AI Trip Planner</p>
  </div>

  <div class="summary">
    <div class="summary-item">
      <div class="value">${formatDistance(totalDistance)}</div>
      <div class="label">Total Distance</div>
    </div>
    <div class="summary-item">
      <div class="value">${formatDuration(totalDuration)}</div>
      <div class="label">Total Duration</div>
    </div>
    <div class="summary-item">
      <div class="value">${locations.length}</div>
      <div class="label">Stops</div>
    </div>
    <div class="summary-item">
      <div class="value">${days.length}</div>
      <div class="label">Days</div>
    </div>
  </div>

  ${days.map(day => {
    const dayLocations = locationsByDay[day] || [];
    const dayColor = getDayColor(day).bg;
    
    // Calculate day stats
    let dayDistance = 0;
    let dayDuration = 0;
    dayLocations.forEach((loc, idx) => {
      if (idx < dayLocations.length - 1) {
        const route = getRouteBetween(loc, dayLocations[idx + 1]);
        if (route) {
          dayDistance += route.distance || 0;
          dayDuration += route.duration || 0;
        }
      }
    });

    return `
    <div class="day">
      <div class="day-header" style="background: ${dayColor}">
        <h2>📅 Day ${day}</h2>
        <div class="stats">${formatDistance(dayDistance)} • ${formatDuration(dayDuration)}</div>
      </div>
      ${dayLocations.map((location, index) => {
        const globalIndex = locations.findIndex(l => l.id === location.id) + 1;
        const route = index < dayLocations.length - 1 ? getRouteBetween(location, dayLocations[index + 1]) : null;
        const isLast = index === dayLocations.length - 1;
        
        // Check for cross-day route if this is the last location
        let crossDayHtml = "";
        if (isLast) {
          const sortedDays = [...days].sort((a, b) => a - b);
          const currentIndex = sortedDays.indexOf(day);
          if (currentIndex < sortedDays.length - 1) {
            const nextDay = sortedDays[currentIndex + 1];
            const nextDayLocs = locationsByDay[nextDay] || [];
            if (nextDayLocs.length > 0) {
              const crossDayRoute = getRouteBetween(location, nextDayLocs[0]);
              if (crossDayRoute) {
                crossDayHtml = `
                  <div class="route-info" style="background: linear-gradient(to right, ${dayColor}22, #6366f122); border: 1px dashed ${dayColor}">
                    🌙 To Day ${nextDay}: <strong>${formatDistance(crossDayRoute.distance)}</strong> (${formatDuration(crossDayRoute.duration)})
                  </div>
                `;
              }
            }
          }
        }

        return `
        <div class="location" style="border-left-color: ${dayColor}">
          <div class="location-header">
            <div class="location-number" style="background: ${dayColor}">${globalIndex}</div>
            <span class="location-name">${location.name.split(",")[0]}</span>
            <span class="location-type">${location.type || "Location"}</span>
          </div>
          ${location.description ? `<div class="location-desc">${location.description}</div>` : ""}
          ${location.address ? `<div class="location-address">📍 ${location.address}</div>` : ""}
          ${route && !isLast ? `
            <div class="route-info">
              ↓ <strong>${formatDistance(route.distance)}</strong> (${formatDuration(route.duration)})
            </div>
          ` : crossDayHtml}
        </div>
        `;
      }).join("")}
    </div>
    `;
  }).join("")}

  <div class="footer">
    Generated on ${new Date().toLocaleDateString()} by Voyage AI Trip Planner
  </div>
</body>
</html>
    `;
  };

  // Copy to clipboard
  const handleCopyText = async () => {
    const content = generateTextContent();
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Download as text file
  const handleDownloadText = () => {
    const content = generateTextContent();
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trip-itinerary-${new Date().toISOString().split("T")[0]}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Open print preview with HTML
  const handlePrint = () => {
    const htmlContent = generateHTMLContent();
    const printWindow = window.open("", "_blank");
    if (printWindow) {
      printWindow.document.write(htmlContent);
      printWindow.document.close();
      setTimeout(() => {
        printWindow.print();
      }, 250);
    }
  };

  // Download as HTML file
  const handleDownloadHTML = () => {
    const htmlContent = generateHTMLContent();
    const blob = new Blob([htmlContent], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `trip-itinerary-${new Date().toISOString().split("T")[0]}.html`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />
      
      {/* Modal */}
      <div className="relative bg-background border border-border rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-border/50">
          <div className="flex items-center gap-3">
            <div className="size-10 rounded-xl bg-gradient-to-br from-green-600 to-emerald-600 flex items-center justify-center">
              <Download className="size-5 text-white" />
            </div>
            <div>
              <h2 className="font-semibold">Export Itinerary</h2>
              <p className="text-xs text-muted-foreground">Download your trip plan</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-accent transition-colors"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Summary */}
        <div className="p-4 bg-accent/30">
          <div className="grid grid-cols-4 gap-2 text-center">
            <div>
              <div className="text-lg font-bold text-primary">{days.length}</div>
              <div className="text-[10px] text-muted-foreground">Days</div>
            </div>
            <div>
              <div className="text-lg font-bold text-primary">{locations.length}</div>
              <div className="text-[10px] text-muted-foreground">Stops</div>
            </div>
            <div>
              <div className="text-lg font-bold text-primary">{formatDistance(totalDistance)}</div>
              <div className="text-[10px] text-muted-foreground">Distance</div>
            </div>
            <div>
              <div className="text-lg font-bold text-primary">{formatDuration(totalDuration)}</div>
              <div className="text-[10px] text-muted-foreground">Duration</div>
            </div>
          </div>
        </div>

        {/* Export Options */}
        <div className="p-4 space-y-2">
          <p className="text-xs text-muted-foreground mb-3">Choose export format:</p>
          
          {/* Print / PDF */}
          <button
            onClick={handlePrint}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors text-left"
          >
            <div className="size-10 rounded-lg bg-red-500/10 flex items-center justify-center">
              <Printer className="size-5 text-red-500" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">Print / Save as PDF</div>
              <div className="text-xs text-muted-foreground">Beautiful formatted itinerary with day colors</div>
            </div>
          </button>

          {/* Download HTML */}
          <button
            onClick={handleDownloadHTML}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors text-left"
          >
            <div className="size-10 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <FileText className="size-5 text-blue-500" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">Download HTML</div>
              <div className="text-xs text-muted-foreground">Open in browser, can print to PDF</div>
            </div>
          </button>

          {/* Download Text */}
          <button
            onClick={handleDownloadText}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors text-left"
          >
            <div className="size-10 rounded-lg bg-gray-500/10 flex items-center justify-center">
              <FileText className="size-5 text-gray-500" />
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">Download Text</div>
              <div className="text-xs text-muted-foreground">Plain text format, easy to share</div>
            </div>
          </button>

          {/* Copy to Clipboard */}
          <button
            onClick={handleCopyText}
            className="w-full flex items-center gap-3 p-3 rounded-lg border border-border/50 hover:bg-accent/50 transition-colors text-left"
          >
            <div className="size-10 rounded-lg bg-violet-500/10 flex items-center justify-center">
              {copied ? (
                <CheckCircle className="size-5 text-green-500" />
              ) : (
                <Copy className="size-5 text-violet-500" />
              )}
            </div>
            <div className="flex-1">
              <div className="font-medium text-sm">
                {copied ? "Copied!" : "Copy to Clipboard"}
              </div>
              <div className="text-xs text-muted-foreground">Paste into any app or document</div>
            </div>
          </button>
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-border/50 bg-accent/20">
          <Button variant="outline" onClick={onClose} className="w-full">
            Close
          </Button>
        </div>
      </div>
    </div>
  );
}
