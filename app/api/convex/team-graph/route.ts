import { NextResponse } from "next/server";
import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { domain?: string }
      | null;
    const domain = String(body?.domain ?? "").trim().toLowerCase();

    if (!domain || domain === "__none__") {
      return NextResponse.json({ teams: [] });
    }

    const teams = await fetchQuery(api.app.teamGraphByDomain, {
      domain,
    });

    return NextResponse.json({ teams });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to load team data.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
