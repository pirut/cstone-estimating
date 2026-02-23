import { NextResponse } from "next/server";

type FrankfurterResponse = {
  date?: string;
  rates?: Record<string, number>;
};

const DEFAULT_FROM = "EUR";
const DEFAULT_TO = "USD";
export const dynamic = "force-dynamic";

function normalizeCurrency(value: string | null, fallback: string) {
  const normalized = String(value ?? "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized)) return fallback;
  return normalized;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const from = normalizeCurrency(searchParams.get("from"), DEFAULT_FROM);
    const to = normalizeCurrency(searchParams.get("to"), DEFAULT_TO);

    const upstream = await fetch(
      `https://api.frankfurter.app/latest?from=${encodeURIComponent(
        from
      )}&to=${encodeURIComponent(to)}`,
      { cache: "no-store" }
    );
    if (!upstream.ok) {
      const body = await upstream.text().catch(() => "");
      throw new Error(body || `Upstream returned ${upstream.status}.`);
    }

    const data = (await upstream.json()) as FrankfurterResponse;
    const rate = Number(data?.rates?.[to]);
    if (!Number.isFinite(rate) || rate <= 0) {
      throw new Error("Exchange rate is unavailable.");
    }

    return NextResponse.json(
      {
        from,
        to,
        rate,
        asOf: String(data.date ?? ""),
        source: "frankfurter.app",
      },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load exchange rate.";
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
