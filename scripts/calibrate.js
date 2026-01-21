const fs = require("fs/promises");
const path = require("path");
const { PDFDocument, rgb, StandardFonts } = require("pdf-lib");

const DEFAULT_GRID = 50;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.template) {
    console.error("Usage: node scripts/calibrate.js --template <file> [--coords <file>] [--output <file>]");
    process.exit(1);
  }

  const templatePath = args.template;
  const coordsPath = args.coords || path.join(process.cwd(), "config", "coordinates.json");
  const outputPath = args.output || "calibration.pdf";
  const gridSize = Number(args.grid || DEFAULT_GRID);
  const showGrid = !args.noGrid;
  const showLabels = !args.noLabels;

  const [templateBytes, coordsRaw] = await Promise.all([
    fs.readFile(templatePath),
    fs.readFile(coordsPath, "utf-8"),
  ]);

  const coords = JSON.parse(coordsRaw);
  const pdfDoc = await PDFDocument.load(templateBytes);
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const pages = pdfDoc.getPages();

  pages.forEach((page, index) => {
    const { width, height } = page.getSize();
    const pageKey = `page_${index + 1}`;
    const fields = coords[pageKey] || {};

    if (showGrid && gridSize > 0) {
      const gridColor = rgb(0.7, 0.7, 0.7);
      for (let x = 0; x <= width; x += gridSize) {
        page.drawLine({ start: { x, y: 0 }, end: { x, y: height }, color: gridColor, thickness: 0.5 });
        page.drawText(String(Math.round(x)), { x: x + 2, y: 2, size: 6, font, color: gridColor });
      }
      for (let y = 0; y <= height; y += gridSize) {
        page.drawLine({ start: { x: 0, y }, end: { x: width, y }, color: gridColor, thickness: 0.5 });
        page.drawText(String(Math.round(y)), { x: 2, y: y + 2, size: 6, font, color: gridColor });
      }
    }

    const markerColor = rgb(0.85, 0.1, 0.1);
    Object.entries(fields).forEach(([fieldName, spec]) => {
      const x = Number(spec.x || 0);
      const y = Number(spec.y || 0);
      page.drawLine({ start: { x: x - 6, y }, end: { x: x + 6, y }, color: markerColor, thickness: 1 });
      page.drawLine({ start: { x, y: y - 6 }, end: { x, y: y + 6 }, color: markerColor, thickness: 1 });
      if (showLabels) {
        page.drawText(fieldName, { x: x + 8, y: y + 6, size: 6, font, color: markerColor });
      }
    });
  });

  const output = await pdfDoc.save();
  await fs.writeFile(outputPath, output);
  console.log(`Saved calibration PDF to ${outputPath}`);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    if (key === "no-grid") {
      args.noGrid = true;
      continue;
    }
    if (key === "no-labels") {
      args.noLabels = true;
      continue;
    }
    const value = argv[i + 1];
    if (value && !value.startsWith("--")) {
      args[key] = value;
      i += 1;
    } else {
      args[key] = true;
    }
  }
  return args;
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
