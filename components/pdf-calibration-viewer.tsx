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
  snapToGrid?: boolean;
  gridSize?: number;
  showGrid?: boolean;
  onPageSize?: (size: { width: number; height: number }) => void;
  labelMap?: Record<string, string>;
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
  snapToGrid = false,
  gridSize = 0,
  showGrid = false,
  onPageSize,
  labelMap,
  className,
}: ViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<any>(null);
  const [pdfState, setPdfState] = useState<PdfState>({
    loading: false,
    error: null,
  });
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const gridPixelSize = useMemo(() => {
    if (!gridSize || gridSize <= 0) return null;
    return gridSize * scale;
  }, [gridSize, scale]);

  const pageIndex = useMemo(() => {
    const number = Number(pageKey.replace("page_", "")) - 1;
    return Number.isNaN(number) ? 0 : Math.max(number, 0);
  }, [pageKey]);

  const markers = useMemo(() => {
    if (!viewportRef.current) return [];
    return Object.entries(fields)
      .map(([name, spec]) => {
        if (spec?.x === undefined || spec?.y === undefined) return null;
        const [x, y] = viewportRef.current.convertToViewportPoint(
          spec.x,
          spec.y
        );
        return { name, x, y };
      })
      .filter(Boolean) as { name: string; x: number; y: number }[];
  }, [fields, scale]);

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

        const baseViewport = page.getViewport({ scale: 1, rotation: page.rotate });
        setPageSize({ width: baseViewport.width, height: baseViewport.height });
        onPageSize?.({ width: baseViewport.width, height: baseViewport.height });

        const containerWidth = containerRef.current?.clientWidth ?? baseViewport.width;
        const nextScale = containerWidth / baseViewport.width;
        setScale(nextScale);

        const scaledViewport = page.getViewport({
          scale: nextScale,
          rotation: page.rotate,
        });
        viewportRef.current = scaledViewport;
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

        const viewport = page.getViewport({ scale, rotation: page.rotate });
        viewportRef.current = viewport;
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

  const snapValue = (value: number) => {
    if (!snapToGrid || !gridSize || gridSize <= 0) return value;
    return Math.round(value / gridSize) * gridSize;
  };

  const handleClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!selectedField || !viewportRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const [pdfX, pdfY] = viewportRef.current.convertToPdfPoint(x, y);
    onChangeCoord(selectedField, snapValue(pdfX), snapValue(pdfY));
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
    if (!isDragging || !viewportRef.current) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const x = event.clientX - bounds.left;
    const y = event.clientY - bounds.top;
    const [pdfX, pdfY] = viewportRef.current.convertToPdfPoint(x, y);
    onChangeCoord(isDragging, snapValue(pdfX), snapValue(pdfY));
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
          {showGrid && gridPixelSize ? (
            <div
              className="absolute inset-0"
              style={{
                backgroundImage:
                  "linear-gradient(to right, rgba(148, 163, 184, 0.25) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.25) 1px, transparent 1px)",
                backgroundSize: `${gridPixelSize}px ${gridPixelSize}px`,
              }}
            />
          ) : null}
          {markers.map((marker) => (
            <button
              key={marker.name}
              type="button"
              onPointerDown={(event) => handlePointerDown(event, marker.name)}
              className={cn(
                "pointer-events-auto absolute -translate-y-full text-[10px]",
                marker.name === selectedField
                  ? "bg-accent text-accent-foreground shadow-glow"
                  : "bg-foreground text-background"
              )}
              style={{ left: marker.x, top: marker.y }}
            >
              <span className="relative flex items-end">
                <span className="absolute bottom-0 left-0 flex h-4 w-4 -translate-x-1/2 translate-y-1/2 items-center justify-center rounded-full border border-white text-[12px] font-semibold leading-none">
                  +
                </span>
                <span className="ml-2 rounded-full border-2 border-white px-2 py-1">
                  {formatMarkerLabel(labelMap?.[marker.name] ?? marker.name)}
                </span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function formatMarkerLabel(value: string) {
  const label = value.replace(/_/g, " ");
  if (label.length <= 40) return label;
  return `${label.slice(0, 37)}...`;
}

let pdfWorkerConfigured = false;
function ensurePdfWorker(pdfjsLib: {
  GlobalWorkerOptions: { workerSrc: string };
}) {
  if (pdfWorkerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  pdfWorkerConfigured = true;
}
