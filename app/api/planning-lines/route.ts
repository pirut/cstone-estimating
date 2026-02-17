import { NextRequest, NextResponse } from "next/server";
import {
  buildPlanningLinesFromEstimate,
  planningLinesRowsToTsv,
  planningLinesToCsv,
  planningLinesToTsv,
} from "@/lib/planning-lines";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const estimateData =
      body.estimate && typeof body.estimate === "object" ? body.estimate : null;
    const format = String(body.format || "csv").trim().toLowerCase();

    if (!estimateData) {
      return NextResponse.json(
        { error: "Estimate data is required." },
        { status: 400 }
      );
    }

    const omitUserId = format === "tsv" || format === "tsv_rows";
    const lines = buildPlanningLinesFromEstimate(estimateData, { omitUserId });

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

    if (format === "tsv_rows") {
      const tsvRows = planningLinesRowsToTsv(lines);
      return new NextResponse(tsvRows, {
        status: 200,
        headers: {
          "Content-Type": "text/tab-separated-values; charset=utf-8",
          "Content-Disposition":
            "attachment; filename=\"Project Planning_SYNC.rows.tsv\"",
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
