"use client";

import { useEffect, useRef, useState } from "react";
import {
  Map,
  MapMarker,
  MarkerContent,
  MarkerLabel,
  MapRoute,
  MapControls,
} from "@/components/ui/map";
import type { TripLocation, RouteInfo } from "@/types/trip";
import type MapLibreGL from "maplibre-gl";
import { getDayColor } from "./TripStopsList";
import { Layers, Eye, EyeOff, Map as MapIcon, Satellite, Mountain } from "lucide-react";

interface TripMapProps {
  locations: TripLocation[];
  routes: RouteInfo[];
  selectedLocationId?: string | null;
  onLocationClick?: (id: string) => void;
}

type MapStyleType = "street" | "satellite" | "terrain";

const mapStyles: Record<MapStyleType, { light: string; dark: string; label: string; icon: typeof MapIcon }> = {
  street: {
    light: "https://basemaps.cartocdn.com/gl/positron-gl-style/style.json",
    dark: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
    label: "Street",
    icon: MapIcon,
  },
  satellite: {
    // Using free OpenFreeMap satellite style
    light: "https://tiles.openfreemap.org/styles/liberty",
    dark: "https://tiles.openfreemap.org/styles/liberty",
    label: "Satellite",
    icon: Satellite,
  },
  terrain: {
    light: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    dark: "https://basemaps.cartocdn.com/gl/voyager-gl-style/style.json",
    label: "Terrain",
    icon: Mountain,
  },
};

export function TripMap({
  locations,
  routes,
  selectedLocationId,
  onLocationClick,
}: TripMapProps) {
  const mapRef = useRef<MapLibreGL.Map | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [currentStyle, setCurrentStyle] = useState<MapStyleType>("street");
  const [showStyleMenu, setShowStyleMenu] = useState(false);

  // Calculate center based on locations
  const center: [number, number] = locations.length > 0
    ? [
        locations.reduce((sum, loc) => sum + loc.coordinates.lng, 0) / locations.length,
        locations.reduce((sum, loc) => sum + loc.coordinates.lat, 0) / locations.length,
      ]
    : [0, 20]; // Default center

  // Calculate appropriate zoom level based on locations spread
  const calculateZoom = () => {
    if (locations.length === 0) return 2;
    if (locations.length === 1) return 12;

    const lngs = locations.map((l) => l.coordinates.lng);
    const lats = locations.map((l) => l.coordinates.lat);
    const lngSpread = Math.max(...lngs) - Math.min(...lngs);
    const latSpread = Math.max(...lats) - Math.min(...lats);
    const maxSpread = Math.max(lngSpread, latSpread);

    if (maxSpread > 100) return 2;
    if (maxSpread > 50) return 3;
    if (maxSpread > 20) return 4;
    if (maxSpread > 10) return 5;
    if (maxSpread > 5) return 6;
    if (maxSpread > 2) return 7;
    if (maxSpread > 1) return 8;
    if (maxSpread > 0.5) return 10;
    return 12;
  };

  // Fit bounds when locations change
  useEffect(() => {
    if (mapRef.current && locations.length > 0) {
      const bounds = locations.reduce(
        (acc, loc) => {
          acc.minLng = Math.min(acc.minLng, loc.coordinates.lng);
          acc.maxLng = Math.max(acc.maxLng, loc.coordinates.lng);
          acc.minLat = Math.min(acc.minLat, loc.coordinates.lat);
          acc.maxLat = Math.max(acc.maxLat, loc.coordinates.lat);
          return acc;
        },
        { minLng: Infinity, maxLng: -Infinity, minLat: Infinity, maxLat: -Infinity }
      );

      mapRef.current.fitBounds(
        [
          [bounds.minLng, bounds.minLat],
          [bounds.maxLng, bounds.maxLat],
        ],
        { padding: 80, duration: 1000, maxZoom: 14 }
      );
    }
  }, [locations]);

  // Get day color for route (use the starting location's day)
  const getRouteColor = (routeIndex: number) => {
    if (routeIndex < locations.length) {
      return getDayColor(locations[routeIndex]?.day).bg;
    }
    return "#6366f1";
  };

  const StyleIcon = mapStyles[currentStyle].icon;

  return (
    <div className="w-full h-full relative">
      <Map
        ref={mapRef}
        center={center}
        zoom={calculateZoom()}
        styles={{
          light: mapStyles[currentStyle].light,
          dark: mapStyles[currentStyle].dark,
        }}
      >
        <MapControls position="bottom-right" showZoom showLocate showFullscreen />

        {/* Render routes with day-based colors */}
        {routes.map((route, index) => (
          <MapRoute
            key={`route-${index}`}
            coordinates={route.coordinates}
            color={getRouteColor(index)}
            width={4}
            opacity={0.8}
          />
        ))}

        {/* Render location markers with day-based colors */}
        {locations.map((location, index) => {
          const dayColor = getDayColor(location.day);
          const isHotel = location.type === "hotel";

          return (
            <MapMarker
              key={location.id}
              longitude={location.coordinates.lng}
              latitude={location.coordinates.lat}
              onClick={() => onLocationClick?.(location.id)}
            >
              <MarkerContent>
                <div
                  className={`
                    size-8 rounded-full flex items-center justify-center 
                    text-white text-sm font-bold shadow-lg border-2 border-white
                    transition-transform hover:scale-110
                    ${selectedLocationId === location.id ? "ring-2 ring-offset-2 ring-indigo-500 scale-110" : ""}
                    ${isHotel ? "ring-2 ring-violet-300" : ""}
                  `}
                  style={{ backgroundColor: dayColor.bg }}
                >
                  {isHotel ? "🏨" : index + 1}
                </div>
                {showLabels && (
                  <MarkerLabel position="bottom">
                    <span
                      className="bg-background/90 backdrop-blur-sm px-2 py-0.5 rounded text-xs font-medium shadow-sm"
                      style={{ borderLeft: `3px solid ${dayColor.bg}` }}
                    >
                      {location.name.split(",")[0]}
                    </span>
                  </MarkerLabel>
                )}
              </MarkerContent>
            </MapMarker>
          );
        })}
      </Map>

      {/* Map Controls - Top Left */}
      <div className="absolute top-3 left-3 z-10 flex flex-col gap-2">
        {/* Label Toggle */}
        <button
          onClick={() => setShowLabels(!showLabels)}
          className={`
            flex items-center gap-2 px-3 py-2 rounded-lg shadow-md transition-all
            ${showLabels 
              ? "bg-primary text-primary-foreground" 
              : "bg-background/90 backdrop-blur-sm text-foreground hover:bg-accent"
            }
          `}
          title={showLabels ? "Hide labels" : "Show labels"}
        >
          {showLabels ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
          <span className="text-xs font-medium">Labels</span>
        </button>

        {/* Map Style Selector */}
        <div className="relative">
          <button
            onClick={() => setShowStyleMenu(!showStyleMenu)}
            className="flex items-center gap-2 px-3 py-2 rounded-lg shadow-md bg-background/90 backdrop-blur-sm hover:bg-accent transition-all"
          >
            <Layers className="size-4" />
            <span className="text-xs font-medium">{mapStyles[currentStyle].label}</span>
          </button>

          {showStyleMenu && (
            <div className="absolute top-full left-0 mt-1 bg-background/95 backdrop-blur-sm rounded-lg shadow-lg border border-border/50 overflow-hidden min-w-[140px]">
              {(Object.keys(mapStyles) as MapStyleType[]).map((style) => {
                const Icon = mapStyles[style].icon;
                return (
                  <button
                    key={style}
                    onClick={() => {
                      setCurrentStyle(style);
                      setShowStyleMenu(false);
                    }}
                    className={`
                      flex items-center gap-2 w-full px-3 py-2 text-left text-xs transition-colors
                      ${currentStyle === style ? "bg-primary/10 text-primary" : "hover:bg-accent"}
                    `}
                  >
                    <Icon className="size-4" />
                    {mapStyles[style].label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
