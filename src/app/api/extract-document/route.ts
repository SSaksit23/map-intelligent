/**
 * Document Extraction API Route
 * Fast extraction using:
 * 1. PyMuPDF (Python) for PDF text extraction
 * 2. python-docx (Python) for Word text extraction  
 * 3. Single Gemini call for entity extraction + translation
 */

import { NextResponse } from "next/server";
import { fastExtract, fastExtractFromImage } from "./fast-extract";

// Python service URL for document extraction
const ROUTING_SERVICE_URL = process.env.ROUTING_SERVICE_URL || "http://routing-service:8001";

// Helper function to extract text from documents using Python service
async function extractTextFromDocument(
  buffer: Buffer, 
  fileType: "pdf" | "docx"
): Promise<string> {
  console.log(`[API] Extracting text from ${fileType.toUpperCase()} using Python service...`);
  
  const base64Data = buffer.toString("base64");
  
  try {
    const response = await fetch(`${ROUTING_SERVICE_URL}/extract-document`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data_base64: base64Data,
        filename: `document.${fileType}`,
        file_type: fileType,
      }),
      signal: AbortSignal.timeout(15000), // 15 second timeout
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Python service error: ${response.status} - ${errorText}`);
    }

    const result = await response.json();
    
    if (!result.success) {
      throw new Error(result.error || "Document extraction failed");
    }

    console.log(`[API] Extracted ${result.text.length} chars from ${result.page_count} pages/paragraphs`);
    return result.text;
    
  } catch (error) {
    console.error("[API] Document extraction error:", error);
    throw new Error(`Failed to extract text: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function POST(request: Request) {
  const startTime = Date.now();
  console.log("[API] Document extraction request received");
  
  try {
    // Check for required API keys
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

    console.log(`[API] Processing file: ${file.name} (${file.type})`);

    const buffer = Buffer.from(await file.arrayBuffer());
    const fileName = file.name.toLowerCase();
    const mimeType = file.type;

    // Variables for extraction
    let documentText: string | undefined;
    let imageData: { base64: string; mimeType: string } | undefined;

    // Handle different file types - use Python service for PDF/DOCX
    if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
      console.log("[API] Extracting text from PDF");
      documentText = await extractTextFromDocument(buffer, "pdf");
    } else if (
      fileName.endsWith(".docx") ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      console.log("[API] Extracting text from DOCX");
      documentText = await extractTextFromDocument(buffer, "docx");
    } else if (
      fileName.endsWith(".doc") ||
      mimeType === "application/msword"
    ) {
      return NextResponse.json(
        { error: "Old .doc format not supported. Please convert to .docx" },
        { status: 400 }
      );
    } else if (
      mimeType.startsWith("image/") ||
      fileName.endsWith(".png") ||
      fileName.endsWith(".jpg") ||
      fileName.endsWith(".jpeg") ||
      fileName.endsWith(".webp") ||
      fileName.endsWith(".gif")
    ) {
      console.log("[API] Processing image document");
      imageData = {
        base64: buffer.toString("base64"),
        mimeType: mimeType || "image/jpeg",
      };
    } else {
      return NextResponse.json(
        { error: "Unsupported file type. Please upload PDF, Word (.docx), or image files." },
        { status: 400 }
      );
    }

    // Validate we have content to process
    if (!documentText && !imageData) {
      return NextResponse.json(
        { error: "No content could be extracted from the file" },
        { status: 400 }
      );
    }

    if (documentText && documentText.trim().length === 0) {
      return NextResponse.json(
        { error: "Extracted text is empty" },
        { status: 400 }
      );
    }

    // Add context to document text if provided
    if (documentText && context) {
      documentText = `[User Context: ${context}]\n\n${documentText}`;
    }

    const textExtractionTime = Date.now() - startTime;
    console.log(`[API] Text extraction complete in ${textExtractionTime}ms`);

    // Use fast extraction (single Gemini call)
    console.log("[API] Starting fast AI extraction...");
    
    let result;
    try {
      if (imageData) {
        result = await fastExtractFromImage(
          imageData.base64,
          imageData.mimeType,
          process.env.GEMINI_API_KEY
        );
      } else {
        result = await fastExtract(
          documentText!,
          process.env.GEMINI_API_KEY
        );
      }
    } catch (extractError) {
      console.error("[API] Fast extraction error:", extractError);
      return NextResponse.json(
        { error: "AI extraction failed", details: String(extractError) },
        { status: 500 }
      );
    }

    const totalTime = Date.now() - startTime;
    console.log(`[API] Extraction complete in ${totalTime}ms`, {
      locations: result.locations.length,
      flights: result.flights.length,
      trains: result.trains.length,
    });

    // Transform locations to expected format
    const locations = result.locations.map((loc, index) => ({
      name: loc.name,
      description: loc.description || "",
      address: "",
      coordinates: loc.coordinates || { lat: 0, lng: 0 },
      type: loc.type,
      day: loc.day,
      order: index,
    }));

    // Generate summary message
    const message = generateMessage(result);

    // Return the result
    return NextResponse.json({
      locations,
      flights: result.flights,
      trains: result.trains,
      tripType: result.tripType,
      estimatedDays: result.estimatedDays,
      message,
      _extractionTimeMs: totalTime,
    });

  } catch (error) {
    console.error("[API] Document extraction error:", error);
    return NextResponse.json(
      { 
        error: "Failed to process document", 
        details: error instanceof Error ? error.message : String(error) 
      },
      { status: 500 }
    );
  }
}

function generateMessage(result: { 
  locations: { type: string; name: string }[];
  flights: unknown[];
  trains: unknown[];
  detectedLanguage: string;
}): string {
  const parts: string[] = [];

  if (result.locations.length > 0) {
    const cities = result.locations.filter(l => l.type === "city").length;
    const attractions = result.locations.filter(l => l.type === "attraction").length;
    const hotels = result.locations.filter(l => l.type === "hotel").length;

    if (cities > 0) parts.push(`${cities} cit${cities > 1 ? "ies" : "y"}`);
    if (attractions > 0) parts.push(`${attractions} attraction${attractions > 1 ? "s" : ""}`);
    if (hotels > 0) parts.push(`${hotels} hotel${hotels > 1 ? "s" : ""}`);
  }

  if (result.flights.length > 0) {
    parts.push(`${result.flights.length} flight${result.flights.length > 1 ? "s" : ""}`);
  }

  if (result.trains.length > 0) {
    parts.push(`${result.trains.length} train${result.trains.length > 1 ? "s" : ""}`);
  }

  if (parts.length === 0) {
    return "Document processed. No travel information found.";
  }

  const langNote = result.detectedLanguage && 
    result.detectedLanguage !== "English" && 
    result.detectedLanguage !== "Unknown"
    ? ` (from ${result.detectedLanguage})`
    : "";

  return `Extracted: ${parts.join(", ")}${langNote}`;
}
