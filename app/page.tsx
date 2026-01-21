"use client";

import { useMemo, useState } from "react";
import { UploadDropzone } from "@/components/uploadthing";

type UploadedFile = {
  name: string;
  url: string;
};

type UploadState = {
  workbook?: UploadedFile;
  template?: UploadedFile;
  mapping?: UploadedFile;
  coords?: UploadedFile;
};

export default function HomePage() {
  const [uploads, setUploads] = useState<UploadState>({});
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);

  const canGenerate = Boolean(uploads.workbook && uploads.template);

  const handleGenerate = async () => {
    setError(null);
    if (!uploads.workbook || !uploads.template) {
      setError("Upload both the workbook and template PDF.");
      return;
    }

    setIsGenerating(true);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workbookUrl: uploads.workbook.url,
          templatePdfUrl: uploads.template.url,
          mappingUrl: uploads.mapping?.url,
          coordsUrl: uploads.coords?.url,
        }),
      });

      if (!response.ok) {
        const contentType = response.headers.get("content-type") || "";
        let message = "Failed to generate PDF.";
        if (contentType.includes("application/json")) {
          const data = await response.json();
          message = data?.error || message;
        } else {
          const text = await response.text();
          message = text || message;
        }
        throw new Error(message);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Cornerstone Proposal - Filled.pdf";
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const statusLabel = useMemo(() => {
    if (isGenerating) return "Generating PDF...";
    if (canGenerate) return "Ready to generate";
    return "Waiting for uploads";
  }, [isGenerating, canGenerate]);

  return (
    <main>
      <div className="card grid">
        <div>
          <h1>Cornerstone Proposal Generator</h1>
          <p>
            Upload a workbook and the Cornerstone proposal template, then generate
            a filled PDF in seconds. Large files are handled via UploadThing.
          </p>
          <span className="status-pill">{statusLabel}</span>
        </div>

        {error ? <div className="alert">{error}</div> : null}

        <div className="grid grid-2">
          <UploadSection
            title="Excel Workbook"
            description="Job info + bid sheet data (.xlsx)"
            endpoint="workbook"
            onUpload={(file) =>
              setUploads((prev) => ({ ...prev, workbook: file }))
            }
          />
          <UploadSection
            title="Template PDF"
            description="Cornerstone Proposal PDF"
            endpoint="template"
            onUpload={(file) =>
              setUploads((prev) => ({ ...prev, template: file }))
            }
          />
        </div>

        <details className="details">
          <summary className="field-label">Advanced overrides</summary>
          <p className="meta">
            Optional mapping/coordinates JSON for calibration or alternate
            workbooks.
          </p>
          <div className="grid grid-2">
            <UploadSection
              title="Mapping JSON"
              description="Overrides Excel cell mappings"
              endpoint="mapping"
              onUpload={(file) =>
                setUploads((prev) => ({ ...prev, mapping: file }))
              }
            />
            <UploadSection
              title="Coordinates JSON"
              description="Overrides PDF coordinates"
              endpoint="coordinates"
              onUpload={(file) =>
                setUploads((prev) => ({ ...prev, coords: file }))
              }
            />
          </div>
        </details>

        <div className="grid" style={{ gap: 12 }}>
          <button
            className="button"
            onClick={handleGenerate}
            disabled={!canGenerate || isGenerating}
          >
            {isGenerating ? "Generating..." : "Generate Proposal PDF"}
          </button>
          <button
            className="button secondary"
            onClick={() => setUploads({})}
            disabled={isGenerating}
          >
            Clear uploads
          </button>
        </div>

        <footer>
          UploadThing handles the file storage. Generated PDFs are produced on
          demand and downloaded immediately.
        </footer>
      </div>
    </main>
  );
}

function UploadSection({
  title,
  description,
  endpoint,
  onUpload,
}: {
  title: string;
  description: string;
  endpoint: "workbook" | "template" | "mapping" | "coordinates";
  onUpload: (file: UploadedFile) => void;
}) {
  return (
    <div className="dropzone grid">
      <div>
        <div className="field-label">{title}</div>
        <div className="meta">{description}</div>
      </div>
      <UploadDropzone
        endpoint={endpoint}
        onClientUploadComplete={(files) => {
          const uploaded = files?.[0];
          if (!uploaded) return;
          onUpload({ name: uploaded.name, url: uploaded.url });
        }}
        onUploadError={(err: Error) => {
          console.error(err);
          alert(err.message);
        }}
      />
    </div>
  );
}
