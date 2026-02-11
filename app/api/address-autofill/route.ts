import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type CensusMatch = {
  matchedAddress?: string;
  tigerLine?: { tigerLineId?: string };
  addressComponents?: {
    fromAddress?: string;
    preDirection?: string;
    preType?: string;
    streetName?: string;
    suffixType?: string;
    suffixDirection?: string;
    city?: string;
    state?: string;
    zip?: string;
  };
};

type CensusResponse = {
  result?: {
    addressMatches?: CensusMatch[];
  };
};

type AddressSuggestion = {
  id: string;
  projectName: string;
  cityStateZip: string;
  fullAddress: string;
};

const MAX_SUGGESTIONS = 6;

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < 4) {
    return NextResponse.json({ suggestions: [] as AddressSuggestion[] });
  }

  try {
    const endpoint = new URL(
      "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"
    );
    endpoint.searchParams.set("address", query);
    endpoint.searchParams.set("benchmark", "Public_AR_Current");
    endpoint.searchParams.set("format", "json");

    const response = await fetch(endpoint.toString(), {
      cache: "no-store",
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return NextResponse.json(
        { error: "Address lookup service is unavailable." },
        { status: 502 }
      );
    }

    const data = (await response.json()) as CensusResponse;
    const matches = Array.isArray(data?.result?.addressMatches)
      ? data.result.addressMatches
      : [];

    const suggestions = matches
      .map((match, index) => mapMatchToSuggestion(match, index))
      .filter((entry): entry is AddressSuggestion => entry !== null)
      .slice(0, MAX_SUGGESTIONS);

    return NextResponse.json({ suggestions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Address lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function mapMatchToSuggestion(
  match: CensusMatch,
  index: number
): AddressSuggestion | null {
  const parts = match.addressComponents ?? {};
  const street = [
    parts.fromAddress,
    parts.preDirection,
    parts.preType,
    parts.streetName,
    parts.suffixType,
    parts.suffixDirection,
  ]
    .map((piece) => String(piece ?? "").trim())
    .filter(Boolean)
    .join(" ");

  const city = titleCase(parts.city ?? "");
  const state = String(parts.state ?? "").trim().toUpperCase();
  const zip = String(parts.zip ?? "").trim();
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");

  const normalizedStreet = titleCase(street);
  const fullAddress = [normalizedStreet, cityStateZip]
    .filter(Boolean)
    .join(", ");
  const fallback = titleCase(String(match.matchedAddress ?? "").trim());

  const projectName = normalizedStreet || fallback;
  if (!projectName) return null;

  return {
    id: `${match.tigerLine?.tigerLineId ?? "addr"}-${index}`,
    projectName,
    cityStateZip,
    fullAddress: fullAddress || fallback || projectName,
  };
}

function titleCase(input: string) {
  const value = input.trim().toLowerCase();
  if (!value) return "";
  return value.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}
