import { GoogleGenerativeAI } from "@google/generative-ai";
import { NextResponse } from "next/server";
import mammoth from "mammoth";

// Dynamic import for pdf-parse to avoid ESM issues
let pdfParse: ((buffer: Buffer) => Promise<{ text: string }>) | null = null;

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");

// Helper function to extract text from PDF
async function extractFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Dynamic import to avoid ESM issues
    if (!pdfParse) {
      const pdfModule = await import("pdf-parse");
      pdfParse = pdfModule.default || pdfModule;
    }
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error("PDF extraction error:", error);
    throw new Error("Failed to extract text from PDF");
  }
}

// Helper function to extract text from Word document
async function extractFromWord(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value;
  } catch (error) {
    console.error("Word extraction error:", error);
    throw new Error("Failed to extract text from Word document");
  }
}

// Helper function to process image with Gemini Vision
async function extractFromImage(base64Data: string, mimeType: string): Promise<string> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
  
  const prompt = `Analyze this image and extract ALL travel information from EVERY section/day shown:

IMPORTANT: Look for day markers like "D1", "D2", "D3", "Day 1", "Day 2", "วันที่ 1", "วันที่ 2", etc.
Each section labeled with a day number contains information for that specific day.

Extract from EVERY day section:
1. Day marker (D1, D2, D3, etc.) - NEVER skip a day
2. Locations: attractions, hotels, restaurants, cities, landmarks
3. Flights: flight numbers (like 9C6252, CZ361), airlines, departure/arrival airports, times
4. Trains: train numbers, train types, stations, times
5. Transportation info: airport codes (BKK, XIY, CAN, DMK), station names

Format your response as plain text, clearly marking which day each item belongs to:
[D1] or [Day 1]: List all items for day 1
[D2] or [Day 2]: List all items for day 2  
[D3] or [Day 3]: List all items for day 3
And so on...

For flights, format as: "[Day X] Flight: [flight number] from [departure airport code] to [arrival airport code] at [time]"
For locations, format as: "[Day X] Location: [name] - [type: attraction/hotel/restaurant]"

CRITICAL: Extract information from ALL visible day sections. If you see D1, D2, D3, you MUST extract items from all three.`;

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

// Main function to process extracted text and get locations from Gemini
async function processTextWithGemini(text: string, context?: string): Promise<object> {
  const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });

  const prompt = `You are a travel assistant. Analyze the following document content and extract ALL travel-related information including locations, flights, and trains.

Document Content:
"""
${text.substring(0, 10000)}
"""
${context ? `Additional Context: ${context}` : ""}

Please respond in JSON format with the following structure:
{
  "locations": [
    {
      "name": "Location name (include both local language and English if applicable)",
      "description": "Brief description of the place",
      "address": "Full address if mentioned",
      "coordinates": { "lat": number, "lng": number },
      "type": "attraction|restaurant|hotel|landmark|city|airport|station",
      "day": number (MUST match the day marker in the document)
    }
  ],
  "flights": [
    {
      "flightNumber": "e.g., CZ361, TG668, 9C6252",
      "airline": "Airline name",
      "departureAirport": "Airport name",
      "departureCode": "IATA code (3 letters) e.g., BKK, XIY, CAN",
      "arrivalAirport": "Airport name", 
      "arrivalCode": "IATA code (3 letters) e.g., BKK, XIY, CAN",
      "departureTime": "HH:MM format if mentioned",
      "arrivalTime": "HH:MM format if mentioned",
      "day": number (MUST match the day marker in the document)
    }
  ],
  "trains": [
    {
      "trainNumber": "e.g., G1234, D5678, TGV123",
      "trainType": "high-speed|normal|metro|other",
      "operator": "Railway operator name if known",
      "departureStation": "Station name",
      "arrivalStation": "Station name",
      "departureTime": "HH:MM format if mentioned",
      "arrivalTime": "HH:MM format if mentioned",
      "day": number (MUST match the day marker in the document)
    }
  ],
  "tripType": "road_trip|city_tour|multi_city|day_trip",
  "estimatedDays": number,
  "message": "A summary of what was found in the document"
}

CRITICAL - Day Number Assignment:
- Look for day markers like "D1", "D2", "D3", "Day 1", "Day 2", "วันที่ 1", "วันที่ 2", "第一天", "第二天" etc.
- Items listed under D1/Day 1 should have day: 1
- Items listed under D2/Day 2 should have day: 2
- Items listed under D3/Day 3 should have day: 3
- DO NOT skip any days - if document has D1, D2, D3, you MUST have items for all three days
- Each section in the document represents a different day - extract ALL items from EVERY section

Important:
- Extract ALL locations, flights, and trains mentioned in the document from EVERY day section
- Look for flight numbers (like CZ361, TG668, 9C6252, BA123), airline names, airport codes
- Xi'an airport code is XIY (Xi'an Xianyang International Airport)
- Bangkok airport codes: BKK (Suvarnabhumi), DMK (Don Mueang)
- Look for train numbers (like G1234, D5678), train types (高铁/High-speed, 动车, TGV, ICE), station names
- Provide accurate coordinates for each location
- For Chinese locations/stations, include both Chinese name and English translation
- Train types: G/C = high-speed, D = normal high-speed, K/T/Z = normal, metro for subway
- If no items are found in a category, return an empty array for that category`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Parse the JSON from the response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      // Ensure arrays exist even if empty
      return {
        locations: parsed.locations || [],
        flights: parsed.flights || [],
        trains: parsed.trains || [],
        tripType: parsed.tripType,
        estimatedDays: parsed.estimatedDays,
        message: parsed.message,
      };
    } catch (e) {
      console.error("JSON parse error:", e);
    }
  }

  return {
    locations: [],
    flights: [],
    trains: [],
    message: "Could not parse information from the document",
  };
}

export async function POST(request: Request) {
  try {
    if (!process.env.GEMINI_API_KEY) {
      return NextResponse.json(
        { error: "Gemini API key not configured" },
        { status: 500 }
      );
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const context = formData.get("context") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();
    const mimeType = file.type;

    let extractedText = "";

    // Handle different file types
    if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
      extractedText = await extractFromPDF(buffer);
    } else if (
      fileName.endsWith(".docx") ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      extractedText = await extractFromWord(buffer);
    } else if (
      fileName.endsWith(".doc") ||
      mimeType === "application/msword"
    ) {
      // Old .doc format - try mammoth (may not work for all .doc files)
      try {
        extractedText = await extractFromWord(buffer);
      } catch {
        return NextResponse.json(
          { error: "Old .doc format not fully supported. Please convert to .docx" },
          { status: 400 }
        );
      }
    } else if (
      mimeType.startsWith("image/") ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg") ||
      fileName.endsWith(".webp") ||
      fileName.endsWith(".gif")
    ) {
      // Process image with Gemini Vision
      const base64Data = buffer.toString("base64");
      extractedText = await extractFromImage(base64Data, mimeType);
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload PDF, Word (.docx), or image files." },
        { status: 400 }
      );
    }

    if (!extractedText || extractedText.trim().length === 0) {
      return NextResponse.json(
        { error: "No text could be extracted from the file" },
        { status: 400 }
      );
    }

    // Process the extracted text with Gemini to get locations
    const result = await processTextWithGemini(extractedText, context || undefined);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Document extraction error:", error);
    return NextResponse.json(
      { error: "Failed to process document", details: String(error) },
      { status: 500 }
    );
  }
}
