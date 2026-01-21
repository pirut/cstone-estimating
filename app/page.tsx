"use client";

import { useEffect, useMemo, useState, type ComponentType } from "react";
import { AdvancedOverridesCard } from "@/components/advanced-overrides-card";
import { BrandMark } from "@/components/brand-mark";
import { UploadCard } from "@/components/upload-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import type { LibraryState, LibraryType, UploadState } from "@/lib/types";
import { cn } from "@/lib/utils";
import { APP_VERSION } from "@/lib/version";
import { ArrowDownToLine, FileDown, FileText, Loader2, Sparkles } from "lucide-react";

export default function HomePage() {
  const [uploads, setUploads] = useState<UploadState>({});
  const [error, setError] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressLabel, setProgressLabel] = useState<string | null>(null);
  const [library, setLibrary] = useState<LibraryState>({
    workbook: { items: [], loading: false, error: null },
    template: { items: [], loading: false, error: null },
  });

  const canGenerate = Boolean(uploads.workbook && uploads.template);
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

  const status = useMemo(() => {
    if (isGenerating) {
      return {
        label: "Generating PDF",
        helper: "Stamping pages and merging overlays.",
        tone: "loading" as const,
      };
    }

    if (canGenerate) {
      return {
        label: "Ready to generate",
        helper: "Workbook and template are ready.",
        tone: "ready" as const,
      };
    }

    return {
      label: "Awaiting uploads",
      helper: "Upload the workbook and template to begin.",
      tone: "idle" as const,
    };
  }, [isGenerating, canGenerate]);

  const statusClassName = cn(
    "border px-4 py-1 text-[10px] tracking-[0.32em]",
    status.tone === "loading" &&
      "border-accent/40 bg-accent/20 text-accent-foreground",
    status.tone === "ready" && "border-white/40 bg-white/10 text-white",
    status.tone === "idle" && "border-white/20 bg-white/5 text-white/70"
  );

  const handleGenerate = async () => {
    setError(null);
    if (!uploads.workbook || !uploads.template) {
      setError("Upload both the workbook and template PDF.");
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
      setProgress(1);
      setProgressLabel("Download ready");
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

  const handleLibrarySelect = (type: LibraryType, item: { name: string; url: string }) => {
    if (!item.url) {
      setError("Selected item has no URL. Try refreshing the library.");
      return;
    }
    setError(null);
    setUploads((prev) => ({
      ...prev,
      [type]: { name: item.name, url: item.url },
    }));
  };

  const handleLibraryDeleteAll = async (type: LibraryType) => {
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

  return (
    <main className="relative min-h-screen overflow-hidden">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-24 left-1/2 h-72 w-[520px] -translate-x-1/2 rounded-full bg-accent/20 blur-3xl" />
        <div className="absolute top-24 right-0 h-72 w-72 rounded-full bg-foreground/10 blur-3xl" />
      </div>
      <div className="container relative py-12">
        <section className="relative overflow-hidden rounded-[32px] border border-border/60 bg-foreground text-white shadow-elevated">
          <div className="absolute -right-28 -top-24 h-72 w-72 rounded-full bg-accent/20 blur-3xl" />
          <div className="absolute bottom-0 left-10 h-56 w-56 rounded-full bg-white/10 blur-3xl" />
          <div className="relative grid gap-8 p-8 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="space-y-6">
              <BrandMark tone="dark" />
              <div className="space-y-4">
                <Badge variant="outline" className={statusClassName}>
                  {status.label}
                </Badge>
                <div className="space-y-3">
                  <h1 className="text-4xl font-serif tracking-tight md:text-5xl">
                    New Construction Proposal Studio
                  </h1>
                  <p className="max-w-xl text-base text-white/70">
                    Convert Excel-driven bids into finished Cornerstone proposals
                    with calibrated PDF stamping and branded outputs in minutes.
                  </p>
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <Metric
                  icon={FileText}
                  label="Inputs"
                  value="Workbook + Template"
                />
                <Metric icon={FileDown} label="Output" value="6-page PDF" />
                <Metric
                  icon={Sparkles}
                  label="Automation"
                  value="Precise stamping"
                />
              </div>
            </div>
            <Card className="border-white/10 bg-white/10 text-white shadow-none">
              <CardHeader>
                <CardTitle className="text-xl text-white">
                  Workflow Overview
                </CardTitle>
                <CardDescription className="text-white/60">
                  {status.helper}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {[
                  "Upload the job workbook (.xlsx)",
                  "Select the Cornerstone template PDF",
                  "Generate and download the stamped proposal",
                ].map((step, index) => (
                  <div
                    key={step}
                    className="flex items-start gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                  >
                    <div className="flex h-8 w-8 items-center justify-center rounded-full border border-white/20 text-sm font-semibold">
                      {index + 1}
                    </div>
                    <p className="text-sm text-white/70">{step}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </section>

        <section className="mt-12 grid gap-6 lg:grid-cols-2">
          <UploadCard
            title="Excel Workbook"
            description="Job info + bid sheet values (.xlsx)."
            endpoint="workbook"
            tag="Required"
            selected={uploads.workbook}
            allowedContent=".xlsx only"
            uploadLabel="Drop the workbook here or browse"
            library={library.workbook}
            onUpload={(file) => {
              setError(null);
              setUploads((prev) => ({ ...prev, workbook: file }));
              void loadLibrary("workbook");
            }}
            onError={setError}
            onSelectLibrary={(item) => handleLibrarySelect("workbook", item)}
            onRefreshLibrary={() => loadLibrary("workbook")}
            onDeleteLibrary={() => handleLibraryDeleteAll("workbook")}
          />
          <UploadCard
            title="Template PDF"
            description="Cornerstone New Construction Proposal template."
            endpoint="template"
            tag="Required"
            selected={uploads.template}
            allowedContent="PDF only"
            uploadLabel="Drop the template here or browse"
            library={library.template}
            onUpload={(file) => {
              setError(null);
              setUploads((prev) => ({ ...prev, template: file }));
              void loadLibrary("template");
            }}
            onError={setError}
            onSelectLibrary={(item) => handleLibrarySelect("template", item)}
            onRefreshLibrary={() => loadLibrary("template")}
            onDeleteLibrary={() => handleLibraryDeleteAll("template")}
          />
        </section>

        <section className="mt-10 grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <AdvancedOverridesCard
            mapping={uploads.mapping}
            coords={uploads.coords}
            onUploadMapping={(file) => {
              setError(null);
              setUploads((prev) => ({ ...prev, mapping: file }));
            }}
            onUploadCoords={(file) => {
              setError(null);
              setUploads((prev) => ({ ...prev, coords: file }));
            }}
            onError={setError}
          />
          <Card className="border-border/60 bg-card/80 shadow-elevated">
            <CardHeader>
              <CardTitle className="text-2xl font-serif">
                Generate Proposal
              </CardTitle>
              <CardDescription>
                Combine selected inputs into a branded PDF download.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {error ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  {error}
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
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Workbook</span>
                  <span className="text-right font-medium text-foreground">
                    {uploads.workbook?.name ?? "Not selected"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Template</span>
                  <span className="text-right font-medium text-foreground">
                    {uploads.template?.name ?? "Not selected"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Mapping</span>
                  <span className="text-right text-muted-foreground">
                    {uploads.mapping?.name ?? "Default"}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-4">
                  <span className="text-muted-foreground">Coordinates</span>
                  <span className="text-right text-muted-foreground">
                    {uploads.coords?.name ?? "Default"}
                  </span>
                </div>
              </div>
              <Separator />
              <div className="flex flex-col gap-3">
                <Button
                  variant="accent"
                  size="lg"
                  onClick={handleGenerate}
                  disabled={!canGenerate || isGenerating}
                >
                  {isGenerating ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <ArrowDownToLine className="h-4 w-4" />
                  )}
                  {isGenerating ? "Generating..." : "Generate Proposal PDF"}
                </Button>
                <Button
                  variant="outline"
                  onClick={() => setUploads({})}
                  disabled={isGenerating}
                >
                  Clear uploads
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Generated PDFs are produced on demand and downloaded immediately.
              </p>
            </CardContent>
          </Card>
        </section>

        <Separator className="my-12" />

        <footer className="flex flex-wrap items-center justify-between gap-4 text-xs text-muted-foreground">
          <span>
            UploadThing handles file storage. Files can be re-used from the
            library tabs in each section.
          </span>
          <span>Cornerstone Proposal Generator · v{APP_VERSION}</span>
        </footer>
      </div>
    </main>
  );
}

function Metric({
  icon: Icon,
  label,
  value,
}: {
  icon: ComponentType<{ className?: string }>;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
      <div className="flex h-10 w-10 items-center justify-center rounded-full border border-white/20">
        <Icon className="h-5 w-5 text-white" />
      </div>
      <div>
        <p className="text-[11px] uppercase tracking-[0.3em] text-white/50">
          {label}
        </p>
        <p className="text-sm font-semibold text-white">{value}</p>
      </div>
    </div>
  );
}
