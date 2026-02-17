import { NextRequest, NextResponse } from "next/server";
import { getPandaDocDocumentSummary } from "@/lib/server/pandadoc";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function GET(
  _request: NextRequest,
  context: { params: { id: string } }
) {
  try {
    const documentId = String(context.params?.id ?? "").trim();
    if (!documentId) {
      return NextResponse.json(
        { error: "PandaDoc document id is required." },
        { status: 400 }
      );
    }

    const document = await getPandaDocDocumentSummary(documentId);
    return NextResponse.json({ document });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
