import argparse
import json
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, Tuple

from pypdf import PdfReader, PdfWriter
from reportlab.pdfgen import canvas

from proposal.generator import DEFAULT_COORDS_PATH


def generate_calibration_pdf(
    template_pdf_path: str | Path,
    coords_path: str | Path,
    output_pdf_path: str | Path,
    grid_size: int = 50,
    show_grid: bool = True,
    show_labels: bool = True,
) -> str:
    coords_config = _load_json(Path(coords_path))
    reader = PdfReader(str(template_pdf_path))
    writer = PdfWriter()

    for page_index, page in enumerate(reader.pages, start=1):
        page_key = f"page_{page_index}"
        page_fields = coords_config.get(page_key, {})
        width = float(page.mediabox.width)
        height = float(page.mediabox.height)
        overlay_stream = _build_calibration_overlay(
            (width, height), page_fields, grid_size, show_grid, show_labels
        )
        overlay_reader = PdfReader(overlay_stream)
        page.merge_page(overlay_reader.pages[0])
        writer.add_page(page)

    output_pdf_path = Path(output_pdf_path)
    output_pdf_path.parent.mkdir(parents=True, exist_ok=True)
    with output_pdf_path.open("wb") as output_file:
        writer.write(output_file)

    return str(output_pdf_path)


def _load_json(path: Path) -> Dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def _build_calibration_overlay(
    page_size: Tuple[float, float],
    page_fields: Dict[str, Dict[str, Any]],
    grid_size: int,
    show_grid: bool,
    show_labels: bool,
) -> BytesIO:
    buffer = BytesIO()
    pdf = canvas.Canvas(buffer, pagesize=page_size)
    width, height = page_size

    if show_grid and grid_size > 0:
        pdf.setStrokeColorRGB(0.8, 0.8, 0.8)
        pdf.setFillColorRGB(0.4, 0.4, 0.4)
        pdf.setFont("Helvetica", 6)

        x = 0
        while x <= width:
            pdf.line(x, 0, x, height)
            pdf.drawString(x + 2, 2, str(int(x)))
            x += grid_size

        y = 0
        while y <= height:
            pdf.line(0, y, width, y)
            pdf.drawString(2, y + 2, str(int(y)))
            y += grid_size

    if page_fields:
        pdf.setStrokeColorRGB(1, 0, 0)
        pdf.setFillColorRGB(1, 0, 0)
        pdf.setFont("Helvetica", 6)
        for field_name, spec in page_fields.items():
            x = float(spec.get("x", 0))
            y = float(spec.get("y", 0))
            pdf.line(x - 6, y, x + 6, y)
            pdf.line(x, y - 6, x, y + 6)
            if show_labels:
                pdf.drawString(x + 8, y + 6, field_name)

    pdf.showPage()
    pdf.save()
    buffer.seek(0)
    return buffer


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Generate a calibration PDF with grid + field markers."
    )
    parser.add_argument("--template", required=True, help="Template PDF path")
    parser.add_argument(
        "--coords",
        default=str(DEFAULT_COORDS_PATH),
        help="Coordinates JSON path",
    )
    parser.add_argument(
        "--output", default="calibration.pdf", help="Output PDF path"
    )
    parser.add_argument("--grid", type=int, default=50, help="Grid size")
    parser.add_argument("--no-grid", action="store_true", help="Hide grid")
    parser.add_argument(
        "--no-labels", action="store_true", help="Hide field labels"
    )
    args = parser.parse_args()

    generate_calibration_pdf(
        template_pdf_path=args.template,
        coords_path=args.coords,
        output_pdf_path=args.output,
        grid_size=args.grid,
        show_grid=not args.no_grid,
        show_labels=not args.no_labels,
    )


if __name__ == "__main__":
    main()
