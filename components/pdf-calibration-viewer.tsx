"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import { cn } from "@/lib/utils";

type CoordField = {
  x?: number;
  y?: number;
  size?: number;
  align?: string;
  max_width?: number;
  min_size?: number;
  font?: string;
  color?: string;
  opacity?: number;
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
  onDocumentInfo?: (info: { pageCount: number }) => void;
  labelMap?: Record<string, string>;
  className?: string;
};

type PdfState = {
  loading: boolean;
  error: string | null;
};

type PdfCache = {
  url: string;
  data: ArrayBuffer;
  pdfDoc: any;
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
  onDocumentInfo,
  labelMap,
  className,
}: ViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<any>(null);
  const measureCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pdfCacheRef = useRef<PdfCache | null>(null);
  const [pdfState, setPdfState] = useState<PdfState>({
    loading: false,
    error: null,
  });
  const [pageSize, setPageSize] = useState<{ width: number; height: number } | null>(null);
  const [scale, setScale] = useState(1);
  const [isDragging, setIsDragging] = useState<string | null>(null);
  const renderTokenRef = useRef(0);
  const gridPixelSize = useMemo(() => {
    if (!gridSize || gridSize <= 0) return null;
    return gridSize * scale;
  }, [gridSize, scale]);

  const pageIndex = useMemo(() => {
    const number = Number(pageKey.replace("page_", "")) - 1;
    return Number.isNaN(number) ? 0 : Math.max(number, 0);
  }, [pageKey]);

  const textOverlays = useMemo(() => {
    if (!viewportRef.current) return [];
    return Object.entries(fields)
      .map(([name, spec]) => {
        if (spec?.x === undefined || spec?.y === undefined) return null;
        const [x, y] = viewportRef.current.convertToViewportPoint(
          spec.x,
          spec.y
        );
        const fontFamily = resolveCssFont(spec.font);
        const size = Number(spec.size ?? 10);
        const maxWidth = spec.max_width ? Number(spec.max_width) : undefined;
        const minSize = spec.min_size ? Number(spec.min_size) : 8;
        const rawText = labelMap?.[name] ?? name;
        const fitted = fitPreviewText(
          rawText,
          fontFamily,
          size,
          maxWidth,
          minSize,
          scale,
          measureCanvasRef
        );
        const align = String(spec.align ?? "left");
        const textAnchor =
          align === "right" ? "end" : align === "center" ? "middle" : "start";
        return {
          name,
          x,
          y,
          text: fitted.text,
          fontFamily,
          fontSize: fitted.size * scale,
          color: String(spec.color ?? "#111111"),
          opacity: spec.opacity ? Number(spec.opacity) : undefined,
          textAnchor,
        };
      })
      .filter(Boolean) as {
      name: string;
      x: number;
      y: number;
      text: string;
      fontFamily: string;
      fontSize: number;
      color: string;
      opacity?: number;
      textAnchor: "start" | "middle" | "end";
    }[];
  }, [fields, labelMap, scale]);

  useEffect(() => {
    if (!pdfUrl || !canvasRef.current) {
      setPdfState({ loading: false, error: null });
      return;
    }

    const renderToken = ++renderTokenRef.current;
    const renderPage = async () => {
      setPdfState({ loading: true, error: null });
      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        ensurePdfWorker(pdfjsLib);

        let cached = pdfCacheRef.current;
        if (!cached || cached.url !== pdfUrl) {
          const response = await fetch(pdfUrl);
          if (!response.ok) {
            throw new Error("Failed to download PDF.");
          }
          const data = await response.arrayBuffer();
          if (renderToken !== renderTokenRef.current) return;
          const pdfDoc = await pdfjsLib.getDocument({ data }).promise;
          cached = { url: pdfUrl, data, pdfDoc };
          pdfCacheRef.current = cached;
        }

        onDocumentInfo?.({ pageCount: Number(cached.pdfDoc?.numPages ?? 0) });

        const page = await cached.pdfDoc.getPage(pageIndex + 1);

        if (renderToken !== renderTokenRef.current) return;

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

        if (renderToken === renderTokenRef.current) {
          setPdfState({ loading: false, error: null });
        }
      } catch (error) {
        if (renderToken === renderTokenRef.current) {
          const message =
            error instanceof Error ? error.message : "Failed to render PDF.";
          setPdfState({ loading: false, error: message });
        }
      }
    };

    void renderPage();
    return () => {
      renderTokenRef.current += 1;
    };
  }, [pdfUrl, pageIndex, onDocumentInfo]);

  useEffect(() => {
    pdfCacheRef.current = null;
  }, [pdfUrl]);

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
      const token = renderTokenRef.current;
      try {
        const pdfjsLib = await import("pdfjs-dist/legacy/build/pdf.mjs");
        ensurePdfWorker(pdfjsLib);

        if (token !== renderTokenRef.current) return;
        const cached = pdfCacheRef.current;
        if (!cached || cached.url !== pdfUrl) return;

        const page = await cached.pdfDoc.getPage(pageIndex + 1);

        if (token !== renderTokenRef.current) return;
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
    event: React.PointerEvent<SVGTextElement>,
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
          <svg
            className="absolute inset-0"
            viewBox={`0 0 ${pageSize.width * scale} ${pageSize.height * scale}`}
            preserveAspectRatio="none"
          >
            {textOverlays.map((overlay) => (
              <text
                key={overlay.name}
                x={overlay.x}
                y={overlay.y}
                fill={overlay.color}
                opacity={overlay.opacity}
                fontFamily={overlay.fontFamily}
                fontSize={overlay.fontSize}
                textAnchor={overlay.textAnchor}
                dominantBaseline="alphabetic"
                style={{ cursor: "grab" }}
                className={cn(
                  "pointer-events-auto select-none",
                  overlay.name === selectedField && "drop-shadow-sm"
                )}
                onPointerDown={(event) =>
                  handlePointerDown(event, overlay.name)
                }
              >
                {overlay.text}
              </text>
            ))}
          </svg>
        </div>
      ) : null}
    </div>
  );
}

let pdfWorkerConfigured = false;
function ensurePdfWorker(pdfjsLib: {
  GlobalWorkerOptions: { workerSrc: string };
}) {
  if (pdfWorkerConfigured) return;
  pdfjsLib.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
  pdfWorkerConfigured = true;
}

function resolveCssFont(fontName?: string) {
  if (!fontName) return '"Work Sans", sans-serif';
  if (fontName === "WorkSans") return '"Work Sans", sans-serif';
  if (fontName.startsWith("Helvetica")) {
    return "Helvetica, Arial, sans-serif";
  }
  if (fontName.startsWith("Times")) {
    return '"Times New Roman", serif';
  }
  if (fontName.startsWith("Courier")) {
    return '"Courier New", monospace';
  }
  return `"${fontName}", sans-serif`;
}

function fitPreviewText(
  text: string,
  fontFamily: string,
  size: number,
  maxWidth: number | undefined,
  minSize: number,
  scale: number,
  canvasRef: MutableRefObject<HTMLCanvasElement | null>
) {
  if (!maxWidth) return { text, size };
  const ctx = getMeasureContext(canvasRef);
  if (!ctx) return { text, size };
  let currentSize = size;
  while (currentSize >= minSize) {
    const width = measureTextWidth(ctx, text, fontFamily, currentSize * scale);
    if (width <= maxWidth * scale) return { text, size: currentSize };
    currentSize -= 0.5;
  }

  const ellipsis = "...";
  if (
    measureTextWidth(ctx, ellipsis, fontFamily, minSize * scale) >
    maxWidth * scale
  ) {
    return { text: ellipsis, size: minSize };
  }

  for (let i = text.length; i > 0; i -= 1) {
    const candidate = `${text.slice(0, i).trim()}${ellipsis}`;
    if (
      measureTextWidth(ctx, candidate, fontFamily, minSize * scale) <=
      maxWidth * scale
    ) {
      return { text: candidate, size: minSize };
    }
  }

  return { text: ellipsis, size: minSize };
}

function getMeasureContext(
  canvasRef: MutableRefObject<HTMLCanvasElement | null>
) {
  if (!canvasRef.current && typeof document !== "undefined") {
    canvasRef.current = document.createElement("canvas");
  }
  return canvasRef.current?.getContext("2d") ?? null;
}

function measureTextWidth(
  ctx: CanvasRenderingContext2D,
  text: string,
  fontFamily: string,
  fontSize: number
) {
  ctx.font = `${fontSize}px ${fontFamily}`;
  return ctx.measureText(text).width;
}
