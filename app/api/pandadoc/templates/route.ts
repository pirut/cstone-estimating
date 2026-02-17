import { NextRequest, NextResponse } from "next/server";
import { listPandaDocTemplates } from "@/lib/server/pandadoc";

export const runtime = "nodejs";
export const maxDuration = 30;

function toCount(value: string | null) {
  if (!value) return 50;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  const rounded = Math.trunc(parsed);
  return Math.max(1, Math.min(100, rounded));
}

export async function GET(request: NextRequest) {
  try {
    const q = String(request.nextUrl.searchParams.get("q") ?? "").trim();
    const count = toCount(request.nextUrl.searchParams.get("count"));
    const results = await listPandaDocTemplates(q, count);
    return NextResponse.json({ results });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

