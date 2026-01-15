/**
 * Document Extraction Agent
 * Responsible for parsing documents and extracting travel entities
 * Role: Extract all travel-related information from various document formats
 */

import { GoogleGenerativeAI } from "@google/generative-ai";
import { BaseAgent } from "./base-agent";
import type {
  AgentContext,
  Task,
  TaskResult,
  DocExtractionResult,
  ExtractedEntity,
  ExtractedFlight,
  ExtractedTrain,
} from "./types";

export class DocExtractionAgent extends BaseAgent {
  private genAI: GoogleGenerativeAI;

  constructor(context: AgentContext) {
    super(
      {
        name: "DocExtractionAgent",
        goal: "Extract all travel-related information from documents including locations, flights, trains, and activities",
        backstory: `You are an expert document analyst specializing in travel itineraries. 
        You can read documents in multiple languages and formats, identifying key travel information 
        like destinations, transportation details, hotels, and activities. You pay close attention 
        to day markers and ensure every piece of information is correctly assigned to its day.`,
        verbose: true,
      },
      context
    );

    if (!context.apiKeys.gemini) {
      throw new Error("Gemini API key is required for DocExtractionAgent");
    }
    this.genAI = new GoogleGenerativeAI(context.apiKeys.gemini);
  }

  async execute(task: Task): Promise<TaskResult<DocExtractionResult>> {
    const startTime = Date.now();
    this.log("Starting document extraction task", { taskId: task.id });

    try {
      // Get the document content from shared memory
      const documentText = this.getSharedMemory<string>("documentText");
      const documentType = this.getSharedMemory<string>("documentType") || "text";
      const imageData = this.getSharedMemory<{ base64: string; mimeType: string }>("imageData");

      if (!documentText && !imageData) {
        return this.error("No document content available for extraction");
      }

      let extractedContent: string;

      if (imageData) {
        // Process image with vision model
        this.log("Processing image document");
        extractedContent = await this.extractFromImage(imageData.base64, imageData.mimeType);
      } else {
        extractedContent = documentText!;
      }

      // Parse the content to extract entities
      this.log("Parsing extracted content for entities");
      const result = await this.parseEntities(extractedContent);

      // Store raw text for other agents
      this.setSharedMemory("extractedRawText", extractedContent);

      const executionTime = Date.now() - startTime;
      this.log(`Extraction complete in ${executionTime}ms`, {
        entities: result.entities.length,
        flights: result.flights.length,
        trains: result.trains.length,
      });

      return this.success(
        {
          ...result,
          rawText: extractedContent,
          documentType,
        },
        executionTime
      );
    } catch (error) {
      this.log("Extraction failed", error);
      return this.error(`Document extraction failed: ${error}`);
    }
  }

  private async extractFromImage(base64Data: string, mimeType: string): Promise<string> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `You are a travel document specialist. Analyze this image and extract ALL travel information.

CRITICAL - This may be a Chinese/Asian travel itinerary. Look for:

DAY MARKERS:
- D1, D2, D3... or 第一天, 第二天, 第三天...
- Day 1, Day 2... or DAY1, DAY2...
- 早上/上午 (morning), 下午 (afternoon), 晚上 (evening)

EXTRACT EVERYTHING:

1. ATTRACTIONS (景點/景区):
   - Lakes: 天池, 賽里木湖, 喀納斯湖
   - Mountains: 天山, 火焰山
   - Grasslands: 那拉提草原, 喀拉峻草原, 巴音布魯克
   - Historic sites: 大巴扎, 古城
   - Roads/Routes: 獨庫公路, 絲綢之路

2. CITIES (城市):
   - 烏魯木齊/乌鲁木齐 (Urumqi)
   - 伊寧/伊宁 (Yining)  
   - 昭蘇/昭苏 (Zhaosu)
   - 特克斯 (Tekes)
   - 新源 (Xinyuan)

3. HOTELS (酒店): Any accommodation mentioned
4. RESTAURANTS (餐廳): Any dining locations
5. FLIGHTS: CZ, MU, CA, etc. + numbers
6. TRAINS: G, D, K, T, Z + numbers

FORMAT YOUR OUTPUT:

=== DAY 1 (第一天) ===
CITY: [main city for this day]
ATTRACTIONS: [list ALL attractions with Chinese + English names]
HOTEL: [hotel name if mentioned]
FLIGHTS: [flight info if any]
MEALS: [breakfast/lunch/dinner locations]

=== DAY 2 (第二天) ===
[same format]

Continue for ALL days. Extract EVERY location mentioned - users need complete itineraries!`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: mimeType,
        },
      },
    ]);

    return result.response.text();
  }

  private async parseEntities(text: string): Promise<Omit<DocExtractionResult, "rawText" | "documentType">> {
    const model = this.genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

    const prompt = `You are an expert travel itinerary parser. Extract ALL travel information from this document.

DOCUMENT:
"""
${text.substring(0, 15000)}
"""

CRITICAL INSTRUCTIONS:
1. This appears to be a Chinese/Asian travel itinerary - pay attention to day markers like:
   - D1, D2, D3... or 第一天, 第二天, 第三天...
   - Day 1, Day 2... or DAY1, DAY2...
   
2. Extract EVERY location mentioned including:
   - Tourist attractions (景點/景区): lakes, mountains, grasslands, historic sites, museums
   - Cities and towns (城市): any city or town name
   - Hotels (酒店/飯店): accommodation names
   - Restaurants (餐廳/餐厅): dining locations
   - Natural landmarks: 天池 (Tianchi Lake), 草原 (grasslands), 公路 (highways/roads)
   
3. Common Chinese attractions to look for:
   - 天山天池 (Tianshan Tianchi / Heavenly Lake)
   - 賽里木湖/赛里木湖 (Sayram Lake)
   - 喀拉峻 (Kalajun Grassland)
   - 那拉提 (Nalati Grassland)
   - 獨庫公路/独库公路 (Duku Highway)
   - 大巴扎 (Grand Bazaar)
   - 汗血寶馬/汗血宝马 (Akhal-Teke Horse)
   - 伊犁 (Yili/Ili)
   - 烏魯木齊/乌鲁木齐 (Urumqi)

Return JSON with this structure:
{
  "entities": [
    {
      "name": "Location name (Chinese + English, e.g., '天山天池 Tianshan Tianchi Lake')",
      "type": "attraction|city|hotel|restaurant|landmark|airport|station",
      "day": <day number 1-N>,
      "order": <sequential order within the day starting from 1>,
      "metadata": {
        "originalText": "surrounding context from document",
        "category": "lake|mountain|grassland|historic|bazaar|hotel|city|etc"
      }
    }
  ],
  "flights": [
    {
      "flightNumber": "e.g., CZ6886",
      "airline": "e.g., China Southern",
      "departureAirport": "Full name",
      "departureCode": "3-letter code (CAN, URC, XIY, BKK, etc.)",
      "arrivalAirport": "Full name",
      "arrivalCode": "3-letter code",
      "departureTime": "HH:MM or null",
      "arrivalTime": "HH:MM or null",
      "day": <number>
    }
  ],
  "trains": [
    {
      "trainNumber": "e.g., D8XXX, G1234",
      "trainType": "high-speed|normal",
      "departureStation": "Station name",
      "arrivalStation": "Station name",
      "departureTime": "HH:MM or null",
      "arrivalTime": "HH:MM or null",
      "day": <number>
    }
  ],
  "estimatedDays": <total days in trip>
}

IMPORTANT:
- Extract AT LEAST 3-5 attractions per day if the itinerary shows them
- Cities like 烏魯木齊/乌鲁木齐 (Urumqi), 伊寧/伊宁 (Yining), 昭蘇/昭苏 (Zhaosu) should be type "city"
- Natural sites should be type "attraction" with appropriate category
- DO NOT skip any attractions - the user expects to see ALL destinations
- Return ONLY valid JSON`;

    const result = await model.generateContent(prompt);
    const responseText = result.response.text();

    // Parse JSON from response
    const jsonMatch = responseText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        const parsed = JSON.parse(jsonMatch[0]);
        return {
          entities: this.validateEntities(parsed.entities || []),
          flights: this.validateFlights(parsed.flights || []),
          trains: this.validateTrains(parsed.trains || []),
          estimatedDays: parsed.estimatedDays || 1,
        };
      } catch (e) {
        this.log("JSON parse error, attempting recovery", e);
        return this.fallbackParse(text);
      }
    }

    return this.fallbackParse(text);
  }

  private validateEntities(entities: unknown[]): ExtractedEntity[] {
    const validated = entities
      .filter((e): e is Record<string, unknown> => typeof e === "object" && e !== null)
      .filter((e) => e.name && String(e.name).trim().length > 0) // Must have a name
      .map((e) => ({
        name: String(e.name).trim(),
        type: this.validateEntityType(String(e.type || "attraction")), // Default to attraction
        day: typeof e.day === "number" && e.day > 0 ? e.day : 1,
        order: typeof e.order === "number" ? e.order : undefined, // Preserve order from extraction
        rawText: e.metadata && typeof e.metadata === "object" ? String((e.metadata as Record<string, unknown>).originalText || "") : undefined,
        metadata: e.metadata as Record<string, unknown> | undefined,
      }));
    
    // Assign sequential order values within each day if not provided
    const orderByDay = new Map<number, number>();
    const withOrder = validated.map((entity) => {
      if (entity.order === undefined) {
        const day = entity.day || 1;
        const currentOrder = orderByDay.get(day) ?? 0;
        orderByDay.set(day, currentOrder + 1);
        return { ...entity, order: currentOrder + 1 };
      }
      return entity;
    });
    
    this.log(`Validated ${withOrder.length} entities from ${entities.length} raw entities`);
    return withOrder;
  }

  private validateEntityType(type: string): ExtractedEntity["type"] {
    const validTypes: ExtractedEntity["type"][] = [
      "location", "flight", "train", "hotel", "restaurant", "attraction", "airport", "station", "city"
    ];
    return validTypes.includes(type as ExtractedEntity["type"]) 
      ? (type as ExtractedEntity["type"]) 
      : "location";
  }

  private validateFlights(flights: unknown[]): ExtractedFlight[] {
    return flights
      .filter((f): f is Record<string, unknown> => typeof f === "object" && f !== null)
      .filter((f) => f.departureCode && f.arrivalCode)
      .map((f) => ({
        flightNumber: String(f.flightNumber || "Unknown"),
        airline: f.airline ? String(f.airline) : undefined,
        departureAirport: f.departureAirport ? String(f.departureAirport) : undefined,
        departureCode: String(f.departureCode).toUpperCase(),
        arrivalAirport: f.arrivalAirport ? String(f.arrivalAirport) : undefined,
        arrivalCode: String(f.arrivalCode).toUpperCase(),
        departureTime: f.departureTime ? String(f.departureTime) : undefined,
        arrivalTime: f.arrivalTime ? String(f.arrivalTime) : undefined,
        day: typeof f.day === "number" ? f.day : 1,
      }));
  }

  private validateTrains(trains: unknown[]): ExtractedTrain[] {
    return trains
      .filter((t): t is Record<string, unknown> => typeof t === "object" && t !== null)
      .filter((t) => t.departureStation && t.arrivalStation)
      .map((t) => ({
        trainNumber: String(t.trainNumber || "Unknown"),
        trainType: this.validateTrainType(String(t.trainType || "normal")),
        operator: t.operator ? String(t.operator) : undefined,
        departureStation: String(t.departureStation),
        arrivalStation: String(t.arrivalStation),
        departureTime: t.departureTime ? String(t.departureTime) : undefined,
        arrivalTime: t.arrivalTime ? String(t.arrivalTime) : undefined,
        day: typeof t.day === "number" ? t.day : 1,
      }));
  }

  private validateTrainType(type: string): ExtractedTrain["trainType"] {
    const validTypes: ExtractedTrain["trainType"][] = ["high-speed", "normal", "metro", "other"];
    return validTypes.includes(type as ExtractedTrain["trainType"])
      ? (type as ExtractedTrain["trainType"])
      : "normal";
  }

  private fallbackParse(text: string): Omit<DocExtractionResult, "rawText" | "documentType"> {
    this.log("Using fallback parsing for document");
    const entities: ExtractedEntity[] = [];
    const flights: ExtractedFlight[] = [];
    const trains: ExtractedTrain[] = [];

    // Extract flight numbers with airport codes
    const flightPattern = /([A-Z]{2}\d{3,4})/g;
    let match;
    const seenFlights = new Set<string>();
    while ((match = flightPattern.exec(text)) !== null) {
      if (!seenFlights.has(match[1])) {
        seenFlights.add(match[1]);
        flights.push({
          flightNumber: match[1],
          departureCode: "UNK",
          arrivalCode: "UNK",
          day: 1,
        });
      }
    }

    // Extract airport codes and try to pair them
    const airportPattern = /([A-Z]{3})\s*[-–→到]\s*([A-Z]{3})/g;
    while ((match = airportPattern.exec(text)) !== null) {
      if (flights.length > 0 && flights[flights.length - 1].departureCode === "UNK") {
        flights[flights.length - 1].departureCode = match[1];
        flights[flights.length - 1].arrivalCode = match[2];
      }
    }

    // Extract train numbers
    const trainPattern = /([GDKTZ]\d{3,4})/g;
    const seenTrains = new Set<string>();
    while ((match = trainPattern.exec(text)) !== null) {
      if (!seenTrains.has(match[1])) {
        seenTrains.add(match[1]);
        trains.push({
          trainNumber: match[1],
          trainType: match[1].startsWith("G") || match[1].startsWith("C") ? "high-speed" : "normal",
          departureStation: "Unknown",
          arrivalStation: "Unknown",
          day: 1,
        });
      }
    }

    // Count days - support multiple formats
    const dayPattern = /[Dd]ay\s*(\d+)|[Dd](\d+)|วันที่\s*(\d+)|第(\d+)天|第(\d+)日/g;
    let maxDay = 1;
    while ((match = dayPattern.exec(text)) !== null) {
      const dayNum = parseInt(match[1] || match[2] || match[3] || match[4] || match[5]);
      if (dayNum > maxDay) maxDay = dayNum;
    }

    // Extract common Chinese attractions using patterns
    const chineseAttractions = [
      { pattern: /天山天池|天池/g, name: "天山天池 Tianshan Tianchi Lake", type: "attraction" as const },
      { pattern: /賽里木湖|赛里木湖/g, name: "賽里木湖 Sayram Lake", type: "attraction" as const },
      { pattern: /喀拉峻/g, name: "喀拉峻草原 Kalajun Grassland", type: "attraction" as const },
      { pattern: /那拉提/g, name: "那拉提草原 Nalati Grassland", type: "attraction" as const },
      { pattern: /獨庫公路|独库公路/g, name: "獨庫公路 Duku Highway", type: "attraction" as const },
      { pattern: /國際大巴扎|国际大巴扎|大巴扎/g, name: "國際大巴扎 International Grand Bazaar", type: "attraction" as const },
      { pattern: /汗血寶馬|汗血宝马/g, name: "汗血寶馬基地 Akhal-Teke Horse Base", type: "attraction" as const },
      { pattern: /巴音布魯克|巴音布鲁克/g, name: "巴音布魯克草原 Bayinbulak Grassland", type: "attraction" as const },
      { pattern: /火焰山/g, name: "火焰山 Flaming Mountains", type: "attraction" as const },
      { pattern: /喀納斯|喀纳斯/g, name: "喀納斯湖 Kanas Lake", type: "attraction" as const },
      { pattern: /禾木/g, name: "禾木村 Hemu Village", type: "attraction" as const },
      { pattern: /特克斯八卦城|八卦城/g, name: "特克斯八卦城 Tekes Bagua City", type: "city" as const },
      { pattern: /烏魯木齊|乌鲁木齐/g, name: "烏魯木齊 Urumqi", type: "city" as const },
      { pattern: /伊寧|伊宁/g, name: "伊寧 Yining", type: "city" as const },
      { pattern: /昭蘇|昭苏/g, name: "昭蘇 Zhaosu", type: "city" as const },
      { pattern: /新源/g, name: "新源 Xinyuan", type: "city" as const },
      { pattern: /特克斯/g, name: "特克斯 Tekes", type: "city" as const },
      { pattern: /霍爾果斯|霍尔果斯/g, name: "霍爾果斯 Khorgos", type: "city" as const },
      { pattern: /果子溝|果子沟/g, name: "果子溝大橋 Guozigou Bridge", type: "attraction" as const },
      { pattern: /薰衣草/g, name: "薰衣草莊園 Lavender Farm", type: "attraction" as const },
    ];

    const seenEntities = new Set<string>();
    for (const { pattern, name, type } of chineseAttractions) {
      if (pattern.test(text) && !seenEntities.has(name)) {
        seenEntities.add(name);
        entities.push({
          name,
          type,
          day: 1, // Will need to determine day from context
        });
      }
    }

    this.log(`Fallback extracted: ${entities.length} entities, ${flights.length} flights, ${trains.length} trains, ${maxDay} days`);

    return {
      entities,
      flights,
      trains,
      estimatedDays: maxDay,
    };
  }
}
