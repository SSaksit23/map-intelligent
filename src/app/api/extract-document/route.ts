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
  
  const prompt = `Analyze this image and extract all location information, travel itinerary, or place names mentioned. 
List all locations, attractions, hotels, restaurants, cities, or any geographical places you can identify.
If this is a travel itinerary or schedule, extract the day-by-day plan with locations.
Format your response as plain text listing all locations found.`;

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

  const prompt = `You are a travel assistant. Analyze the following document content and extract all travel-related locations.

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
      "day": number (if day information is available, otherwise 1)
    }
  ],
  "tripType": "road_trip|city_tour|multi_city|day_trip",
  "estimatedDays": number,
  "message": "A summary of what was found in the document"
}

Important:
- Extract ALL locations mentioned in the document
- If the document contains a day-by-day itinerary, assign correct day numbers to each location
- Provide accurate coordinates for each location
- Include hotels, restaurants, attractions, landmarks, cities, etc.
- For Chinese locations, include both Chinese name and English translation
- If no locations are found, return an empty locations array with an appropriate message`;

  const result = await model.generateContent(prompt);
  const responseText = result.response.text();

  // Parse the JSON from the response
  const jsonMatch = responseText.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return JSON.parse(jsonMatch[0]);
  }

  return {
    locations: [],
    message: "Could not parse locations from the document",
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
