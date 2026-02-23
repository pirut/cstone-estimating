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
const MIN_QUERY_LENGTH = 3;
const MAX_QUERY_VARIANTS = 5;

export async function GET(request: NextRequest) {
  const query = (request.nextUrl.searchParams.get("q") ?? "").trim();
  if (query.length < MIN_QUERY_LENGTH) {
    return NextResponse.json({ suggestions: [] as AddressSuggestion[] });
  }

  try {
    const lookupQueries = buildLookupQueries(query);
    const matchGroups = await Promise.all(
      lookupQueries.map((lookupQuery) => fetchAddressMatches(lookupQuery))
    );
    const matches = matchGroups.flat();

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

    const rankedSuggestions = suggestions
      .slice()
      .sort(
        (left, right) =>
          scoreSuggestion(right, query) - scoreSuggestion(left, query)
      )
      .slice(0, MAX_SUGGESTIONS);

    return NextResponse.json({ suggestions: rankedSuggestions });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Address lookup failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function fetchAddressMatches(query: string) {
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
    throw new Error("Address lookup service is unavailable.");
  }

  const data = (await response.json()) as CensusResponse;
  return Array.isArray(data?.result?.addressMatches)
    ? data.result.addressMatches
    : [];
}

function buildLookupQueries(query: string) {
  const normalized = query.replace(/\s+/g, " ").trim();
  const candidates = new Set<string>();
  const addCandidate = (value: string) => {
    const next = value.replace(/\s+/g, " ").trim();
    if (next.length >= MIN_QUERY_LENGTH) {
      candidates.add(next);
    }
  };

  addCandidate(normalized);

  const beforeComma = normalized.split(",")[0]?.trim() ?? "";
  addCandidate(beforeComma);

  const withoutUnit = beforeComma
    .replace(/\b(?:apt|apartment|unit|suite|ste|#)\s*[a-z0-9-]+\b/gi, "")
    .trim();
  addCandidate(withoutUnit);

  const alphaNumeric = normalized
    .replace(/[^a-z0-9\s#/-]/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  addCandidate(alphaNumeric);

  const streetTokens = beforeComma.split(/\s+/).filter(Boolean);
  for (
    let tokenCount = Math.min(streetTokens.length, 4);
    tokenCount >= 2;
    tokenCount -= 1
  ) {
    addCandidate(streetTokens.slice(0, tokenCount).join(" "));
  }

  return Array.from(candidates).slice(0, MAX_QUERY_VARIANTS);
}

function scoreSuggestion(suggestion: AddressSuggestion, query: string) {
  const normalizedQuery = normalizeSearchText(query);
  if (!normalizedQuery) return 0;

  const candidate = normalizeSearchText(
    [suggestion.projectName, suggestion.cityStateZip, suggestion.fullAddress]
      .filter(Boolean)
      .join(" ")
  );
  if (!candidate) return 0;

  let score = 0;
  if (candidate === normalizedQuery) score += 150;
  if (candidate.startsWith(normalizedQuery)) score += 95;
  if (candidate.includes(normalizedQuery)) score += 55;

  const candidateTokens = candidate.split(" ").filter(Boolean);
  const candidateTokenSet = new Set(candidateTokens);
  for (const token of normalizedQuery.split(" ")) {
    if (!token) continue;
    if (candidateTokenSet.has(token)) {
      score += 18;
      continue;
    }
    const partialMatch = candidateTokens.some(
      (candidateToken) =>
        candidateToken.startsWith(token) || token.startsWith(candidateToken)
    );
    if (partialMatch) score += 10;
    if (/\d/.test(token) && candidate.includes(token)) score += 8;
  }

  score -= Math.max(0, candidate.length - normalizedQuery.length) * 0.02;
  return score;
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
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
