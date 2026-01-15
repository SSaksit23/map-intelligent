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
  isFlight?: boolean; // Whether this is a flight route
  isCrossDay?: boolean; // Whether this route connects two different days
  fromDay?: number; // Starting day for cross-day routes
  toDay?: number; // Ending day for cross-day routes
}

export interface FlightInfo {
  id: string;
  flightNumber: string;
  airline: string;
  departure: {
    airport: string;
    iata: string;
    icao?: string;
    city: string;
    country?: string;
    coordinates: { lat: number; lng: number };
    time?: string; // HH:MM format
    scheduledTime?: string;
  };
  arrival: {
    airport: string;
    iata: string;
    icao?: string;
    city: string;
    country?: string;
    coordinates: { lat: number; lng: number };
    time?: string; // HH:MM format
    scheduledTime?: string;
  };
  curvedPath?: [number, number][]; // Pre-calculated curved flight path
  status: string;
  aircraft?: string;
  duration?: number;
  distance?: number; // km
  day?: number;
}

export interface TrainInfo {
  id: string;
  trainNumber: string;
  trainType: "high-speed" | "normal" | "metro" | "other";
  operator?: string;
  departure: {
    station: string;
    city: string;
    country?: string;
    coordinates: { lat: number; lng: number };
    time?: string; // HH:MM format
  };
  arrival: {
    station: string;
    city: string;
    country?: string;
    coordinates: { lat: number; lng: number };
    time?: string; // HH:MM format
  };
  duration?: number; // seconds
  distance?: number; // km
  day?: number;
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
