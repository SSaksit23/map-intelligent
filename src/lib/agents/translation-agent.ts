/**
 * Translation Agent
 * Responsible for translating and standardizing location names
 * Works after DocExtractionAgent to prepare data for GeolocationAgent
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { BaseAgent } from "./base-agent";
import type {
  AgentContext,
  Task,
  TaskResult,
  ExtractedEntity,
  ExtractedFlight,
  ExtractedTrain,
  DocExtractionResult,
} from "./types";

// Translated entity with both original and English names
export interface TranslatedEntity extends ExtractedEntity {
  originalName: string;
  englishName: string;
  standardizedName: string; // For geocoding
  country?: string;
  region?: string;
}

export interface TranslationResult {
  entities: TranslatedEntity[];
  flights: ExtractedFlight[];
  trains: ExtractedTrain[];
  detectedLanguage: string;
  estimatedDays: number;
}

export class TranslationAgent extends BaseAgent {
  private genAI: GoogleGenerativeAI;

  constructor(context: AgentContext) {
    super(
      {
        name: "TranslationAgent",
        goal: "Translate and standardize location names from any language to English for accurate geocoding",
        backstory: `You are a multilingual translation expert specializing in travel and geography.
        You can translate location names from Chinese, Thai, Japanese, Korean, and other languages
        to English while preserving the original name. You also identify the country and region
        for each location to improve geocoding accuracy.`,
        verbose: true,
      },
      context
    );

    if (!context.apiKeys.gemini) {
      throw new Error("Gemini API key is required for TranslationAgent");
    }
    this.genAI = new GoogleGenerativeAI(context.apiKeys.gemini);
  }

  async execute(task: Task): Promise<TaskResult<TranslationResult>> {
    const startTime = Date.now();
    this.log("Starting translation task", { taskId: task.id });

    try {
      // Get extraction results from previous task
      const extractionResult = this.getPreviousResult<DocExtractionResult>("doc-extraction");

      if (!extractionResult) {
        return this.error("No extraction results available for translation") as TaskResult<TranslationResult>;
      }

      // Detect language from entities
      const detectedLanguage = await this.detectLanguage(extractionResult.entities);
      this.log(`Detected language: ${detectedLanguage}`);

      // Translate entities
      const translatedEntities = await this.translateEntities(
        extractionResult.entities,
        detectedLanguage
      );

      // Translate flight airport names if needed
      const translatedFlights = await this.translateFlights(extractionResult.flights);

      // Translate train station names if needed
      const translatedTrains = await this.translateTrains(extractionResult.trains);

      // Store results for geolocation agent
      this.setSharedMemory("translatedEntities", translatedEntities);
      this.setSharedMemory("detectedLanguage", detectedLanguage);

      const executionTime = Date.now() - startTime;
      this.log(`Translation complete in ${executionTime}ms`, {
        entities: translatedEntities.length,
        language: detectedLanguage,
      });

      return this.success(
        {
          entities: translatedEntities,
          flights: translatedFlights,
          trains: translatedTrains,
          detectedLanguage,
          estimatedDays: extractionResult.estimatedDays,
        },
        executionTime
      );
    } catch (error) {
      this.log("Translation failed", error);
      return this.error(`Translation failed: ${error}`) as TaskResult<TranslationResult>;
    }
  }

  private async detectLanguage(entities: ExtractedEntity[]): Promise<string> {
    if (entities.length === 0) return "unknown";

    // Sample some entity names
    const sampleNames = entities.slice(0, 5).map((e) => e.name).join(", ");

    const model = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const prompt = `Detect the primary language of these location names:
"${sampleNames}"

Respond with ONLY the language name in English (e.g., "Chinese", "Thai", "Japanese", "Korean", "English", "Spanish", etc.)`;

    try {
      const result = await model.generateContent(prompt);
      const language = result.response.text().trim();
      return language || "unknown";
    } catch {
      return "unknown";
    }
  }

  private async translateEntities(
    entities: ExtractedEntity[],
    sourceLanguage: string
  ): Promise<TranslatedEntity[]> {
    if (entities.length === 0) return [];

    // If already English, just standardize
    if (sourceLanguage.toLowerCase() === "english") {
      return entities.map((e) => ({
        ...e,
        originalName: e.name,
        englishName: e.name,
        standardizedName: e.name,
      }));
    }

    const model = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    // Batch translate for efficiency
    const entityNames = entities.map((e) => e.name);

    const prompt = `Translate these ${sourceLanguage} location names to English. 
For each location, provide:
1. The English translation
2. A standardized search name (for maps/geocoding)
3. The country and region if identifiable

Locations to translate:
${entityNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Respond in JSON format:
{
  "translations": [
    {
      "original": "original name",
      "english": "English translation",
      "standardized": "standardized name for geocoding (e.g., 'Tianchi Lake, Xinjiang, China')",
      "country": "country name or null",
      "region": "region/province or null"
    }
  ]
}

IMPORTANT:
- For Chinese locations, include pinyin in the English name
- For tourist attractions, include the type (Lake, Mountain, Grassland, etc.)
- Standardized name should be optimized for geocoding services
- Return ONLY valid JSON`;

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const translations = parsed.translations || [];

        return entities.map((entity, index) => {
          const translation = translations[index] || {};
          return {
            ...entity,
            originalName: entity.name,
            englishName: translation.english || entity.name,
            standardizedName: translation.standardized || translation.english || entity.name,
            country: translation.country,
            region: translation.region,
          };
        });
      }
    } catch (e) {
      this.log("Batch translation failed, falling back to individual", e);
    }

    // Fallback: translate individually
    return Promise.all(
      entities.map((entity) => this.translateSingleEntity(entity, sourceLanguage))
    );
  }

  private async translateSingleEntity(
    entity: ExtractedEntity,
    sourceLanguage: string
  ): Promise<TranslatedEntity> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const prompt = `Translate this ${sourceLanguage} location name to English:
"${entity.name}"

Type: ${entity.type}

Respond in JSON:
{
  "english": "English name with type (e.g., 'Tianchi Lake' not just 'Tianchi')",
  "standardized": "name optimized for geocoding (e.g., 'Tianchi Lake, Xinjiang, China')",
  "country": "country name or null",
  "region": "region/province or null"
}`;

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          ...entity,
          originalName: entity.name,
          englishName: parsed.english || entity.name,
          standardizedName: parsed.standardized || parsed.english || entity.name,
          country: parsed.country,
          region: parsed.region,
        };
      }
    } catch (e) {
      this.log(`Translation failed for "${entity.name}"`, e);
    }

    // Fallback: return as-is
    return {
      ...entity,
      originalName: entity.name,
      englishName: entity.name,
      standardizedName: entity.name,
    };
  }

  private async translateFlights(flights: ExtractedFlight[]): Promise<ExtractedFlight[]> {
    // Flights usually have IATA codes which don't need translation
    // But airport names might need translation
    if (flights.length === 0) return [];

    const model = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const airportNames = flights
      .flatMap((f) => [f.departureAirport, f.arrivalAirport])
      .filter((n) => n)
      .filter((n, i, arr) => arr.indexOf(n) === i); // Unique

    if (airportNames.length === 0) return flights;

    const prompt = `Translate these airport names to English if they are not already in English:
${airportNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Respond in JSON:
{
  "translations": {
    "original name": "English name"
  }
}`;

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const translations = parsed.translations || {};

        return flights.map((flight) => ({
          ...flight,
          departureAirport: translations[flight.departureAirport || ""] || flight.departureAirport,
          arrivalAirport: translations[flight.arrivalAirport || ""] || flight.arrivalAirport,
        }));
      }
    } catch (e) {
      this.log("Flight airport translation failed", e);
    }

    return flights;
  }

  private async translateTrains(trains: ExtractedTrain[]): Promise<ExtractedTrain[]> {
    if (trains.length === 0) return [];

    const model = this.genAI.getGenerativeModel({ model: "gemini-flash-latest" });

    const stationNames = trains
      .flatMap((t) => [t.departureStation, t.arrivalStation])
      .filter((n) => n)
      .filter((n, i, arr) => arr.indexOf(n) === i); // Unique

    if (stationNames.length === 0) return trains;

    const prompt = `Translate these train station names to English if they are not already in English:
${stationNames.map((n, i) => `${i + 1}. ${n}`).join("\n")}

Respond in JSON:
{
  "translations": {
    "original name": "English name (include 'Station' or 'Railway Station' suffix)"
  }
}`;

    try {
      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const translations = parsed.translations || {};

        return trains.map((train) => ({
          ...train,
          departureStation: translations[train.departureStation] || train.departureStation,
          arrivalStation: translations[train.arrivalStation] || train.arrivalStation,
        }));
      }
    } catch (e) {
      this.log("Train station translation failed", e);
    }

    return trains;
  }
}
