import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

type CensusMatch = {
  matchedAddress?: string;
  tigerLine?: { tigerLineId?: string };
  addressComponents?: {
    fromAddress?: string;
    toAddress?: string;
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

    const seen = new Set<string>();
    const suggestions: AddressSuggestion[] = [];
    for (let index = 0; index < matches.length; index += 1) {
      const mapped = mapMatchToSuggestion(matches[index], index);
      if (!mapped) continue;
      const key = `${mapped.projectName}|${mapped.cityStateZip}`;
      if (seen.has(key)) continue;
      seen.add(key);
      suggestions.push(mapped);
      if (suggestions.length >= MAX_SUGGESTIONS) break;
    }

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
  const parsedMatched = parseMatchedAddress(match.matchedAddress);
  const street = [
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
  const derivedCityStateZip = [city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const cityStateZip = derivedCityStateZip || parsedMatched.cityStateZip;

  const normalizedStreet = titleCase(street);
  const rangedStreet = [parts.fromAddress, normalizedStreet]
    .filter(Boolean)
    .join(" ");

  const projectName = parsedMatched.street || rangedStreet || normalizedStreet;
  if (!projectName) return null;

  const fullAddress =
    parsedMatched.fullAddress ||
    [projectName, cityStateZip].filter(Boolean).join(", ");

  return {
    id: `${match.tigerLine?.tigerLineId ?? "addr"}-${index}`,
    projectName,
    cityStateZip,
    fullAddress: fullAddress || projectName,
  };
}

function titleCase(input: string) {
  const value = input.trim().toLowerCase();
  if (!value) return "";
  return value.replace(/\b([a-z])/g, (letter) => letter.toUpperCase());
}

function parseMatchedAddress(raw: string | undefined) {
  const text = String(raw ?? "").trim();
  if (!text) {
    return { street: "", cityStateZip: "", fullAddress: "" };
  }

  const pieces = text
    .split(",")
    .map((piece) => piece.trim())
    .filter(Boolean);

  const street = titleCase(pieces[0] ?? "");
  const city = titleCase(pieces[1] ?? "");
  const state = String(pieces[2] ?? "")
    .replace(/[^a-z]/gi, "")
    .toUpperCase();
  const zip = (pieces[3] ?? "").match(/\d{5}(?:-\d{4})?/)?.[0] ?? "";
  const cityStateZip = [city, [state, zip].filter(Boolean).join(" ")]
    .filter(Boolean)
    .join(", ");
  const fullAddress = [street, cityStateZip].filter(Boolean).join(", ");

  return { street, cityStateZip, fullAddress };
}
