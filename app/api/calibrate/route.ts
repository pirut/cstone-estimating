import { NextRequest, NextResponse } from "next/server";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import coordinatesDefault from "@/config/coordinates.json";

export const runtime = "nodejs";
export const maxDuration = 60;

const DEFAULT_GRID = 50;
const MAX_DOWNLOAD_MB = Number(process.env.MAX_DOWNLOAD_MB ?? "50");
const MAX_DOWNLOAD_BYTES = MAX_DOWNLOAD_MB * 1024 * 1024;

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const templatePdfUrl = String(body.templatePdfUrl || "").trim();
    if (!templatePdfUrl) {
      return NextResponse.json(
        { error: "templatePdfUrl is required." },
        { status: 400 }
      );
    }

    const coordsOverride =
      body.coordsOverride && typeof body.coordsOverride === "object"
        ? body.coordsOverride
        : null;
    const gridSize = Number(body.gridSize ?? DEFAULT_GRID);
    const showGrid = body.showGrid !== false;
    const showLabels = body.showLabels !== false;

    const templateBuffer = await downloadBuffer(templatePdfUrl, "Template PDF");
    const coordsConfig = coordsOverride ?? coordinatesDefault;

    const outputPdf = await createCalibrationPdf(
      templateBuffer,
      coordsConfig,
      gridSize,
      showGrid,
      showLabels
    );

    return new NextResponse(outputPdf, {
      status: 200,
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": "attachment; filename=\"calibration.pdf\"",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function createCalibrationPdf(
  templateBuffer: Buffer,
  coordsConfig: Record<string, any>,
  gridSize: number,
  showGrid: boolean,
  showLabels: boolean
) {
  const pdfDoc = await PDFDocument.load(templateBuffer);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const pageKey = `page_${index + 1}`;
    const fields = (coordsConfig[pageKey] || {}) as Record<
      string,
      { x?: number; y?: number }
    >;

    if (showGrid && gridSize > 0) {
      const gridColor = rgb(0.7, 0.7, 0.7);
      for (let x = 0; x <= width; x += gridSize) {
        page.drawLine({
          start: { x, y: 0 },
          end: { x, y: height },
          color: gridColor,
          thickness: 0.5,
        });
        page.drawText(String(Math.round(x)), {
          x: x + 2,
          y: 2,
          size: 6,
          font,
          color: gridColor,
        });
      }
      for (let y = 0; y <= height; y += gridSize) {
        page.drawLine({
          start: { x: 0, y },
          end: { x: width, y },
          color: gridColor,
          thickness: 0.5,
        });
        page.drawText(String(Math.round(y)), {
          x: 2,
          y: y + 2,
          size: 6,
          font,
          color: gridColor,
        });
      }
    }

    const markerColor = rgb(0.85, 0.1, 0.1);
    Object.entries(fields).forEach(([fieldName, spec]) => {
      const x = Number(spec.x || 0);
      const y = Number(spec.y || 0);
      page.drawLine({
        start: { x: x - 6, y },
        end: { x: x + 6, y },
        color: markerColor,
        thickness: 1,
      });
      page.drawLine({
        start: { x, y: y - 6 },
        end: { x, y: y + 6 },
        color: markerColor,
        thickness: 1,
      });
      if (showLabels) {
        page.drawText(fieldName, {
          x: x + 8,
          y: y + 6,
          size: 6,
          font,
          color: markerColor,
        });
      }
    });
  });

  return pdfDoc.save();
}

async function downloadBuffer(url: string, label: string) {
  const response = await fetch(url, {
    headers: { "User-Agent": "cstone-estimating/1.0" },
  });
  if (!response.ok) {
    throw new Error(`${label} download failed (${response.status}).`);
  }
  const length = response.headers.get("content-length");
  if (length && Number(length) > MAX_DOWNLOAD_BYTES) {
    throw new Error(`${label} exceeds ${MAX_DOWNLOAD_MB} MB limit.`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > MAX_DOWNLOAD_BYTES) {
    throw new Error(`${label} exceeds ${MAX_DOWNLOAD_MB} MB limit.`);
  }
  return Buffer.from(arrayBuffer);
}
