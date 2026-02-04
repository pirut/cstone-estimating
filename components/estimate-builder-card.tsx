"use client";

import { useEffect, useMemo, useState } from "react";
import estimateFields from "@/config/estimate-fields.json";
import { uploadFiles } from "@/components/uploadthing";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Button } from "@/components/ui/button";
import type { LibraryItem, UploadedFile } from "@/lib/types";
import { cn } from "@/lib/utils";
import { Loader2, RefreshCw, Save, Trash2 } from "lucide-react";

const EMPTY_VALUES: Record<string, string> = {};

type EstimateValues = Record<string, string>;

type EstimateBuilderCardProps = {
  values: EstimateValues;
  onValuesChange: (values: EstimateValues) => void;
  name: string;
  onNameChange: (name: string) => void;
  selectedEstimate?: UploadedFile | null;
  onSelectEstimate?: (estimate: UploadedFile | null) => void;
  onActivate?: () => void;
};

type EstimateLibraryState = {
  items: LibraryItem[];
  loading: boolean;
  error: string | null;
};

type EstimateFilePayload = {
  version: number;
  name: string;
  values: EstimateValues;
  createdAt: string;
  updatedAt: string;
};

export function EstimateBuilderCard({
  values,
  onValuesChange,
  name,
  onNameChange,
  selectedEstimate,
  onSelectEstimate,
  onActivate,
}: EstimateBuilderCardProps) {
  const [library, setLibrary] = useState<EstimateLibraryState>({
    items: [],
    loading: false,
    error: null,
  });
  const [saveStatus, setSaveStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const groupList = useMemo(() => estimateFields.groups ?? [], []);

  const loadLibrary = async () => {
    setLibrary((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const response = await fetch("/api/library?type=estimate", {
        cache: "no-store",
      });
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        const message = data?.error || "Failed to load estimates.";
        throw new Error(message);
      }
      const data = await response.json();
      setLibrary((prev) => ({
        ...prev,
        items: Array.isArray(data.items) ? data.items : [],
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setLibrary((prev) => ({ ...prev, error: message }));
    } finally {
      setLibrary((prev) => ({ ...prev, loading: false }));
    }
  };

  useEffect(() => {
    void loadLibrary();
  }, []);

  const handleValueChange = (field: string, nextValue: string) => {
    onActivate?.();
    onValuesChange({
      ...values,
      [field]: nextValue,
    });
  };

  const deriveEstimateName = () => {
    const trimmed = name.trim();
    if (trimmed) return trimmed;
    const projectName = values.project_name?.trim();
    if (projectName) return projectName;
    const preparedFor = values.prepared_for?.trim();
    if (preparedFor) return preparedFor;
    return "Estimate";
  };

  const sanitizeFilename = (input: string) =>
    input.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "estimate";

  const handleSave = async () => {
    setSaveError(null);
    setSaveStatus(null);
    setIsSaving(true);

    try {
      const resolvedName = deriveEstimateName();
      const now = new Date().toISOString();
      const payload: EstimateFilePayload = {
        version: 1,
        name: resolvedName,
        values,
        createdAt: now,
        updatedAt: now,
      };

      const safeName = sanitizeFilename(resolvedName);
      const fileName = `${safeName}.json`;
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      });
      const file = new File([blob], fileName, {
        type: "application/json",
      });

      const uploaded = await uploadFiles("estimate", { files: [file] });
      const uploadedFile = uploaded?.[0];
      const url = uploadedFile?.ufsUrl ?? uploadedFile?.url;

      if (!uploadedFile || !url) {
        throw new Error("Upload completed without a URL.");
      }

      onNameChange(resolvedName);
      onSelectEstimate?.({ name: uploadedFile.name, url });
      setSaveStatus("Estimate saved to the library.");
      await loadLibrary();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setSaveError(message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadEstimate = async (item: LibraryItem) => {
    if (!item.url) {
      setLoadError("Selected estimate has no URL.");
      return;
    }

    setLoadError(null);
    try {
      const response = await fetch(item.url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error("Failed to load estimate JSON.");
      }
      const data = (await response.json()) as Partial<EstimateFilePayload>;
      const loadedValues =
        data?.values && typeof data.values === "object" ? data.values : data;

      if (!loadedValues || typeof loadedValues !== "object") {
        throw new Error("Estimate JSON is invalid.");
      }

      onValuesChange(loadedValues as EstimateValues);
      onNameChange(
        typeof data?.name === "string" && data.name.trim()
          ? data.name
          : stripJsonExtension(item.name)
      );
      onSelectEstimate?.({ name: item.name, url: item.url });
      onActivate?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error.";
      setLoadError(message);
    }
  };

  const handleClear = () => {
    onValuesChange(EMPTY_VALUES);
    onNameChange("");
    onSelectEstimate?.(null);
    setSaveStatus(null);
    setSaveError(null);
    setLoadError(null);
  };

  return (
    <Card className="relative overflow-hidden border-border/60 bg-card/80 shadow-elevated">
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-accent/10 to-transparent" />
      <CardHeader className="relative">
        <CardTitle className="text-2xl font-serif">Estimate Builder</CardTitle>
        <CardDescription>
          Create and edit proposal values without uploading an Excel workbook.
        </CardDescription>
      </CardHeader>
      <CardContent className="relative space-y-6">
        {saveError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {saveError}
          </div>
        ) : null}
        {loadError ? (
          <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {loadError}
          </div>
        ) : null}
        {saveStatus ? (
          <div className="rounded-lg border border-border/60 bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            {saveStatus}
          </div>
        ) : null}

        <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">Estimate name</label>
            <input
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              value={name}
              onChange={(event) => {
                onNameChange(event.target.value);
                onActivate?.();
              }}
              placeholder="Smith Residence - January"
            />
            {selectedEstimate ? (
              <p className="text-xs text-muted-foreground">
                Loaded from: <span className="text-foreground">{selectedEstimate.name}</span>
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <Button variant="accent" onClick={handleSave} disabled={isSaving}>
              {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {isSaving ? "Saving..." : "Save estimate"}
            </Button>
            <Button variant="outline" onClick={handleClear} disabled={isSaving}>
              Clear
            </Button>
          </div>
        </div>

        <Separator />

        <div className="space-y-6">
          {groupList.map((group) => (
            <div key={group.id} className="space-y-3">
              <div>
                <p className="text-sm font-semibold text-foreground">
                  {group.label}
                </p>
                {group.description ? (
                  <p className="text-xs text-muted-foreground">
                    {group.description}
                  </p>
                ) : null}
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                {group.fields.map((field) => {
                  const fieldValue = values[field.key] ?? "";
                  const isDate = field.type === "date";
                  const isCurrency = field.type === "currency";
                  return (
                    <div key={field.key} className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        {field.label}
                      </label>
                      <input
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        type={isDate ? "date" : "text"}
                        inputMode={isCurrency ? "decimal" : undefined}
                        placeholder={field.placeholder ?? ""}
                        value={fieldValue}
                        onChange={(event) =>
                          handleValueChange(field.key, event.target.value)
                        }
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Saved estimates</p>
              <p className="text-xs text-muted-foreground">
                Load a previous estimate JSON from UploadThing.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={loadLibrary}
                disabled={library.loading}
              >
                <RefreshCw className="h-4 w-4" />
                Refresh
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={async () => {
                  setLibrary((prev) => ({ ...prev, loading: true, error: null }));
                  try {
                    const response = await fetch("/api/library?type=estimate", {
                      method: "DELETE",
                    });
                    if (!response.ok) {
                      const data = await response.json().catch(() => null);
                      const message = data?.error || "Failed to delete estimates.";
                      throw new Error(message);
                    }
                    await loadLibrary();
                  } catch (err) {
                    const message =
                      err instanceof Error ? err.message : "Unknown error.";
                    setLibrary((prev) => ({ ...prev, error: message }));
                  } finally {
                    setLibrary((prev) => ({ ...prev, loading: false }));
                  }
                }}
                disabled={library.loading}
                className={cn(
                  "text-destructive hover:text-destructive",
                  library.loading && "opacity-60"
                )}
              >
                <Trash2 className="h-4 w-4" />
                Delete all
              </Button>
            </div>
          </div>

          {library.error ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {library.error}
            </div>
          ) : null}

          {library.loading ? (
            <div className="text-sm text-muted-foreground">Loading...</div>
          ) : library.items.length ? (
            <ScrollArea className="h-52 rounded-lg border border-border/70 bg-background/70">
              <div className="divide-y divide-border/60">
                {library.items.map((item) => (
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
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleLoadEstimate(item)}
                      disabled={!item.url}
                    >
                      Load
                    </Button>
                  </div>
                ))}
              </div>
            </ScrollArea>
          ) : (
            <div className="text-sm text-muted-foreground">No saved estimates yet.</div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function stripJsonExtension(name: string) {
  return name.replace(/\.json$/i, "");
}
