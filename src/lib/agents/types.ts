/**
 * CrewAI-inspired Agent Types for Trip Planner
 * Multi-agent system for document extraction, geolocation, and distance calculation
 */

// Agent role definition
export interface AgentRole {
  name: string;
  goal: string;
  backstory: string;
  verbose?: boolean;
}

// Task definition
export interface Task {
  id: string;
  description: string;
  expectedOutput: string;
  agent: string; // Agent name responsible for this task
  context?: Task[]; // Previous tasks that provide context
}

// Task result
export interface TaskResult<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  executionTime?: number;
  agentName: string;
}

// Extracted entity from documents
export interface ExtractedEntity {
  name: string;
  type: "location" | "flight" | "train" | "hotel" | "restaurant" | "attraction" | "airport" | "station" | "city";
  rawText?: string;
  day?: number;
  order?: number; // Order within the day for proper sequencing
  metadata?: Record<string, unknown>;
}

// Translated entity with both original and English names
export interface TranslatedEntity extends ExtractedEntity {
  originalName: string;
  englishName: string;
  standardizedName: string; // Optimized for geocoding
  country?: string;
  region?: string;
}

// Extracted flight info
export interface ExtractedFlight {
  flightNumber: string;
  airline?: string;
  departureAirport?: string;
  departureCode: string;
  arrivalAirport?: string;
  arrivalCode: string;
  departureTime?: string;
  arrivalTime?: string;
  day?: number;
}

// Extracted train info
export interface ExtractedTrain {
  trainNumber: string;
  trainType?: "high-speed" | "normal" | "metro" | "other";
  operator?: string;
  departureStation: string;
  arrivalStation: string;
  departureTime?: string;
  arrivalTime?: string;
  day?: number;
}

// Document extraction result
export interface DocExtractionResult {
  entities: ExtractedEntity[];
  flights: ExtractedFlight[];
  trains: ExtractedTrain[];
  rawText: string;
  estimatedDays: number;
  documentType: string;
}

// Geolocation result
export interface GeolocatedEntity extends ExtractedEntity {
  coordinates?: {
    lat: number;
    lng: number;
  };
  confidence: number; // 0-1 confidence score
  source: "api" | "ai" | "fallback";
  address?: string;
  description?: string;
}

// Distance calculation result
export interface DistanceResult {
  from: string;
  to: string;
  distanceKm: number;
  durationMinutes?: number;
  mode: "driving" | "flight" | "train" | "walking";
}

// Final crew output
export interface CrewOutput {
  locations: Array<{
    name: string;
    description?: string;
    address?: string;
    coordinates: { lat: number; lng: number };
    type: string;
    day: number;
    order: number; // Global order for proper sequencing
  }>;
  flights: ExtractedFlight[];
  trains: ExtractedTrain[];
  distances: DistanceResult[];
  tripType: string;
  estimatedDays: number;
  message: string;
}

// Agent execution context
export interface AgentContext {
  previousResults: Map<string, TaskResult>;
  sharedMemory: Map<string, unknown>;
  apiKeys: {
    gemini?: string;
    apiNinjas?: string;
  };
}
