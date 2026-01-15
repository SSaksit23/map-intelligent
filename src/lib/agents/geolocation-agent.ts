/**
 * Geolocation Agent
 * Responsible for finding coordinates for extracted entities
 * Uses multiple sources: API Ninjas (airports), Nominatim (general), AI fallback
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
  GeolocatedEntity,
} from "./types";

// Known tourist attractions cache (for reliable coordinates)
// Uses multiple name variants - Chinese (Simplified/Traditional), Pinyin, English
const ATTRACTION_CACHE: Record<string, { lat: number; lng: number; name: string }> = {
  // Xinjiang attractions - Chinese names
  "天山天池": { lat: 43.8833, lng: 88.1167, name: "Tianshan Tianchi Lake" },
  "天池": { lat: 43.8833, lng: 88.1167, name: "Tianshan Tianchi Lake" },
  "賽里木湖": { lat: 44.6000, lng: 81.1667, name: "Sayram Lake" },
  "赛里木湖": { lat: 44.6000, lng: 81.1667, name: "Sayram Lake" },
  "喀拉峻": { lat: 43.0667, lng: 82.9833, name: "Kalajun Grassland" },
  "喀拉峻草原": { lat: 43.0667, lng: 82.9833, name: "Kalajun Grassland" },
  "那拉提": { lat: 43.2500, lng: 84.0000, name: "Nalati Grassland" },
  "那拉提草原": { lat: 43.2500, lng: 84.0000, name: "Nalati Grassland" },
  "獨庫公路": { lat: 42.9500, lng: 84.8000, name: "Duku Highway" },
  "独库公路": { lat: 42.9500, lng: 84.8000, name: "Duku Highway" },
  "國際大巴扎": { lat: 43.7900, lng: 87.5900, name: "International Grand Bazaar" },
  "国际大巴扎": { lat: 43.7900, lng: 87.5900, name: "International Grand Bazaar" },
  "大巴扎": { lat: 43.7900, lng: 87.5900, name: "International Grand Bazaar" },
  "汗血寶馬基地": { lat: 43.8000, lng: 87.6000, name: "Akhal-Teke Horse Base" },
  "汗血宝马基地": { lat: 43.8000, lng: 87.6000, name: "Akhal-Teke Horse Base" },
  "巴音布魯克": { lat: 42.9833, lng: 84.1500, name: "Bayinbulak Grassland" },
  "巴音布鲁克": { lat: 42.9833, lng: 84.1500, name: "Bayinbulak Grassland" },
  "果子溝": { lat: 44.4333, lng: 81.2333, name: "Guozigou Bridge" },
  "果子沟": { lat: 44.4333, lng: 81.2333, name: "Guozigou Bridge" },
  "喀納斯": { lat: 48.7167, lng: 87.0167, name: "Kanas Lake" },
  "喀纳斯": { lat: 48.7167, lng: 87.0167, name: "Kanas Lake" },
  "禾木": { lat: 48.8333, lng: 86.8333, name: "Hemu Village" },
  "禾木村": { lat: 48.8333, lng: 86.8333, name: "Hemu Village" },
  "火焰山": { lat: 42.9333, lng: 89.1833, name: "Flaming Mountains" },
  "特克斯八卦城": { lat: 43.2167, lng: 81.8333, name: "Tekes Bagua City" },
  "八卦城": { lat: 43.2167, lng: 81.8333, name: "Tekes Bagua City" },
  "薰衣草": { lat: 44.0000, lng: 81.3333, name: "Lavender Farm Yili" },
  "伊犁": { lat: 43.9167, lng: 81.2833, name: "Yining (Ili)" },
  // Xinjiang cities - Chinese
  "烏魯木齊": { lat: 43.8256, lng: 87.6168, name: "Urumqi" },
  "乌鲁木齐": { lat: 43.8256, lng: 87.6168, name: "Urumqi" },
  "伊寧": { lat: 43.9167, lng: 81.2833, name: "Yining" },
  "伊宁": { lat: 43.9167, lng: 81.2833, name: "Yining" },
  "昭蘇": { lat: 43.1500, lng: 81.1167, name: "Zhaosu" },
  "昭苏": { lat: 43.1500, lng: 81.1167, name: "Zhaosu" },
  "特克斯": { lat: 43.2167, lng: 81.8333, name: "Tekes" },
  "新源": { lat: 43.4333, lng: 83.2500, name: "Xinyuan" },
  "霍爾果斯": { lat: 44.2000, lng: 80.4167, name: "Khorgos" },
  "霍尔果斯": { lat: 44.2000, lng: 80.4167, name: "Khorgos" },
  "庫車": { lat: 41.7167, lng: 82.9667, name: "Kuqa" },
  "库车": { lat: 41.7167, lng: 82.9667, name: "Kuqa" },
  "吐魯番": { lat: 42.9500, lng: 89.1833, name: "Turpan" },
  "吐鲁番": { lat: 42.9500, lng: 89.1833, name: "Turpan" },
  "廣州": { lat: 23.1291, lng: 113.2644, name: "Guangzhou" },
  "广州": { lat: 23.1291, lng: 113.2644, name: "Guangzhou" },
  // Xinjiang attractions - English/Pinyin names
  "tianshan tianchi lake": { lat: 43.8833, lng: 88.1167, name: "Tianshan Tianchi Lake" },
  "tianchi lake": { lat: 43.8833, lng: 88.1167, name: "Tianshan Tianchi Lake" },
  "tianchi": { lat: 43.8833, lng: 88.1167, name: "Tianshan Tianchi Lake" },
  "heavenly lake": { lat: 43.8833, lng: 88.1167, name: "Tianshan Tianchi Lake" },
  "sayram lake": { lat: 44.6000, lng: 81.1667, name: "Sayram Lake" },
  "sailimu lake": { lat: 44.6000, lng: 81.1667, name: "Sayram Lake" },
  "sailim lake": { lat: 44.6000, lng: 81.1667, name: "Sayram Lake" },
  "kalajun grassland": { lat: 43.0667, lng: 82.9833, name: "Kalajun Grassland" },
  "kalajun": { lat: 43.0667, lng: 82.9833, name: "Kalajun Grassland" },
  "kalajon": { lat: 43.0667, lng: 82.9833, name: "Kalajun Grassland" },
  "nalati grassland": { lat: 43.2500, lng: 84.0000, name: "Nalati Grassland" },
  "nalati": { lat: 43.2500, lng: 84.0000, name: "Nalati Grassland" },
  "narati": { lat: 43.2500, lng: 84.0000, name: "Nalati Grassland" },
  "narat grassland": { lat: 43.2500, lng: 84.0000, name: "Nalati Grassland" },
  "duku highway": { lat: 42.9500, lng: 84.8000, name: "Duku Highway" },
  "duku road": { lat: 42.9500, lng: 84.8000, name: "Duku Highway" },
  "duku": { lat: 42.9500, lng: 84.8000, name: "Duku Highway" },
  "international grand bazaar": { lat: 43.7900, lng: 87.5900, name: "International Grand Bazaar" },
  "grand bazaar urumqi": { lat: 43.7900, lng: 87.5900, name: "International Grand Bazaar" },
  "grand bazaar": { lat: 43.7900, lng: 87.5900, name: "International Grand Bazaar" },
  "bayinbulak grassland": { lat: 42.9833, lng: 84.1500, name: "Bayinbulak Grassland" },
  "bayinbulak": { lat: 42.9833, lng: 84.1500, name: "Bayinbulak Grassland" },
  "bayinbuluk": { lat: 42.9833, lng: 84.1500, name: "Bayinbulak Grassland" },
  "guozigou bridge": { lat: 44.4333, lng: 81.2333, name: "Guozigou Bridge" },
  "guozi valley": { lat: 44.4333, lng: 81.2333, name: "Guozigou Bridge" },
  "guozigou": { lat: 44.4333, lng: 81.2333, name: "Guozigou Bridge" },
  "kanas lake": { lat: 48.7167, lng: 87.0167, name: "Kanas Lake" },
  "kanasi lake": { lat: 48.7167, lng: 87.0167, name: "Kanas Lake" },
  "kanas": { lat: 48.7167, lng: 87.0167, name: "Kanas Lake" },
  "hemu village": { lat: 48.8333, lng: 86.8333, name: "Hemu Village" },
  "hemu": { lat: 48.8333, lng: 86.8333, name: "Hemu Village" },
  "flaming mountains": { lat: 42.9333, lng: 89.1833, name: "Flaming Mountains" },
  "flame mountain": { lat: 42.9333, lng: 89.1833, name: "Flaming Mountains" },
  "tekes bagua city": { lat: 43.2167, lng: 81.8333, name: "Tekes Bagua City" },
  "bagua city": { lat: 43.2167, lng: 81.8333, name: "Tekes Bagua City" },
  "lavender farm": { lat: 44.0000, lng: 81.3333, name: "Lavender Farm Yili" },
  "akhal-teke horse base": { lat: 43.8000, lng: 87.6000, name: "Akhal-Teke Horse Base" },
  "heavenly horse base": { lat: 43.8000, lng: 87.6000, name: "Akhal-Teke Horse Base" },
  "akhal teke": { lat: 43.8000, lng: 87.6000, name: "Akhal-Teke Horse Base" },
  "blood sweating horse": { lat: 43.8000, lng: 87.6000, name: "Akhal-Teke Horse Base" },
  // Xinjiang cities - English/Pinyin
  "urumqi": { lat: 43.8256, lng: 87.6168, name: "Urumqi" },
  "wulumuqi": { lat: 43.8256, lng: 87.6168, name: "Urumqi" },
  "yining": { lat: 43.9167, lng: 81.2833, name: "Yining" },
  "ili": { lat: 43.9167, lng: 81.2833, name: "Yining (Ili)" },
  "yili": { lat: 43.9167, lng: 81.2833, name: "Yining (Ili)" },
  "zhaosu": { lat: 43.1500, lng: 81.1167, name: "Zhaosu" },
  "tekes": { lat: 43.2167, lng: 81.8333, name: "Tekes" },
  "xinyuan": { lat: 43.4333, lng: 83.2500, name: "Xinyuan" },
  "khorgos": { lat: 44.2000, lng: 80.4167, name: "Khorgos" },
  "horgos": { lat: 44.2000, lng: 80.4167, name: "Khorgos" },
  "kuqa": { lat: 41.7167, lng: 82.9667, name: "Kuqa" },
  "kuche": { lat: 41.7167, lng: 82.9667, name: "Kuqa" },
  "turpan": { lat: 42.9500, lng: 89.1833, name: "Turpan" },
  "turfan": { lat: 42.9500, lng: 89.1833, name: "Turpan" },
  // Other common destinations
  "bangkok": { lat: 13.7563, lng: 100.5018, name: "Bangkok" },
  "guangzhou": { lat: 23.1291, lng: 113.2644, name: "Guangzhou" },
  "xian": { lat: 34.3416, lng: 108.9398, name: "Xi'an" },
  "beijing": { lat: 39.9042, lng: 116.4074, name: "Beijing" },
  "shanghai": { lat: 31.2304, lng: 121.4737, name: "Shanghai" },
  "chengdu": { lat: 30.5728, lng: 104.0668, name: "Chengdu" },
  "北京": { lat: 39.9042, lng: 116.4074, name: "Beijing" },
  "上海": { lat: 31.2304, lng: 121.4737, name: "Shanghai" },
  "成都": { lat: 30.5728, lng: 104.0668, name: "Chengdu" },
  "西安": { lat: 34.3416, lng: 108.9398, name: "Xi'an" },
  "曼谷": { lat: 13.7563, lng: 100.5018, name: "Bangkok" },
};

// Airport data cache
const AIRPORT_CACHE: Record<string, { lat: number; lng: number; name: string; city: string }> = {
  // Asia
  BKK: { lat: 13.6900, lng: 100.7501, name: "Suvarnabhumi International Airport", city: "Bangkok" },
  DMK: { lat: 13.9126, lng: 100.6067, name: "Don Mueang International Airport", city: "Bangkok" },
  XIY: { lat: 34.4471, lng: 108.7516, name: "Xi'an Xianyang International Airport", city: "Xi'an" },
  CAN: { lat: 23.3924, lng: 113.2988, name: "Guangzhou Baiyun International Airport", city: "Guangzhou" },
  PEK: { lat: 40.0799, lng: 116.6031, name: "Beijing Capital International Airport", city: "Beijing" },
  PKX: { lat: 39.5098, lng: 116.4105, name: "Beijing Daxing International Airport", city: "Beijing" },
  PVG: { lat: 31.1443, lng: 121.8083, name: "Shanghai Pudong International Airport", city: "Shanghai" },
  SHA: { lat: 31.1979, lng: 121.3363, name: "Shanghai Hongqiao International Airport", city: "Shanghai" },
  HKG: { lat: 22.3080, lng: 113.9185, name: "Hong Kong International Airport", city: "Hong Kong" },
  NRT: { lat: 35.7647, lng: 140.3864, name: "Narita International Airport", city: "Tokyo" },
  HND: { lat: 35.5533, lng: 139.7811, name: "Haneda Airport", city: "Tokyo" },
  KIX: { lat: 34.4347, lng: 135.2440, name: "Kansai International Airport", city: "Osaka" },
  ICN: { lat: 37.4602, lng: 126.4407, name: "Incheon International Airport", city: "Seoul" },
  SIN: { lat: 1.3644, lng: 103.9915, name: "Singapore Changi Airport", city: "Singapore" },
  KUL: { lat: 2.7456, lng: 101.7099, name: "Kuala Lumpur International Airport", city: "Kuala Lumpur" },
  SGN: { lat: 10.8188, lng: 106.6519, name: "Tan Son Nhat International Airport", city: "Ho Chi Minh City" },
  HAN: { lat: 21.2212, lng: 105.8072, name: "Noi Bai International Airport", city: "Hanoi" },
  URC: { lat: 43.9071, lng: 87.4742, name: "Ürümqi Diwopu International Airport", city: "Ürümqi" },
  YNJ: { lat: 42.8828, lng: 129.4513, name: "Yanji Chaoyangchuan Airport", city: "Yanji" },
  CTU: { lat: 30.5785, lng: 103.9471, name: "Chengdu Shuangliu International Airport", city: "Chengdu" },
  TFU: { lat: 30.3194, lng: 104.4456, name: "Chengdu Tianfu International Airport", city: "Chengdu" },
  SZX: { lat: 22.6393, lng: 113.8107, name: "Shenzhen Bao'an International Airport", city: "Shenzhen" },
  HGH: { lat: 30.2295, lng: 120.4344, name: "Hangzhou Xiaoshan International Airport", city: "Hangzhou" },
  // Middle East
  DXB: { lat: 25.2532, lng: 55.3657, name: "Dubai International Airport", city: "Dubai" },
  DOH: { lat: 25.2731, lng: 51.6080, name: "Hamad International Airport", city: "Doha" },
  // Europe
  LHR: { lat: 51.4700, lng: -0.4543, name: "London Heathrow Airport", city: "London" },
  CDG: { lat: 49.0097, lng: 2.5479, name: "Paris Charles de Gaulle Airport", city: "Paris" },
  FRA: { lat: 50.0379, lng: 8.5622, name: "Frankfurt Airport", city: "Frankfurt" },
  AMS: { lat: 52.3105, lng: 4.7683, name: "Amsterdam Schiphol Airport", city: "Amsterdam" },
  // Americas
  JFK: { lat: 40.6413, lng: -73.7781, name: "John F. Kennedy International Airport", city: "New York" },
  LAX: { lat: 33.9425, lng: -118.4081, name: "Los Angeles International Airport", city: "Los Angeles" },
  ORD: { lat: 41.9742, lng: -87.9073, name: "O'Hare International Airport", city: "Chicago" },
  SFO: { lat: 37.6213, lng: -122.3790, name: "San Francisco International Airport", city: "San Francisco" },
};

// Geocoding result type
interface GeocodeResult {
  lat: number;
  lng: number;
  displayName?: string;
}

export class GeolocationAgent extends BaseAgent {
  private genAI: GoogleGenerativeAI | null = null;
  private apiNinjasKey?: string;

  constructor(context: AgentContext) {
    super(
      {
        name: "GeolocationAgent",
        goal: "Find accurate coordinates for all extracted travel entities using multiple data sources",
        backstory: `You are a geolocation expert with access to multiple mapping APIs and databases.
        You can locate airports, train stations, hotels, attractions, and cities worldwide.
        You prioritize accuracy and always cross-reference multiple sources when possible.
        For airports, you use IATA code databases. For other locations, you use geocoding services.`,
        verbose: true,
      },
      context
    );

    if (context.apiKeys.gemini) {
      this.genAI = new GoogleGenerativeAI(context.apiKeys.gemini);
    }
    this.apiNinjasKey = context.apiKeys.apiNinjas;
  }

  async execute(task: Task): Promise<TaskResult<GeolocatedEntity[]>> {
    const startTime = Date.now();
    this.log("Starting geolocation task", { taskId: task.id });

    try {
      // Get translation results (preferred) or extraction results
      const translationResult = this.getPreviousResult<{
        entities: Array<ExtractedEntity & {
          originalName?: string;
          englishName?: string;
          standardizedName?: string;
          country?: string;
          region?: string;
        }>;
        flights: ExtractedFlight[];
        trains: ExtractedTrain[];
      }>("translation");

      const extractionResult = this.getPreviousResult<{
        entities: ExtractedEntity[];
        flights: ExtractedFlight[];
        trains: ExtractedTrain[];
      }>("doc-extraction");

      // Use translation results if available, otherwise fall back to extraction
      const sourceData = translationResult || extractionResult;

      if (!sourceData) {
        return this.error("No extraction or translation results available");
      }

      const geolocatedEntities: GeolocatedEntity[] = [];

      // Process flights - get airport coordinates
      this.log(`Processing ${sourceData.flights.length} flights`);
      for (const flight of sourceData.flights) {
        // Departure airport
        const depCoords = await this.getAirportCoordinates(flight.departureCode);
        if (depCoords) {
          geolocatedEntities.push({
            name: flight.departureAirport || `${flight.departureCode} Airport`,
            type: "airport",
            day: flight.day,
            coordinates: depCoords,
            confidence: 0.95,
            source: "api",
            metadata: { flightNumber: flight.flightNumber, role: "departure" },
          });
        }

        // Arrival airport
        const arrCoords = await this.getAirportCoordinates(flight.arrivalCode);
        if (arrCoords) {
          geolocatedEntities.push({
            name: flight.arrivalAirport || `${flight.arrivalCode} Airport`,
            type: "airport",
            day: flight.day,
            coordinates: arrCoords,
            confidence: 0.95,
            source: "api",
            metadata: { flightNumber: flight.flightNumber, role: "arrival" },
          });
        }
      }

      // Process trains - geocode stations
      this.log(`Processing ${sourceData.trains.length} trains`);
      for (const train of sourceData.trains) {
        // Departure station
        const depCoords = await this.geocodeLocation(`${train.departureStation} railway station`);
        if (depCoords) {
          geolocatedEntities.push({
            name: train.departureStation,
            type: "station",
            day: train.day,
            coordinates: depCoords,
            confidence: 0.8,
            source: "api",
            metadata: { trainNumber: train.trainNumber, role: "departure" },
          });
        }

        // Arrival station
        const arrCoords = await this.geocodeLocation(`${train.arrivalStation} railway station`);
        if (arrCoords) {
          geolocatedEntities.push({
            name: train.arrivalStation,
            type: "station",
            day: train.day,
            coordinates: arrCoords,
            confidence: 0.8,
            source: "api",
            metadata: { trainNumber: train.trainNumber, role: "arrival" },
          });
        }
      }

      // Process other entities
      this.log(`Processing ${sourceData.entities.length} other entities`);
      for (const entity of sourceData.entities) {
        // Skip flights and trains - already processed
        if (entity.type === "flight" || entity.type === "train") continue;

        // Use standardizedName for geocoding if available (from translation)
        const translatedEntity = entity as ExtractedEntity & {
          originalName?: string;
          englishName?: string;
          standardizedName?: string;
          country?: string;
          region?: string;
        };

        const coords = await this.geocodeEntity(entity, translatedEntity.standardizedName);
        if (coords) {
          geolocatedEntities.push({
            ...entity,
            coordinates: coords.coordinates,
            confidence: coords.confidence,
            source: coords.source,
            address: coords.address,
            description: translatedEntity.englishName || entity.name,
          });
        } else {
          // Try harder to find coordinates - use AI as last resort
          this.log(`Failed to geocode "${entity.name}", trying AI fallback...`);
          const aiResult = this.genAI ? await this.aiGeocode(entity, translatedEntity.standardizedName || translatedEntity.englishName) : null;
          
          if (aiResult) {
            geolocatedEntities.push({
              ...entity,
              coordinates: aiResult,
              confidence: 0.6,
              source: "ai",
              description: translatedEntity.englishName || entity.name,
            });
          } else {
            // Still include the entity without coordinates - but log it
            this.log(`Could not find coordinates for "${entity.name}" - skipping`);
          }
        }
      }

      // Store results for distance calculator
      this.setSharedMemory("geolocatedEntities", geolocatedEntities);

      const executionTime = Date.now() - startTime;
      this.log(`Geolocation complete in ${executionTime}ms`, {
        total: geolocatedEntities.length,
        withCoords: geolocatedEntities.filter((e) => e.coordinates).length,
      });

      return this.success(geolocatedEntities, executionTime);
    } catch (error) {
      this.log("Geolocation failed", error);
      return this.error(`Geolocation failed: ${error}`);
    }
  }

  private async getAirportCoordinates(
    iataCode: string
  ): Promise<{ lat: number; lng: number } | null> {
    const code = iataCode.toUpperCase();

    // Check cache first
    if (AIRPORT_CACHE[code]) {
      this.log(`Airport ${code} found in cache`);
      return { lat: AIRPORT_CACHE[code].lat, lng: AIRPORT_CACHE[code].lng };
    }

    // Try API Ninjas
    if (this.apiNinjasKey) {
      try {
        const response = await fetch(
          `https://api.api-ninjas.com/v1/airports?iata=${code}`,
          {
            headers: { "X-Api-Key": this.apiNinjasKey },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            this.log(`Airport ${code} found via API Ninjas`);
            return { lat: data[0].latitude, lng: data[0].longitude };
          }
        }
      } catch (e) {
        this.log(`API Ninjas lookup failed for ${code}`, e);
      }
    }

    // Try geocoding as fallback
    const geoResult = await this.geocodeLocation(`${code} airport`);
    if (geoResult) {
      this.log(`Airport ${code} found via geocoding`);
      return geoResult;
    }

    this.log(`Could not find coordinates for airport ${code}`);
    return null;
  }

  private async geocodeLocation(query: string): Promise<GeocodeResult | null> {
    // Try with China region hint for Chinese locations
    const searchQueries = [
      query,
      `${query}, China`,
      `${query}, Xinjiang, China`,
      `${query}, 中国`,
    ];

    for (const searchQuery of searchQueries) {
      try {
        // Use Nominatim (OpenStreetMap) for geocoding
        const response = await fetch(
          `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}&limit=1&accept-language=en`,
          {
            headers: {
              "User-Agent": "TripPlanner/1.0",
            },
          }
        );

        if (response.ok) {
          const data = await response.json();
          if (data && data.length > 0) {
            this.log(`Geocoded "${query}" via "${searchQuery}"`);
            return {
              lat: parseFloat(data[0].lat),
              lng: parseFloat(data[0].lon),
              displayName: data[0].display_name,
            };
          }
        }
      } catch (e) {
        this.log(`Geocoding attempt failed for "${searchQuery}"`, e);
      }

      // Small delay between requests to respect rate limits
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    this.log(`Could not geocode: "${query}"`);
    return null;
  }

  private async geocodeEntity(
    entity: ExtractedEntity,
    standardizedName?: string
  ): Promise<{
    coordinates: { lat: number; lng: number };
    confidence: number;
    source: "api" | "ai" | "fallback";
    address?: string;
  } | null> {
    // Use standardized name if provided (from translation), otherwise build from entity
    let searchQuery = standardizedName || entity.name;

    // If no standardized name, add type hints
    if (!standardizedName) {
      if (entity.type === "hotel") {
        searchQuery = `${entity.name} hotel`;
      } else if (entity.type === "restaurant") {
        searchQuery = `${entity.name} restaurant`;
      } else if (entity.type === "station") {
        searchQuery = `${entity.name} railway station`;
      } else if (entity.type === "airport") {
        searchQuery = `${entity.name} airport`;
      }
    }

    this.log(`Geocoding: "${searchQuery}" (original: "${entity.name}")`);

    // Check attraction cache first (fastest, most reliable for known locations)
    const cacheKey = searchQuery.toLowerCase().trim();
    if (ATTRACTION_CACHE[cacheKey]) {
      const cached = ATTRACTION_CACHE[cacheKey];
      this.log(`Found in attraction cache: ${cached.name}`);
      return {
        coordinates: { lat: cached.lat, lng: cached.lng },
        confidence: 0.95,
        source: "api",
        address: cached.name,
      };
    }

    // Also check partial matches in cache
    for (const [key, value] of Object.entries(ATTRACTION_CACHE)) {
      if (cacheKey.includes(key) || key.includes(cacheKey)) {
        this.log(`Partial match in attraction cache: ${value.name}`);
        return {
          coordinates: { lat: value.lat, lng: value.lng },
          confidence: 0.9,
          source: "api",
          address: value.name,
        };
      }
    }

    // Try Nominatim geocoding
    const geoResult = await this.geocodeLocation(searchQuery);
    if (geoResult) {
      return {
        coordinates: { lat: geoResult.lat, lng: geoResult.lng },
        confidence: 0.85,
        source: "api",
        address: geoResult.displayName,
      };
    }

    // Try AI-based geocoding as fallback
    if (this.genAI) {
      const aiResult = await this.aiGeocode(entity, standardizedName);
      if (aiResult) {
        return {
          coordinates: aiResult,
          confidence: 0.6,
          source: "ai",
        };
      }
    }

    return null;
  }

  private async aiGeocode(
    entity: ExtractedEntity,
    standardizedName?: string
  ): Promise<{ lat: number; lng: number } | null> {
    if (!this.genAI) return null;

    try {
      const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

      const locationName = standardizedName || entity.name;

      const prompt = `You are a geolocation expert. Provide the approximate coordinates for this location.

Location: "${locationName}"
Type: ${entity.type}

Respond with ONLY a JSON object in this format:
{"lat": <latitude as number>, "lng": <longitude as number>}

If you cannot determine the coordinates, respond with: {"lat": null, "lng": null}`;

      const result = await model.generateContent(prompt);
      const responseText = result.response.text();

      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (
          typeof parsed.lat === "number" &&
          typeof parsed.lng === "number" &&
          parsed.lat !== 0 &&
          parsed.lng !== 0
        ) {
          this.log(`AI geocoded "${locationName}": ${parsed.lat}, ${parsed.lng}`);
          return { lat: parsed.lat, lng: parsed.lng };
        }
      }
    } catch (e) {
      this.log(`AI geocoding failed for "${entity.name}"`, e);
    }

    return null;
  }
}
