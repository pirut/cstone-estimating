import { NextRequest, NextResponse } from "next/server";
import { getFieldCatalog, getFieldCatalogCsv } from "@/lib/field-catalog";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const format = String(
    request.nextUrl.searchParams.get("format") ?? "json"
  ).trim().toLowerCase();
  const shouldDownload =
    String(request.nextUrl.searchParams.get("download") ?? "")
      .trim()
      .toLowerCase() === "1";

  const fields = getFieldCatalog();

  if (format === "csv") {
    const csv = getFieldCatalogCsv(fields);
    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="pandadoc-field-catalog.csv"',
        "Cache-Control": "no-store",
      },
    });
  }

  if (shouldDownload) {
    return new NextResponse(JSON.stringify({ fields }, null, 2), {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition":
          'attachment; filename="pandadoc-field-catalog.json"',
        "Cache-Control": "no-store",
      },
    });
  }

  return NextResponse.json({ fields }, { status: 200 });
}
