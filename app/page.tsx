"use client";

import { useEffect, useMemo, useState } from "react";
import { UploadDropzone } from "@/components/uploadthing";

type UploadedFile = {
  name: string;
  url: string;
};

type LibraryItem = {
  key: string;
  name: string;
  uploadedAt: number;
  url: string;
};

type LibraryType = "workbook" | "template";

type LibraryState = Record<
  LibraryType,
  { items: LibraryItem[]; loading: boolean; error: string | null }
>;

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
  const [library, setLibrary] = useState<LibraryState>({
    workbook: { items: [], loading: false, error: null },
    template: { items: [], loading: false, error: null },
  });

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

  const loadLibrary = async (type: LibraryType) => {
    setLibrary((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true, error: null },
    }));

    try {
      const response = await fetch(`/api/library?type=${type}`, {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to load library.";
        throw new Error(message);
      }
      const data = await response.json();
      setLibrary((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          items: Array.isArray(data.items) ? data.items : [],
        },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  };

  const handleLibrarySelect = (type: LibraryType, item: LibraryItem) => {
    if (!item.url) {
      setError("Selected item has no URL. Try refreshing the library.");
      return;
    }
    setUploads((prev) => ({
      ...prev,
      [type]: { name: item.name, url: item.url },
    }));
  };

  const handleLibraryDeleteAll = async (type: LibraryType) => {
    const confirmDelete = window.confirm(
      `Delete all ${type === "workbook" ? "workbooks" : "templates"}? This cannot be undone.`
    );
    if (!confirmDelete) return;

    setLibrary((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true, error: null },
    }));

    try {
      const response = await fetch(`/api/library?type=${type}`, {
        method: "DELETE",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to delete files.";
        throw new Error(message);
      }
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], items: [] },
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibrary((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  };

  useEffect(() => {
    void loadLibrary("workbook");
    void loadLibrary("template");
  }, []);

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
            selected={uploads.workbook}
            library={library.workbook}
            onUpload={(file) => {
              setUploads((prev) => ({ ...prev, workbook: file }));
              void loadLibrary("workbook");
            }}
            onSelectLibrary={(item) => handleLibrarySelect("workbook", item)}
            onRefreshLibrary={() => loadLibrary("workbook")}
            onDeleteLibrary={() => handleLibraryDeleteAll("workbook")}
          />
          <UploadSection
            title="Template PDF"
            description="Cornerstone Proposal PDF"
            endpoint="template"
            selected={uploads.template}
            library={library.template}
            onUpload={(file) => {
              setUploads((prev) => ({ ...prev, template: file }));
              void loadLibrary("template");
            }}
            onSelectLibrary={(item) => handleLibrarySelect("template", item)}
            onRefreshLibrary={() => loadLibrary("template")}
            onDeleteLibrary={() => handleLibraryDeleteAll("template")}
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
  selected,
  library,
  onSelectLibrary,
  onRefreshLibrary,
  onDeleteLibrary,
}: {
  title: string;
  description: string;
  endpoint: "workbook" | "template" | "mapping" | "coordinates";
  onUpload: (file: UploadedFile) => void;
  selected?: UploadedFile;
  library?: { items: LibraryItem[]; loading: boolean; error: string | null };
  onSelectLibrary?: (item: LibraryItem) => void;
  onRefreshLibrary?: () => void;
  onDeleteLibrary?: () => void;
}) {
  return (
    <div className="dropzone grid">
      <div>
        <div className="field-label">{title}</div>
        <div className="meta">{description}</div>
        {selected ? (
          <div className="meta">Selected: {selected.name}</div>
        ) : null}
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
      {library ? (
        <div className="library">
          <div className="field-label">Library</div>
          <div className="meta">Recent uploads for this section.</div>
          {library.error ? (
            <div className="library-error">{library.error}</div>
          ) : null}
          {library.loading ? (
            <div className="meta">Loading...</div>
          ) : library.items.length === 0 ? (
            <div className="meta">No files yet.</div>
          ) : (
            <div className="library-list">
              {library.items.map((item) => (
                <div key={item.key} className="library-item">
                  <div>
                    <div className="library-name">{item.name}</div>
                    <div className="meta">
                      {new Date(item.uploadedAt).toLocaleString()}
                    </div>
                  </div>
                  <button
                    className="button secondary"
                    onClick={() => onSelectLibrary?.(item)}
                    disabled={!item.url}
                  >
                    Use
                  </button>
                </div>
              ))}
            </div>
          )}
          <div className="library-actions">
            <button
              className="button secondary"
              onClick={onRefreshLibrary}
              disabled={library.loading}
            >
              Refresh
            </button>
            <button
              className="button secondary"
              onClick={onDeleteLibrary}
              disabled={library.loading}
            >
              Delete all
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
