"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import * as XLSX from "xlsx";
import mappingDefault from "@/config/mapping.json";
import coordinatesDefault from "@/config/coordinates.json";
import { UploadDropzone } from "@/components/uploadthing";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { UploadedFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import {
  ArrowDownToLine,
  ArrowLeft,
  FileDown,
  Loader2,
  RefreshCw,
  Trash2,
} from "lucide-react";

type AdminLibraryType = "workbook" | "template" | "mapping" | "coordinates";

type LibraryItem = {
  key: string;
  name: string;
  uploadedAt: number;
  url: string;
};

type LibraryState = {
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
};

type MappingField = {
  sheet?: string;
  cell?: string;
  format?: string;
};

type MappingConfig = {
  missing_value?: string;
  prepared_by_map?: Record<string, string>;
  fields: Record<string, MappingField>;
};

type CoordField = {
  x?: number;
  y?: number;
  size?: number;
  align?: string;
  max_width?: number;
  min_size?: number;
  font?: string;
  color?: string;
};

type CoordsConfig = Record<string, any>;

const LIBRARY_CONFIG: Record<
  AdminLibraryType,
  { label: string; description: string; endpoint: AdminLibraryType }
> = {
  workbook: {
    label: "Workbooks",
    description: "Uploaded Excel workbooks (.xlsx).",
    endpoint: "workbook",
  },
  template: {
    label: "Templates",
    description: "Uploaded proposal templates (.pdf).",
    endpoint: "template",
  },
  mapping: {
    label: "Mapping JSON",
    description: "Excel cell mapping overrides.",
    endpoint: "mapping",
  },
  coordinates: {
    label: "Coordinates JSON",
    description: "PDF coordinates overrides.",
    endpoint: "coordinates",
  },
};

const adminDropzoneAppearance = {
  container:
    "rounded-xl border border-dashed border-border/70 bg-background/80 px-4 py-6 transition hover:border-accent/60 hover:bg-muted/40",
  uploadIcon: "text-muted-foreground",
  label: "text-sm font-semibold text-foreground",
  allowedContent: "text-xs text-muted-foreground",
  button:
    "bg-foreground text-background shadow-sm hover:bg-foreground/90 data-[state=readying]:bg-muted data-[state=uploading]:bg-muted",
};

export default function AdminPage() {
  const [libraries, setLibraries] = useState<
    Record<AdminLibraryType, LibraryState>
  >({
    workbook: { items: [], loading: false, error: null },
    template: { items: [], loading: false, error: null },
    mapping: { items: [], loading: false, error: null },
    coordinates: { items: [], loading: false, error: null },
  });
  const [workbookFile, setWorkbookFile] = useState<UploadedFile | null>(null);
  const [templateFile, setTemplateFile] = useState<UploadedFile | null>(null);
  const [workbookData, setWorkbookData] = useState<XLSX.WorkBook | null>(null);
  const [mappingConfig, setMappingConfig] = useState<MappingConfig>(() =>
    cloneJson(mappingDefault as MappingConfig)
  );
  const [coordsConfig, setCoordsConfig] = useState<CoordsConfig>(() =>
    cloneJson(coordinatesDefault as CoordsConfig)
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);

  const progressSteps = useMemo(
    () => [
      { label: "Downloading workbook", value: 0.2 },
      { label: "Downloading template", value: 0.4 },
      { label: "Reading Excel data", value: 0.58 },
      { label: "Stamping PDF pages", value: 0.78 },
      { label: "Finalizing download", value: 0.9 },
    ],
    []
  );

  useEffect(() => {
    if (!isGenerating) {
      setProgress(0);
      setProgressLabel(null);
      return;
    }

    let stepIndex = 0;
    setProgress(progressSteps[0].value);
    setProgressLabel(progressSteps[0].label);

    const interval = window.setInterval(() => {
      stepIndex += 1;
      if (stepIndex >= progressSteps.length) {
        window.clearInterval(interval);
        return;
      }
      setProgress(progressSteps[stepIndex].value);
      setProgressLabel(progressSteps[stepIndex].label);
    }, 900);

    return () => window.clearInterval(interval);
  }, [isGenerating, progressSteps]);

  const sheetNames = workbookData?.SheetNames ?? [];
  const fontOptions = useMemo(() => {
    const customFonts = Object.keys(coordsConfig.fonts ?? {});
    return [...new Set(["WorkSans", "Helvetica", ...customFonts])];
  }, [coordsConfig.fonts]);

  useEffect(() => {
    const controller = new AbortController();
    if (!workbookFile?.url) {
      setWorkbookData(null);
      return () => controller.abort();
    }

    const loadWorkbook = async () => {
      try {
        const response = await fetch(workbookFile.url, {
          signal: controller.signal,
        });
        const buffer = await response.arrayBuffer();
        const workbook = XLSX.read(buffer, {
          type: "array",
          cellDates: true,
        });
        setWorkbookData(workbook);
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setWorkbookData(null);
      }
    };

    void loadWorkbook();
    return () => controller.abort();
  }, [workbookFile?.url]);

  useEffect(() => {
    (Object.keys(LIBRARY_CONFIG) as AdminLibraryType[]).forEach((type) => {
      void loadLibrary(type);
    });
  }, []);

  const handleGenerate = async () => {
    setCalibrationError(null);
    if (!workbookFile || !templateFile) {
      setCalibrationError("Upload both the workbook and template PDF.");
      return;
    }

    setIsGenerating(true);
    setProgress(0.1);
    setProgressLabel("Starting generation");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          workbookUrl: workbookFile.url,
          templatePdfUrl: templateFile.url,
          mappingOverride: mappingConfig,
          coordsOverride: coordsConfig,
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
      setProgress(1);
      setProgressLabel("Download ready");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setCalibrationError(message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCalibrationPdf = async () => {
    setCalibrationError(null);
    if (!templateFile) {
      setCalibrationError("Upload the template PDF to generate calibration.");
      return;
    }

    try {
      const response = await fetch("/api/calibrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          templatePdfUrl: templateFile.url,
          coordsOverride: coordsConfig,
          gridSize: 50,
        }),
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to create calibration PDF.";
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = "Cornerstone Calibration.pdf";
      link.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setCalibrationError(message);
    }
  };

  const handleDownloadJson = (data: unknown, filename: string) => {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    link.click();
    window.URL.revokeObjectURL(url);
  };

  const updateMappingField = (
    field: string,
    updates: Partial<MappingField>
  ) => {
    setMappingConfig((prev) => ({
      ...prev,
      fields: {
        ...prev.fields,
        [field]: {
          ...prev.fields[field],
          ...updates,
        },
      },
    }));
  };

  const updateCoordField = (
    pageKey: string,
    field: string,
    updates: Partial<CoordField>
  ) => {
    setCoordsConfig((prev) => ({
      ...prev,
      [pageKey]: {
        ...(prev[pageKey] ?? {}),
        [field]: {
          ...(prev[pageKey] as Record<string, CoordField>)[field],
          ...updates,
        },
      },
    }));
  };

  const pageKeys = useMemo(
    () => Object.keys(coordsConfig).filter((key) => key.startsWith("page_")),
    [coordsConfig]
  );

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="container relative py-12">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="space-y-2">
            <Badge variant="outline" className="bg-background/80">
              Admin Portal
            </Badge>
            <h1 className="text-4xl font-serif">Calibration & File Manager</h1>
            <p className="text-muted-foreground">
              Manage uploads, calibrate coordinates, and craft mapping overrides.
            </p>
          </div>
          <Button asChild variant="outline">
            <Link href="/">
              <ArrowLeft className="h-4 w-4" />
              Back to generator
            </Link>
          </Button>
        </div>

        <Tabs defaultValue="files" className="mt-8">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="files">File Manager</TabsTrigger>
            <TabsTrigger value="calibration">Calibration</TabsTrigger>
          </TabsList>

          <TabsContent value="files" className="mt-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              {(Object.keys(LIBRARY_CONFIG) as AdminLibraryType[]).map(
                (type) => (
                  <LibraryCard
                    key={type}
                    config={LIBRARY_CONFIG[type]}
                    state={libraries[type]}
                    onRefresh={() => loadLibrary(type)}
                    onDeleteAll={() => deleteAll(type)}
                    onDeleteItem={(key) => deleteItem(type, key)}
                  />
                )
              )}
            </div>
          </TabsContent>

          <TabsContent value="calibration" className="mt-6 space-y-6">
            <div className="grid gap-6 lg:grid-cols-2">
              <UploadPickerCard
                title="Workbook"
                description="Upload the Excel workbook to inspect cell values."
                endpoint="workbook"
                selected={workbookFile}
                onUpload={setWorkbookFile}
                onLibraryRefresh={() => loadLibrary("workbook")}
              />
              <UploadPickerCard
                title="Template PDF"
                description="Upload the PDF template for calibration."
                endpoint="template"
                selected={templateFile}
                onUpload={setTemplateFile}
                onLibraryRefresh={() => loadLibrary("template")}
              />
            </div>

            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Mapping Builder
                </CardTitle>
                <CardDescription>
                  Assign Excel cells to proposal fields.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setMappingConfig(cloneJson(mappingDefault as MappingConfig))
                    }
                  >
                    Reset to default
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleDownloadJson(mappingConfig, "mapping.override.json")
                    }
                  >
                    <FileDown className="h-4 w-4" />
                    Download mapping JSON
                  </Button>
                </div>
                <Separator />
                <div className="space-y-4">
                  {Object.entries(mappingConfig.fields).map(
                    ([fieldName, field]) => (
                      <div
                        key={fieldName}
                        className="grid gap-3 rounded-xl border border-border/60 bg-background/80 p-4 md:grid-cols-[1.2fr_1fr_0.8fr]"
                      >
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {formatFieldLabel(fieldName)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {field.format ?? "text"}
                          </p>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">
                            Sheet
                          </label>
                          <select
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            value={field.sheet ?? ""}
                            onChange={(event) =>
                              updateMappingField(fieldName, {
                                sheet: event.target.value,
                              })
                            }
                          >
                            <option value="">Select sheet</option>
                            {sheetNames.map((sheet) => (
                              <option key={sheet} value={sheet}>
                                {sheet}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2">
                          <label className="text-xs text-muted-foreground">
                            Cell
                          </label>
                          <input
                            className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                            value={field.cell ?? ""}
                            onChange={(event) =>
                              updateMappingField(fieldName, {
                                cell: event.target.value.toUpperCase(),
                              })
                            }
                            placeholder="C1"
                          />
                          <p className="text-xs text-muted-foreground">
                            {getCellPreview(workbookData, field.sheet, field.cell)}
                          </p>
                        </div>
                      </div>
                    )
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Coordinates Editor
                </CardTitle>
                <CardDescription>
                  Adjust placement, size, and alignment for each field.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="secondary"
                    onClick={() =>
                      setCoordsConfig(cloneJson(coordinatesDefault as CoordsConfig))
                    }
                  >
                    Reset to default
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() =>
                      handleDownloadJson(coordsConfig, "coordinates.override.json")
                    }
                  >
                    <FileDown className="h-4 w-4" />
                    Download coordinates JSON
                  </Button>
                  <Button variant="outline" onClick={handleCalibrationPdf}>
                    <ArrowDownToLine className="h-4 w-4" />
                    Download calibration PDF
                  </Button>
                </div>
                <Separator />
                <Tabs defaultValue={pageKeys[0] ?? "page_1"}>
                  <TabsList className="flex flex-wrap">
                    {pageKeys.map((pageKey) => (
                      <TabsTrigger key={pageKey} value={pageKey}>
                        {pageKey.replace("_", " ").toUpperCase()}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {pageKeys.map((pageKey) => {
                    const fields = coordsConfig[pageKey] ?? {};
                    return (
                      <TabsContent key={pageKey} value={pageKey} className="mt-4">
                        <div className="space-y-3">
                          {Object.entries(fields as Record<string, CoordField>).map(
                            ([fieldName, field]) => (
                              <div
                                key={fieldName}
                                className="grid gap-3 rounded-xl border border-border/60 bg-background/80 p-4 md:grid-cols-[1.2fr_repeat(5,_minmax(0,_1fr))]"
                              >
                                <div>
                                  <p className="text-sm font-semibold text-foreground">
                                    {formatFieldLabel(fieldName)}
                                  </p>
                                  <p className="text-xs text-muted-foreground">
                                    {fieldName}
                                  </p>
                                </div>
                                <NumberField
                                  label="X"
                                  value={field.x}
                                  onChange={(value) =>
                                    updateCoordField(pageKey, fieldName, {
                                      x: value,
                                    })
                                  }
                                />
                                <NumberField
                                  label="Y"
                                  value={field.y}
                                  onChange={(value) =>
                                    updateCoordField(pageKey, fieldName, {
                                      y: value,
                                    })
                                  }
                                />
                                <NumberField
                                  label="Size"
                                  value={field.size}
                                  onChange={(value) =>
                                    updateCoordField(pageKey, fieldName, {
                                      size: value,
                                    })
                                  }
                                />
                                <div className="space-y-2">
                                  <label className="text-xs text-muted-foreground">
                                    Align
                                  </label>
                                  <select
                                    className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                                    value={field.align ?? "left"}
                                    onChange={(event) =>
                                      updateCoordField(pageKey, fieldName, {
                                        align: event.target.value,
                                      })
                                    }
                                  >
                                    <option value="left">Left</option>
                                    <option value="center">Center</option>
                                    <option value="right">Right</option>
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs text-muted-foreground">
                                    Font
                                  </label>
                                  <select
                                    className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                                    value={field.font ?? "WorkSans"}
                                    onChange={(event) =>
                                      updateCoordField(pageKey, fieldName, {
                                        font: event.target.value,
                                      })
                                    }
                                  >
                                    {fontOptions.map((font) => (
                                      <option key={font} value={font}>
                                        {font}
                                      </option>
                                    ))}
                                  </select>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-xs text-muted-foreground">
                                    Color
                                  </label>
                                  <input
                                    className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
                                    value={field.color ?? "#111111"}
                                    onChange={(event) =>
                                      updateCoordField(pageKey, fieldName, {
                                        color: event.target.value,
                                      })
                                    }
                                  />
                                </div>
                              </div>
                            )
                          )}
                        </div>
                      </TabsContent>
                    );
                  })}
                </Tabs>
              </CardContent>
            </Card>

            <Card className="border-border/60 bg-card/80 shadow-elevated">
              <CardHeader>
                <CardTitle className="text-2xl font-serif">
                  Test Generation
                </CardTitle>
                <CardDescription>
                  Generate a proposal with the current mapping and coordinates.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {calibrationError ? (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                    {calibrationError}
                  </div>
                ) : null}
                {isGenerating ? (
                  <div className="space-y-2 rounded-lg border border-border/60 bg-muted/40 px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.3em] text-muted-foreground">
                      {progressLabel ?? "Working..."}
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-border/60">
                      <div
                        className="h-full rounded-full bg-accent transition-all duration-500"
                        style={{ width: `${Math.min(progress * 100, 100)}%` }}
                      />
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap gap-3">
                  <Button
                    variant="accent"
                    onClick={handleGenerate}
                    disabled={isGenerating}
                  >
                    {isGenerating ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <ArrowDownToLine className="h-4 w-4" />
                    )}
                    {isGenerating ? "Generating..." : "Generate with overrides"}
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => {
                      setWorkbookFile(null);
                      setTemplateFile(null);
                      setWorkbookData(null);
                    }}
                    disabled={isGenerating}
                  >
                    Clear uploads
                  </Button>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );

  async function loadLibrary(type: AdminLibraryType) {
    setLibraries((prev) => ({
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
      setLibraries((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          items: Array.isArray(data.items) ? data.items : [],
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  }

  async function deleteAll(type: AdminLibraryType) {
    setLibraries((prev) => ({
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
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], items: [] },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  }

  async function deleteItem(type: AdminLibraryType, key: string) {
    setLibraries((prev) => ({
      ...prev,
      [type]: { ...prev[type], loading: true, error: null },
    }));
    try {
      const response = await fetch(
        `/api/library?type=${type}&key=${encodeURIComponent(key)}`,
        {
          method: "DELETE",
        }
      );
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to delete file.";
        throw new Error(message);
      }
      setLibraries((prev) => ({
        ...prev,
        [type]: {
          ...prev[type],
          items: prev[type].items.filter((item) => item.key !== key),
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error.";
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], error: message },
      }));
    } finally {
      setLibraries((prev) => ({
        ...prev,
        [type]: { ...prev[type], loading: false },
      }));
    }
  }
}

function LibraryCard({
  config,
  state,
  onRefresh,
  onDeleteAll,
  onDeleteItem,
}: {
  config: { label: string; description: string; endpoint: AdminLibraryType };
  state: LibraryState;
  onRefresh: () => void;
  onDeleteAll: () => void;
  onDeleteItem: (key: string) => void;
}) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-elevated">
      <CardHeader>
        <CardTitle className="text-xl font-serif">{config.label}</CardTitle>
        <CardDescription>{config.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UploadDropzone
          endpoint={config.endpoint}
          appearance={adminDropzoneAppearance}
          config={{ mode: "auto" }}
          content={{
            label: `Upload ${config.label.toLowerCase()}`,
            allowedContent: "Drop file or browse",
            button: "Upload",
          }}
          onClientUploadComplete={() => {
            onRefresh();
          }}
          onUploadError={(error: Error) => {
            console.error(error);
          }}
        />
        {state.error ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {state.error}
          </div>
        ) : null}
        {state.loading ? (
          <div className="text-sm text-muted-foreground">Loading...</div>
        ) : state.items.length ? (
          <ScrollArea className="h-56 rounded-lg border border-border/70 bg-background/70">
            <div className="divide-y divide-border/60">
              {state.items.map((item) => (
                <div
                  key={item.key}
                  className="flex items-center justify-between gap-4 px-4 py-3"
                >
                  <div>
                    <p className="text-sm font-medium text-foreground">
                      {item.name}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.uploadedAt).toLocaleString()}
                    </p>
                  </div>
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <Trash2 className="h-4 w-4" />
                        Delete
                      </Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Delete this file?</AlertDialogTitle>
                        <AlertDialogDescription>
                          This permanently deletes the selected upload.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction
                          className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                          onClick={() => onDeleteItem(item.key)}
                        >
                          Delete
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              ))}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-sm text-muted-foreground">No files yet.</div>
        )}
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" size="sm" onClick={onRefresh}>
            <RefreshCw className="h-4 w-4" />
            Refresh
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="outline" size="sm">
                <Trash2 className="h-4 w-4" />
                Delete all
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete all uploads?</AlertDialogTitle>
                <AlertDialogDescription>
                  This permanently removes every file in this library.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={onDeleteAll}
                >
                  Delete all
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </CardContent>
    </Card>
  );
}

function UploadPickerCard({
  title,
  description,
  endpoint,
  selected,
  onUpload,
  onLibraryRefresh,
}: {
  title: string;
  description: string;
  endpoint: AdminLibraryType;
  selected: UploadedFile | null;
  onUpload: (file: UploadedFile | null) => void;
  onLibraryRefresh: () => void;
}) {
  return (
    <Card className="border-border/60 bg-card/80 shadow-elevated">
      <CardHeader>
        <CardTitle className="text-xl font-serif">{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <UploadDropzone
          endpoint={endpoint}
          appearance={adminDropzoneAppearance}
          config={{ mode: "auto" }}
          content={{
            label: selected ? `Selected: ${selected.name}` : `Upload ${title}`,
            allowedContent: "Drop file or browse",
            button: "Upload",
          }}
          onClientUploadComplete={(files) => {
            const uploaded = files?.[0];
            if (!uploaded) return;
            const url = uploaded.ufsUrl ?? uploaded.url;
            onUpload({ name: uploaded.name, url });
            onLibraryRefresh();
          }}
          onUploadError={(error: Error) => {
            console.error(error);
          }}
        />
        {selected ? (
          <div className="text-xs text-muted-foreground">
            Using: <span className="text-foreground">{selected.name}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function NumberField({
  label,
  value,
  onChange,
}: {
  label: string;
  value?: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs text-muted-foreground">{label}</label>
      <input
        className="w-full rounded-md border border-border bg-background px-2 py-2 text-sm"
        type="number"
        value={value ?? ""}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </div>
  );
}

function formatFieldLabel(fieldName: string) {
  return fieldName
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getCellPreview(
  workbook: XLSX.WorkBook | null,
  sheetName?: string,
  cell?: string
) {
  if (!workbook || !sheetName || !cell) return "No preview available";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return "No preview available";
  const value = sheet[cell]?.v;
  if (value === undefined || value === null) return "No value";
  if (value instanceof Date) return value.toLocaleDateString();
  return String(value);
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
