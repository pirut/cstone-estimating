import { NextRequest, NextResponse } from "next/server";
import { getPandaDocTemplateDetails } from "@/lib/server/pandadoc";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const templateId = String(context.params.id ?? "").trim();
    if (!templateId) {
      return NextResponse.json(
        { error: "PandaDoc template id is required." },
        { status: 400 }
      );
    }
    const template = await getPandaDocTemplateDetails(templateId);
    return NextResponse.json({ template });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

