"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";

type CoordField = {
  x?: number;
  y?: number;
};

type ViewerProps = {
  pdfUrl?: string | null;
  pageKey: string;
  fields: Record<string, CoordField>;
  selectedField?: string | null;
  onSelectField: (field: string) => void;
  onChangeCoord: (field: string, x: number, y: number) => void;
  className?: string;
};

type PdfState = {
  loading: boolean;
  error: string | null;
};

export function PdfCalibrationViewer({
  pdfUrl,
  pageKey,
  fields,
  selectedField,
  onSelectField,
  onChangeCoord,
  className,
}: ViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [pdfState, setPdfState] = useState<PdfState>({
    loading: false,
    error: null,
  });
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState<string | null>(null);

  const pageIndex = useMemo(() => {
    const number = Number(pageKey.replace("page_", "")) - 1;
    return Number.isNaN(number) ? 0 : Math.max(number, 0);
  }, [pageKey]);

  const markers = useMemo(() => {
    if (!pageSize) return [];
    return Object.entries(fields)
      .map(([name, spec]) => {
        if (spec?.x === undefined || spec?.y === undefined) return null;
        const x = spec.x * scale;
        const y = (pageSize.height - spec.y) * scale;
        return { name, x, y };
      })
      .filter(Boolean) as { name: string; x: number; y: number }[];
  }, [fields, pageSize, scale]);

  useEffect(() => {
    if (!pdfUrl || !canvasRef.current) {
      setPdfState({ loading: false, error: null });
      return;
    }

    let cancelled = false;
    const renderPage = async () => {
      setPdfState({ loading: true, error: null });
      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        ensurePdfWorker(pdfjsLib);

        const response = await fetch(pdfUrl);
        const data = await response.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        const page = await pdfDoc.getPage(pageIndex + 1);

        if (cancelled) return;

        const viewport = page.getViewport({ scale: 1 });
        setPageSize({ width: viewport.width, height: viewport.height });

        const containerWidth = containerRef.current?.clientWidth ?? viewport.width;
        const nextScale = containerWidth / viewport.width;
        setScale(nextScale);

        const scaledViewport = page.getViewport({ scale: nextScale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = scaledViewport.width;
        canvas.height = scaledViewport.height;

        const context = canvas.getContext("2d");
        if (!context) throw new Error("Canvas rendering failed.");

        await page.render({ canvasContext: context, viewport: scaledViewport })
          .promise;

        if (!cancelled) {
          setPdfState({ loading: false, error: null });
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error ? error.message : "Failed to render PDF.";
          setPdfState({ loading: false, error: message });
        }
      }
    };

    void renderPage();
    return () => {
      cancelled = true;
    };
  }, [pdfUrl, pageIndex]);

  useEffect(() => {
    if (!containerRef.current || !pageSize || !canvasRef.current || !pdfUrl) return;

    const resizeObserver = new ResizeObserver(() => {
      const containerWidth = containerRef.current?.clientWidth ?? pageSize.width;
      const nextScale = containerWidth / pageSize.width;
      setScale(nextScale);
    });
    resizeObserver.observe(containerRef.current);
    return () => resizeObserver.disconnect();
  }, [pageSize, pdfUrl]);

  useEffect(() => {
    if (!pdfUrl || !pageSize || !canvasRef.current) return;

    const renderScaled = async () => {
      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        ensurePdfWorker(pdfjsLib);

        const response = await fetch(pdfUrl);
        const data = await response.arrayBuffer();
        const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
        const page = await pdfDoc.getPage(pageIndex + 1);

        const viewport = page.getViewport({ scale });
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext("2d");
        if (!context) return;
        await page.render({ canvasContext: context, viewport }).promise;
      } catch (error) {
        console.error(error);
      }
    };

    void renderScaled();
  }, [pdfUrl, pageIndex, scale, pageSize]);

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedField || !pageSize) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const pdfX = roundToTenth(x / scale);
    const pdfY = roundToTenth(pageSize.height - y / scale);
    onChangeCoord(selectedField, pdfX, pdfY);
  };

  const handlePointerDown = (
    event: React.PointerEvent<HTMLButtonElement>,
    fieldName: string
  ) => {
    event.stopPropagation();
    setIsDragging(fieldName);
    onSelectField(fieldName);
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !pageSize) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const pdfX = roundToTenth(x / scale);
    const pdfY = roundToTenth(pageSize.height - y / scale);
    onChangeCoord(isDragging, pdfX, pdfY);
  };

  const handlePointerUp = () => {
    setIsDragging(null);
  };

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border/70 bg-muted/30",
        className
      )}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {pdfState.loading ? (
        <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          Loading preview...
        </div>
      ) : null}
      {pdfState.error ? (
        <div className="flex items-center justify-center p-8 text-sm text-destructive">
          {pdfState.error}
        </div>
      ) : null}
      {!pdfUrl ? (
        <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
          Upload a template PDF to preview and edit placements.
        </div>
      ) : null}
      <canvas ref={canvasRef} className={cn(pdfUrl ? "block" : "hidden")} />
      {pdfUrl && pageSize ? (
        <div className="pointer-events-none absolute inset-0">
          {markers.map((marker) => (
            <button
              key={marker.name}
              type="button"
              onPointerDown={(event) => handlePointerDown(event, marker.name)}
              className={cn(
                "pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white text-[10px]",
                marker.name === selectedField
                  ? "bg-accent text-accent-foreground shadow-glow"
                  : "bg-foreground text-background"
              )}
              style={{ left: marker.x, top: marker.y }}
            >
              <span className="px-2 py-1">{marker.name.replace(/_/g, " ")}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function roundToTenth(value: number) {
  return Math.round(value * 10) / 10;
}

let pdfWorkerConfigured = false;
function ensurePdfWorker(pdfjsLib: {
  GlobalWorkerOptions: { workerSrc: string };
}) {
  if (pdfWorkerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  pdfWorkerConfigured = true;
}
