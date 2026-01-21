from io import BytesIO
import os
from pathlib import Path
import tempfile
from urllib.error import URLError
from urllib.parse import urlparse
from urllib.request import Request, urlopen

from flask import Flask, render_template, request, send_file
from werkzeug.utils import secure_filename

from proposal.generator import (
    DEFAULT_COORDS_PATH,
    DEFAULT_MAPPING_PATH,
    generate_proposal_pdf,
)

app = Flask(__name__)

MAX_DOWNLOAD_MB = float(os.getenv("MAX_DOWNLOAD_MB", "50"))
MAX_DOWNLOAD_BYTES = int(MAX_DOWNLOAD_MB * 1024 * 1024)


@app.route("/", methods=["GET"])
def index():
    return render_template(
        "index.html",
        default_mapping_path=str(DEFAULT_MAPPING_PATH),
        default_coords_path=str(DEFAULT_COORDS_PATH),
        error=None,
    )


@app.route("/generate", methods=["POST"])
def generate():
    workbook = request.files.get("workbook")
    template_pdf = request.files.get("template_pdf")
    workbook_url = request.form.get("workbook_url", "").strip()
    template_url = request.form.get("template_pdf_url", "").strip()

    mapping_json = request.files.get("mapping_json")
    coords_json = request.files.get("coords_json")
    mapping_url = request.form.get("mapping_url", "").strip()
    coords_url = request.form.get("coords_url", "").strip()

    with tempfile.TemporaryDirectory() as temp_dir:
        temp_path = Path(temp_dir)
        try:
            workbook_path = _save_upload_or_url(
                workbook,
                workbook_url,
                temp_path / "workbook.xlsx",
                "Excel workbook",
                {".xlsx"},
                required=True,
            )
            template_path = _save_upload_or_url(
                template_pdf,
                template_url,
                temp_path / "template.pdf",
                "Template PDF",
                {".pdf"},
                required=True,
            )
        except ValueError as exc:
            return _render_error(str(exc))

        if mapping_json and mapping_json.filename or mapping_url:
            try:
                mapping_path = _save_upload_or_url(
                    mapping_json,
                    mapping_url,
                    temp_path / "mapping.json",
                    "Mapping JSON",
                    {".json"},
                    required=False,
                )
            except ValueError as exc:
                return _render_error(str(exc))
        else:
            mapping_path = DEFAULT_MAPPING_PATH

        if coords_json and coords_json.filename or coords_url:
            try:
                coords_path = _save_upload_or_url(
                    coords_json,
                    coords_url,
                    temp_path / "coordinates.json",
                    "Coordinates JSON",
                    {".json"},
                    required=False,
                )
            except ValueError as exc:
                return _render_error(str(exc))
        else:
            coords_path = DEFAULT_COORDS_PATH

        output_path = temp_path / "cornerstone_proposal_filled.pdf"
        generate_proposal_pdf(
            xlsx_path=workbook_path,
            template_pdf_path=template_path,
            output_pdf_path=output_path,
            mapping_path=mapping_path,
            coords_path=coords_path,
        )

        pdf_bytes = output_path.read_bytes()

    return send_file(
        BytesIO(pdf_bytes),
        mimetype="application/pdf",
        as_attachment=True,
        download_name="Cornerstone Proposal - Filled.pdf",
    )


def _save_upload_or_url(
    file_storage,
    url_value: str,
    dest_path: Path,
    label: str,
    allowed_exts: set[str],
    required: bool,
) -> Path:
    if file_storage and file_storage.filename:
        original = secure_filename(file_storage.filename)
        if original:
            suffix = Path(original).suffix
            if suffix:
                dest_path = dest_path.with_suffix(suffix)
        if allowed_exts and dest_path.suffix.lower() not in allowed_exts:
            raise ValueError(f"{label} must be one of: {', '.join(sorted(allowed_exts))}.")
        file_storage.save(dest_path)
        return dest_path

    if url_value:
        parsed = urlparse(url_value)
        if parsed.scheme not in {"http", "https"}:
            raise ValueError(f"{label} URL must start with http:// or https://.")
        if allowed_exts:
            clean_url = url_value.split("?", 1)[0].lower()
            suffix = Path(clean_url).suffix
            if suffix and not any(clean_url.endswith(ext) for ext in allowed_exts):
                raise ValueError(
                    f"{label} URL must end with: {', '.join(sorted(allowed_exts))}."
                )
        _download_url(url_value, dest_path)
        return dest_path

    if required:
        raise ValueError(f"{label} is required (upload a file or provide a URL).")

    return dest_path


def _download_url(url: str, dest_path: Path) -> None:
    request = Request(url, headers={"User-Agent": "cstone-estimating/1.0"})
    try:
        with urlopen(request, timeout=30) as response:
            length = response.headers.get("Content-Length")
            if length and int(length) > MAX_DOWNLOAD_BYTES:
                raise ValueError(
                    f"Remote file exceeds {MAX_DOWNLOAD_MB:.0f} MB limit."
                )
            total = 0
            with dest_path.open("wb") as handle:
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk:
                        break
                    total += len(chunk)
                    if total > MAX_DOWNLOAD_BYTES:
                        raise ValueError(
                            f"Remote file exceeds {MAX_DOWNLOAD_MB:.0f} MB limit."
                        )
                    handle.write(chunk)
    except URLError as exc:
        raise ValueError(f"Failed to download file: {exc}") from exc


def _render_error(message: str):
    return (
        render_template(
            "index.html",
            default_mapping_path=str(DEFAULT_MAPPING_PATH),
            default_coords_path=str(DEFAULT_COORDS_PATH),
            error=message,
        ),
        400,
    )


if __name__ == "__main__":
    app.run(debug=True)
