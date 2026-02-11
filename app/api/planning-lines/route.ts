import { NextRequest, NextResponse } from "next/server";
import { downloadBuffer } from "@/lib/server/download";
import {
  buildPlanningLinesFromWorkbookBuffer,
  planningLinesToCsv,
  planningLinesToTsv,
} from "@/lib/planning-lines";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOWNLOAD_TIMEOUT_MS = 20000;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workbookUrl = String(body.workbookUrl || "").trim();
    const format = String(body.format || "csv").trim().toLowerCase();

    if (!workbookUrl) {
      return NextResponse.json(
        { error: "workbookUrl is required." },
        { status: 400 }
      );
    }

    const workbookBuffer = await downloadBuffer(workbookUrl, "Workbook", {
      baseUrl: request.nextUrl.origin,
      timeoutMs: DOWNLOAD_TIMEOUT_MS,
    });
    const lines = buildPlanningLinesFromWorkbookBuffer(workbookBuffer);

    if (format === "json") {
      return NextResponse.json({ lines });
    }

    if (format === "tsv") {
      const tsv = planningLinesToTsv(lines);
      return new NextResponse(tsv, {
        status: 200,
        headers: {
          "Content-Type": "text/tab-separated-values; charset=utf-8",
          "Content-Disposition":
            "attachment; filename=\"Project Planning_SYNC.tsv\"",
          "Cache-Control": "no-store",
        },
      });
    }

    const csv = planningLinesToCsv(lines);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition":
          "attachment; filename=\"Project Planning_SYNC.csv\"",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
