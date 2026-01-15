/**
 * Crew Orchestrator
 * Coordinates multiple agents to process documents and extract travel information
 * Inspired by CrewAI's crew management pattern
 */

import { DocExtractionAgent } from "./doc-extraction-agent";
import { TranslationAgent } from "./translation-agent";
import { GeolocationAgent } from "./geolocation-agent";
import { DistanceCalculationAgent } from "./distance-agent";
import type {
  AgentContext,
  Task,
  TaskResult,
  CrewOutput,
  DocExtractionResult,
  GeolocatedEntity,
  DistanceResult,
  TranslatedEntity,
} from "./types";

interface CrewConfig {
  apiKeys: {
    gemini?: string;
    apiNinjas?: string;
  };
  verbose?: boolean;
}

interface DocumentInput {
  text?: string;
  imageData?: {
    base64: string;
    mimeType: string;
  };
  documentType?: string;
}

export class CrewOrchestrator {
  private context: AgentContext;
  private verbose: boolean;

  constructor(config: CrewConfig) {
    this.context = {
      previousResults: new Map(),
      sharedMemory: new Map(),
      apiKeys: config.apiKeys,
    };
    this.verbose = config.verbose ?? true;
  }

  private log(message: string, data?: unknown): void {
    if (this.verbose) {
      console.log(`[CrewOrchestrator] ${message}`, data ?? "");
    }
  }

  /**
   * Process a document through the agent pipeline
   */
  async processDocument(input: DocumentInput): Promise<CrewOutput> {
    const startTime = Date.now();
    this.log("Starting crew execution", { documentType: input.documentType });

    // Store input in shared memory
    if (input.text) {
      this.context.sharedMemory.set("documentText", input.text);
    }
    if (input.imageData) {
      this.context.sharedMemory.set("imageData", input.imageData);
    }
    if (input.documentType) {
      this.context.sharedMemory.set("documentType", input.documentType);
    }

    // Define tasks for each agent
    const tasks: Task[] = [
      {
        id: "doc-extraction",
        description: "Extract all travel entities from the document",
        expectedOutput: "List of locations, flights, and trains with day assignments",
        agent: "DocExtractionAgent",
      },
      {
        id: "translation",
        description: "Translate and standardize location names to English",
        expectedOutput: "Translated entities with original and English names",
        agent: "TranslationAgent",
        context: [{ id: "doc-extraction" } as Task],
      },
      {
        id: "geolocation",
        description: "Find coordinates for all translated entities",
        expectedOutput: "Geolocated entities with coordinates and confidence scores",
        agent: "GeolocationAgent",
        context: [{ id: "translation" } as Task],
      },
      {
        id: "distance-calculation",
        description: "Calculate distances between consecutive locations",
        expectedOutput: "Distance and duration for each route segment",
        agent: "DistanceCalculationAgent",
        context: [{ id: "geolocation" } as Task],
      },
    ];

    // Execute tasks sequentially
    const results: Map<string, TaskResult> = new Map();

    // Task 1: Document Extraction
    this.log("Executing Task 1: Document Extraction");
    const extractionAgent = new DocExtractionAgent(this.context);
    const extractionResult = await extractionAgent.execute(tasks[0]);
    results.set("doc-extraction", extractionResult);
    this.context.previousResults.set("doc-extraction", extractionResult);

    if (!extractionResult.success) {
      this.log("Document extraction failed", extractionResult.error);
      return this.createErrorOutput(extractionResult.error || "Extraction failed");
    }

    // Task 2: Translation
    this.log("Executing Task 2: Translation");
    const translationAgent = new TranslationAgent(this.context);
    const translationResult = await translationAgent.execute(tasks[1]);
    results.set("translation", translationResult);
    this.context.previousResults.set("translation", translationResult);

    if (!translationResult.success) {
      this.log("Translation failed, continuing with original names");
      // Continue with original extraction results
    }

    // Task 3: Geolocation
    this.log("Executing Task 3: Geolocation");
    const geolocationAgent = new GeolocationAgent(this.context);
    const geolocationResult = await geolocationAgent.execute(tasks[2]);
    results.set("geolocation", geolocationResult);
    this.context.previousResults.set("geolocation", geolocationResult);

    if (!geolocationResult.success) {
      this.log("Geolocation failed, continuing with extraction results only");
      // Continue without geolocation - use extraction results
    }

    // Task 4: Distance Calculation
    this.log("Executing Task 4: Distance Calculation");
    const distanceAgent = new DistanceCalculationAgent(this.context);
    const distanceResult = await distanceAgent.execute(tasks[3]);
    results.set("distance-calculation", distanceResult);

    if (!distanceResult.success) {
      this.log("Distance calculation failed, continuing without distances");
    }

    // Compile final output
    const output = this.compileOutput(results);

    const totalTime = Date.now() - startTime;
    this.log(`Crew execution complete in ${totalTime}ms`, {
      locations: output.locations.length,
      flights: output.flights.length,
      trains: output.trains.length,
      distances: output.distances.length,
    });

    return output;
  }

  private compileOutput(results: Map<string, TaskResult>): CrewOutput {
    const extractionResult = results.get("doc-extraction") as TaskResult<DocExtractionResult>;
    const translationResult = results.get("translation") as TaskResult<{
      entities: TranslatedEntity[];
      flights: any[];
      trains: any[];
      detectedLanguage: string;
      estimatedDays: number;
    }>;
    const geolocationResult = results.get("geolocation") as TaskResult<GeolocatedEntity[]>;
    const distanceResult = results.get("distance-calculation") as TaskResult<DistanceResult[]>;

    const extraction = extractionResult?.data;
    const translation = translationResult?.data;
    const geolocatedEntities = geolocationResult?.data || [];
    const distances = distanceResult?.data || [];

    // Build locations from geolocated entities with translated names
    let locations = geolocatedEntities
      .filter((e) => e.coordinates && e.type !== "flight" && e.type !== "train")
      .map((e, index) => {
        // Find matching translated entity
        const translated = translation?.entities.find(
          (t) => t.name === e.name || t.originalName === e.name
        );
        
        // Use format: "English Name (Original Name)" if translated
        const displayName = translated
          ? `${translated.englishName}${translated.originalName !== translated.englishName ? ` (${translated.originalName})` : ""}`
          : e.name;

        return {
          name: displayName,
          description: e.description,
          address: e.address,
          coordinates: e.coordinates!,
          type: e.type,
          day: e.day || 1,
          order: index, // Preserve original order
        };
      });

    // Sort locations by day, then by order within each day
    locations = locations.sort((a, b) => {
      if (a.day !== b.day) {
        return a.day - b.day;
      }
      return a.order - b.order;
    });

    // Re-assign order numbers within each day for proper sequencing
    const dayGroups = new Map<number, typeof locations>();
    for (const loc of locations) {
      if (!dayGroups.has(loc.day)) {
        dayGroups.set(loc.day, []);
      }
      dayGroups.get(loc.day)!.push(loc);
    }

    // Assign sequential order within each day
    let globalOrder = 0;
    const sortedLocations: typeof locations = [];
    const days = Array.from(dayGroups.keys()).sort((a, b) => a - b);
    
    for (const day of days) {
      const dayLocs = dayGroups.get(day) || [];
      dayLocs.forEach((loc, idx) => {
        sortedLocations.push({
          ...loc,
          order: globalOrder++,
        });
      });
    }

    // Use translated flights and trains if available
    const flights = translation?.flights || extraction?.flights || [];
    const trains = translation?.trains || extraction?.trains || [];

    // Determine trip type based on content
    const tripType = this.determineTripType(sortedLocations, flights);

    // Get detected language for message
    const detectedLanguage = translation?.detectedLanguage || "Unknown";

    // Calculate estimated days
    const maxDay = sortedLocations.length > 0 
      ? Math.max(...sortedLocations.map((l) => l.day))
      : translation?.estimatedDays || extraction?.estimatedDays || 1;

    return {
      locations: sortedLocations,
      flights,
      trains,
      distances,
      tripType,
      estimatedDays: maxDay,
      message: this.generateSummaryMessage(sortedLocations, flights, trains, detectedLanguage),
    };
  }

  private determineTripType(
    locations: CrewOutput["locations"],
    flights: CrewOutput["flights"]
  ): string {
    const days = new Set(locations.map((l) => l.day)).size;
    const hasFlights = flights.length > 0;

    if (hasFlights && days > 1) {
      return "multi_city";
    } else if (days > 1) {
      return "road_trip";
    } else if (locations.length > 5) {
      return "city_tour";
    }
    return "day_trip";
  }

  private generateSummaryMessage(
    locations: CrewOutput["locations"],
    flights: CrewOutput["flights"],
    trains: CrewOutput["trains"],
    detectedLanguage?: string
  ): string {
    const parts: string[] = [];

    if (locations.length > 0) {
      const cities = [...new Set(locations.filter((l) => l.type === "city").map((l) => l.name))];
      const attractions = locations.filter((l) => l.type === "attraction").length;
      const hotels = locations.filter((l) => l.type === "hotel").length;

      if (cities.length > 0) {
        parts.push(`${cities.length} cit${cities.length > 1 ? "ies" : "y"} (${cities.slice(0, 3).join(", ")}${cities.length > 3 ? "..." : ""})`);
      }
      if (attractions > 0) {
        parts.push(`${attractions} attraction${attractions > 1 ? "s" : ""}`);
      }
      if (hotels > 0) {
        parts.push(`${hotels} hotel${hotels > 1 ? "s" : ""}`);
      }
    }

    if (flights.length > 0) {
      parts.push(`${flights.length} flight${flights.length > 1 ? "s" : ""}`);
    }

    if (trains.length > 0) {
      parts.push(`${trains.length} train${trains.length > 1 ? "s" : ""}`);
    }

    if (parts.length === 0) {
      return "Document processed. No travel information could be extracted.";
    }

    const languageNote = detectedLanguage && detectedLanguage !== "English" && detectedLanguage !== "unknown"
      ? ` (translated from ${detectedLanguage})`
      : "";

    return `Extracted: ${parts.join(", ")}${languageNote}`;
  }

  private createErrorOutput(error: string): CrewOutput {
    return {
      locations: [],
      flights: [],
      trains: [],
      distances: [],
      tripType: "unknown",
      estimatedDays: 0,
      message: `Error: ${error}`,
    };
  }
}
