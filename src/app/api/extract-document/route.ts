/**
 * Document Extraction API Route
 * Uses CrewAI-inspired multi-agent system:
 * 1. DocExtractionAgent - Extracts text and entities from documents
 * 2. GeolocationAgent - Finds coordinates for locations
 * 3. DistanceCalculationAgent - Calculates routes and distances
 */

import { NextResponse } from "next/server";
import mammoth from "mammoth";
import { CrewOrchestrator } from "@/lib/agents";

// Dynamic import for pdf-parse to avoid ESM issues
let pdfParse: ((buffer: Buffer) => Promise<{ text: string }>) | null = null;

// Helper function to extract text from PDF
async function extractFromPDF(buffer: Buffer): Promise<string> {
  try {
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

export async function POST(request: Request) {
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

    // Prepare input for the crew
    let documentText: string | undefined;
    let imageData: { base64: string; mimeType: string } | undefined;
    let documentType = "text";

    // Handle different file types
    if (fileName.endsWith(".pdf") || mimeType === "application/pdf") {
      console.log("[API] Extracting text from PDF");
      documentText = await extractFromPDF(buffer);
      documentType = "pdf";
    } else if (
      fileName.endsWith(".docx") ||
      mimeType === "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    ) {
      console.log("[API] Extracting text from DOCX");
      documentText = await extractFromWord(buffer);
      documentType = "docx";
    } else if (
      fileName.endsWith(".doc") ||
      mimeType === "application/msword"
    ) {
      console.log("[API] Extracting text from DOC");
      try {
        documentText = await extractFromWord(buffer);
        documentType = "doc";
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
      console.log("[API] Processing image document");
      imageData = {
        base64: buffer.toString("base64"),
        mimeType: mimeType || "image/jpeg",
      };
      documentType = "image";
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

    console.log("[API] Initializing CrewOrchestrator with agents");

    // Create the crew orchestrator
    const crew = new CrewOrchestrator({
      apiKeys: {
        gemini: process.env.GEMINI_API_KEY,
        apiNinjas: process.env.API_NINJAS_KEY,
      },
      verbose: true,
    });

    // Process document through the agent pipeline
    console.log("[API] Starting agent pipeline execution");
    console.log("[API] Input data:", { 
      hasText: !!documentText, 
      textLength: documentText?.length || 0,
      hasImage: !!imageData,
      documentType 
    });
    
    let result;
    try {
      result = await crew.processDocument({
        text: documentText,
        imageData,
        documentType,
      });
    } catch (crewError) {
      console.error("[API] Crew execution error:", crewError);
      return NextResponse.json(
        { error: "Agent pipeline failed", details: String(crewError) },
        { status: 500 }
      );
    }

    console.log("[API] Agent pipeline complete", {
      locations: result.locations.length,
      flights: result.flights.length,
      trains: result.trains.length,
      distances: result.distances.length,
      message: result.message,
    });

    // Return the result in the expected format
    return NextResponse.json({
      locations: result.locations,
      flights: result.flights,
      trains: result.trains,
      tripType: result.tripType,
      estimatedDays: result.estimatedDays,
      message: result.message,
      // Include distances for potential future use
      _distances: result.distances,
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
