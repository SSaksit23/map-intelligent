import { GoogleGenerativeAI } from '@google/generative-ai';
import { NextRequest, NextResponse } from 'next/server';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY!);

export async function POST(request: NextRequest) {
  try {
    const { lastStopName, firstStopName, distance, fromDay, toDay } = await request.json();

    if (!lastStopName || !firstStopName) {
      return NextResponse.json(
        { error: 'Missing required parameters' },
        { status: 400 }
      );
    }

    const distanceKm = Math.round(distance / 1000);

    const prompt = `
      A user is planning a multi-day trip. They are ending Day ${fromDay || 1} at "${lastStopName}" and starting Day ${toDay || 2} at "${firstStopName}". The distance between these two locations is approximately ${distanceKm} km.

      Your task is to suggest 3 suitable accommodation options (hotels, inns, resorts, etc.) for their overnight stay.

      - If the distance is short (under 20 km), suggest hotels near the first stop of the next day ("${firstStopName}").
      - If the distance is long (over 20 km), suggest hotels near the last stop of the previous day ("${lastStopName}") or a convenient point in between.
      - Consider the type of destinations (e.g., tourist areas may have more resort options, cities have more variety).

      For each suggestion, provide:
      1. Hotel Name - a real, specific hotel name that exists in the area
      2. A brief, compelling description (2 sentences max)
      3. An estimated price range (e.g., $, $$, $$$, $$$$)
      4. The reason for your suggestion (e.g., "Conveniently located for your morning start," "Offers a relaxing stay after a long day of travel").

      Respond with a JSON object in this exact format:
      {
        "accommodations": [
          {
            "name": "Hotel Name",
            "description": "Description of the hotel.",
            "priceRange": "$$",
            "reason": "Reason for suggestion."
          }
        ],
        "recommendedArea": "Name of the area where these hotels are located"
      }
    `;

    const model = genAI.getGenerativeModel({ model: 'gemini-flash-latest' });
    const result = await model.generateContent(prompt);
    const response = await result.response;
    const text = response.text();

    // Clean and parse the JSON response
    const cleanedText = text
      .replace(/```json\n?/g, '')
      .replace(/```\n?/g, '')
      .trim();
    
    try {
      const jsonResponse = JSON.parse(cleanedText);
      return NextResponse.json(jsonResponse);
    } catch (parseError) {
      console.error('Failed to parse Gemini response:', cleanedText);
      return NextResponse.json(
        { error: 'Failed to parse AI response', raw: cleanedText },
        { status: 500 }
      );
    }

  } catch (error) {
    console.error('Gemini Hotel Search Error:', error);
    return NextResponse.json(
      { error: 'Failed to find accommodations' },
      { status: 500 }
    );
  }
}
