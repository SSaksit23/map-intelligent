export interface TripLocation {
  id: string;
  name: string;
  description?: string;
  address?: string;
  coordinates: {
    lat: number;
    lng: number;
  };
  type?: "attraction" | "restaurant" | "hotel" | "landmark" | "city" | "airport" | "station" | "custom";
  day?: number; // Day number (1, 2, 3, etc.) for multi-day trips
  order: number;
}

export interface RouteInfo {
  coordinates: [number, number][];
  duration: number; // seconds
  distance: number; // meters
}

export interface TripData {
  id: string;
  name: string;
  locations: TripLocation[];
  routes: RouteInfo[];
  totalDistance: number;
  totalDuration: number;
  createdAt: Date;
}

export interface GeminiResponse {
  locations: Array<{
    name: string;
    description: string;
    address?: string;
    coordinates: { lat: number; lng: number };
    type: string;
    day?: number;
  }>;
  suggestions: string[];
  tripType: string;
  estimatedDays: number;
  message: string;
}

export interface GeocodeResult {
  name: string;
  lat: number;
  lng: number;
  type: string;
  category: string;
}
