import { NextRequest, NextResponse } from "next/server";
import { getPandaDocDocumentSummary } from "@/lib/server/pandadoc";

export const runtime = "nodejs";
export const maxDuration = 30;

function isPermissionDeniedError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("(403)") &&
    normalized.includes("permission to view this document")
  );
}

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
    if (isPermissionDeniedError(message)) {
      const documentId = String(context.params?.id ?? "").trim();
      return NextResponse.json({
        assumedArchived: true,
        document: {
          id: documentId,
          name: documentId,
          status: "document.archived",
        },
      });
    }
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
