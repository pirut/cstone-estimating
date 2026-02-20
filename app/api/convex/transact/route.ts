import { NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as
      | { operations?: unknown }
      | null;
    const operations = Array.isArray(body?.operations) ? body.operations : [];

    if (!operations.length) {
      return NextResponse.json(
        {
          error: "Missing operations.",
        },
        { status: 400 }
      );
    }

    await fetchMutation(api.app.transact, {
      operations: operations as any,
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to apply changes.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
