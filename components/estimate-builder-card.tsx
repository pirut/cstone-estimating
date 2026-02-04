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
import {
  computeEstimate,
  createId,
  DEFAULT_DRAFT,
  PANEL_TYPES,
  roundUp,
  toNumber,
  type BuckingLineItem,
  type EstimateDraft,
  type ProductItem,
} from "@/lib/estimate-calculator";
import { cn } from "@/lib/utils";
import {
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Trash2,
  X,
} from "lucide-react";

const EMPTY_VALUES: Record<string, string | number> = {};

type EstimateBuilderCardProps = {
  values: Record<string, string | number>;
  onValuesChange: (values: Record<string, string | number>) => void;
  name: string;
  onNameChange: (name: string) => void;
  selectedEstimate?: UploadedFile | null;
  onSelectEstimate?: (estimate: UploadedFile | null) => void;
  onEstimatePayloadChange?: (payload: Record<string, any> | null) => void;
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
  info?: EstimateDraft["info"];
  products?: ProductItem[];
  bucking?: BuckingLineItem[];
  calculator?: EstimateDraft["calculator"];
  values?: Record<string, string | number>;
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
  onEstimatePayloadChange,
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
  const [draft, setDraft] = useState<EstimateDraft>(DEFAULT_DRAFT);
  const [legacyValues, setLegacyValues] = useState<
    Record<string, string | number> | null
  >(null);

  const groupList = useMemo(() => estimateFields.groups ?? [], []);

  const computed = useMemo(() => computeEstimate(draft), [draft]);

  useEffect(() => {
    if (legacyValues) {
      onValuesChange(legacyValues);
      onEstimatePayloadChange?.({ values: legacyValues });
      return;
    }

    onValuesChange(computed.pdfValues);
    onEstimatePayloadChange?.({
      version: 2,
      name: name.trim(),
      info: draft.info,
      products: draft.products,
      bucking: draft.bucking,
      calculator: draft.calculator,
    });
  }, [computed, draft, legacyValues, name, onEstimatePayloadChange, onValuesChange]);

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

  const handleDraftChange = (next: EstimateDraft) => {
    setDraft(next);
    setLegacyValues(null);
    onActivate?.();
  };

  const handleInfoChange = (field: string, value: string) => {
    handleDraftChange({
      ...draft,
      info: {
        ...draft.info,
        [field]: value,
      },
    });
  };

  const handleProductChange = (index: number, patch: Partial<ProductItem>) => {
    const next = draft.products.map((item, idx) =>
      idx === index ? { ...item, ...patch } : item
    );
    handleDraftChange({
      ...draft,
      products: next,
    });
  };

  const handleBuckingChange = (index: number, patch: Partial<BuckingLineItem>) => {
    const next = draft.bucking.map((item, idx) =>
      idx === index ? { ...item, ...patch } : item
    );
    handleDraftChange({
      ...draft,
      bucking: next,
    });
  };

  const handleCalculatorChange = (
    field: keyof EstimateDraft["calculator"],
    value: string
  ) => {
    handleDraftChange({
      ...draft,
      calculator: {
        ...draft.calculator,
        [field]: value,
      },
    });
  };

  const deriveEstimateName = () => {
    const trimmed = name.trim();
    if (trimmed) return trimmed;
    const projectName = draft.info.project_name?.trim();
    if (projectName) return projectName;
    const preparedFor = draft.info.prepared_for?.trim();
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
      const payload: EstimateFilePayload = legacyValues
        ? {
            version: 1,
            name: resolvedName,
            values: legacyValues,
            createdAt: now,
            updatedAt: now,
          }
        : {
            version: 2,
            name: resolvedName,
            info: draft.info,
            products: draft.products,
            bucking: draft.bucking,
            calculator: draft.calculator,
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

      if (data?.values && !data?.calculator) {
        setLegacyValues(data.values as Record<string, string | number>);
        onNameChange(
          typeof data?.name === "string" && data.name.trim()
            ? data.name
            : stripJsonExtension(item.name)
        );
        onSelectEstimate?.({ name: item.name, url: item.url });
        onActivate?.();
        return;
      }

      const nextDraft: EstimateDraft = {
        info: data.info ?? DEFAULT_DRAFT.info,
        products: data.products?.length ? data.products : DEFAULT_DRAFT.products,
        bucking: data.bucking?.length ? data.bucking : DEFAULT_DRAFT.bucking,
        calculator: data.calculator ?? DEFAULT_DRAFT.calculator,
      };

      setLegacyValues(null);
      setDraft(nextDraft);
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
    setDraft(DEFAULT_DRAFT);
    setLegacyValues(null);
    onValuesChange(EMPTY_VALUES);
    onNameChange("");
    onSelectEstimate?.(null);
    onEstimatePayloadChange?.(null);
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
          Create markups and install pricing from the template workbook.
        </CardDescription>
      </CardHeader>
      <CardContent className="relative space-y-6">
        {legacyValues ? (
          <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm text-amber-700">
            Legacy estimate loaded. Calculator inputs are disabled until you
            convert to the new format.
            <div className="mt-2">
              <Button
                size="sm"
                variant="outline"
                onClick={() => setLegacyValues(null)}
              >
                Convert to calculator
              </Button>
            </div>
          </div>
        ) : null}
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
                  const fieldValue = draft.info[field.key as keyof EstimateDraft["info"]] ?? "";
                  const isDate = field.type === "date";
                  return (
                    <div key={field.key} className="space-y-2">
                      <label className="text-xs text-muted-foreground">
                        {field.label}
                      </label>
                      <input
                        className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                        type={isDate ? "date" : "text"}
                        placeholder={field.placeholder ?? ""}
                        value={fieldValue}
                        onChange={(event) =>
                          handleInfoChange(field.key, event.target.value)
                        }
                        disabled={Boolean(legacyValues)}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <Separator />

        <section className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Product Pricing</p>
            <p className="text-xs text-muted-foreground">
              Matches the Product Pricing table with per-line markups.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-3">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Default product markup</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={draft.calculator.product_markup_default}
                onChange={(event) =>
                  handleCalculatorChange("product_markup_default", event.target.value)
                }
                inputMode="decimal"
                disabled={Boolean(legacyValues)}
              />
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70">
            <div className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <span>Product</span>
              <span>Price</span>
              <span>Markup</span>
              <span>Total</span>
              <span></span>
            </div>
            <div className="divide-y divide-border/60">
              {draft.products.map((item, index) => {
                const price = toNumber(item.price);
                const markup = item.markup.trim()
                  ? toNumber(item.markup)
                  : toNumber(draft.calculator.product_markup_default);
                const total = roundUp(price * (1 + markup));
                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-[2fr_1fr_1fr_1fr_auto] gap-2 px-3 py-2 text-sm"
                  >
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={item.name}
                      onChange={(event) =>
                        handleProductChange(index, { name: event.target.value })
                      }
                      placeholder="Product name"
                      disabled={Boolean(legacyValues)}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={item.price}
                      onChange={(event) =>
                        handleProductChange(index, { price: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder="0"
                      disabled={Boolean(legacyValues)}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={item.markup}
                      onChange={(event) =>
                        handleProductChange(index, { markup: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder={draft.calculator.product_markup_default}
                      disabled={Boolean(legacyValues)}
                    />
                    <div className="self-center text-sm text-muted-foreground">
                      {Number.isFinite(total) ? total.toLocaleString("en-US") : "-"}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const next = draft.products.filter((_, idx) => idx !== index);
                        handleDraftChange({
                          ...draft,
                          products: next.length ? next : DEFAULT_DRAFT.products,
                        });
                      }}
                      disabled={draft.products.length === 1 || Boolean(legacyValues)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                handleDraftChange({
                  ...draft,
                  products: [
                    ...draft.products,
                    {
                      id: createId("product"),
                      name: "",
                      price: "",
                      markup: draft.calculator.product_markup_default,
                    },
                  ],
                })
              }
              disabled={Boolean(legacyValues)}
            >
              <Plus className="h-4 w-4" />
              Add product line
            </Button>
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Bucking & Waterproof</p>
            <p className="text-xs text-muted-foreground">
              Matches lineal-ft math and panel counts from the workbook.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Bucking $/ft</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={draft.calculator.bucking_rate}
                onChange={(event) =>
                  handleCalculatorChange("bucking_rate", event.target.value)
                }
                inputMode="decimal"
                disabled={Boolean(legacyValues)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Waterproofing $/ft</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={draft.calculator.waterproofing_rate}
                onChange={(event) =>
                  handleCalculatorChange("waterproofing_rate", event.target.value)
                }
                inputMode="decimal"
                disabled={Boolean(legacyValues)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Override bucking cost</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={draft.calculator.override_bucking_cost}
                onChange={(event) =>
                  handleCalculatorChange("override_bucking_cost", event.target.value)
                }
                inputMode="decimal"
                placeholder="Leave blank for auto"
                disabled={Boolean(legacyValues)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Override waterproof cost</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={draft.calculator.override_waterproofing_cost}
                onChange={(event) =>
                  handleCalculatorChange("override_waterproofing_cost", event.target.value)
                }
                inputMode="decimal"
                placeholder="Leave blank for auto"
                disabled={Boolean(legacyValues)}
              />
            </div>
          </div>
          <div className="rounded-lg border border-border/70 bg-background/70">
            <div className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_auto] gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <span>Unit Type</span>
              <span>Qty</span>
              <span>SqFt</span>
              <span>Replacement</span>
              <span>Clerestory</span>
              <span>Lineal Ft</span>
              <span></span>
            </div>
            <div className="divide-y divide-border/60">
              {draft.bucking.map((item, index) => {
                const qty = toNumber(item.qty);
                const sqft = toNumber(item.sqft);
                const lineal = qty
                  ? Math.abs(Math.sqrt((sqft / qty) / 6) * 11) * qty
                  : 0;
                return (
                  <div
                    key={item.id}
                    className="grid grid-cols-[1fr_1fr_1fr_1fr_1fr_1fr_auto] gap-2 px-3 py-2 text-sm"
                  >
                    <select
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={item.unit_type}
                      onChange={(event) =>
                        handleBuckingChange(index, { unit_type: event.target.value })
                      }
                      disabled={Boolean(legacyValues)}
                    >
                      {PANEL_TYPES.map((panel) => (
                        <option key={panel.id} value={panel.id}>
                          {panel.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={item.qty}
                      onChange={(event) =>
                        handleBuckingChange(index, { qty: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder="0"
                      disabled={Boolean(legacyValues)}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={item.sqft}
                      onChange={(event) =>
                        handleBuckingChange(index, { sqft: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder="0"
                      disabled={Boolean(legacyValues)}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={item.replacement_qty}
                      onChange={(event) =>
                        handleBuckingChange(index, { replacement_qty: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder="0"
                      disabled={Boolean(legacyValues)}
                    />
                    <input
                      className="rounded-md border border-border bg-background px-2 py-1 text-sm"
                      value={item.clerestory_qty}
                      onChange={(event) =>
                        handleBuckingChange(index, { clerestory_qty: event.target.value })
                      }
                      inputMode="decimal"
                      placeholder="0"
                      disabled={Boolean(legacyValues)}
                    />
                    <div className="self-center text-sm text-muted-foreground">
                      {lineal ? lineal.toFixed(2) : "-"}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        const next = draft.bucking.filter((_, idx) => idx !== index);
                        handleDraftChange({
                          ...draft,
                          bucking: next.length ? next : DEFAULT_DRAFT.bucking,
                        });
                      }}
                      disabled={draft.bucking.length === 1 || Boolean(legacyValues)}
                    >
                      <X className="h-4 w-4" />
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
          <div>
            <Button
              variant="outline"
              size="sm"
              onClick={() =>
                handleDraftChange({
                  ...draft,
                  bucking: [
                    ...draft.bucking,
                    {
                      id: createId("bucking"),
                      unit_type: PANEL_TYPES[0]?.id ?? "SH",
                      qty: "",
                      sqft: "",
                      replacement_qty: "",
                      clerestory_qty: "",
                    },
                  ],
                })
              }
              disabled={Boolean(legacyValues)}
            >
              <Plus className="h-4 w-4" />
              Add line item
            </Button>
          </div>
          <div className="text-xs text-muted-foreground">
            Total lineal ft: {computed.breakdown.total_lineal_ft.toFixed(2)}
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Install Calculator</p>
            <p className="text-xs text-muted-foreground">
              Uses panel counts to split install costs 70% / 20% / 10%.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-4">
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Install markup</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={draft.calculator.install_markup}
                onChange={(event) =>
                  handleCalculatorChange("install_markup", event.target.value)
                }
                inputMode="decimal"
                disabled={Boolean(legacyValues)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Rentals</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={draft.calculator.rentals}
                onChange={(event) =>
                  handleCalculatorChange("rentals", event.target.value)
                }
                inputMode="decimal"
                placeholder="0"
                disabled={Boolean(legacyValues)}
              />
            </div>
            <div className="space-y-2">
              <label className="text-xs text-muted-foreground">Override total install</label>
              <input
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                value={draft.calculator.override_install_total}
                onChange={(event) =>
                  handleCalculatorChange("override_install_total", event.target.value)
                }
                inputMode="decimal"
                placeholder="Leave blank for auto"
                disabled={Boolean(legacyValues)}
              />
            </div>
          </div>

          <div className="rounded-lg border border-border/70 bg-background/70">
            <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] gap-2 border-b border-border/60 px-3 py-2 text-xs font-semibold text-muted-foreground">
              <span>Panel Type</span>
              <span>Total Qty</span>
              <span>Clerestory</span>
              <span>Replacement</span>
            </div>
            <ScrollArea className="h-44">
              <div className="divide-y divide-border/60">
                {PANEL_TYPES.map((panel) => {
                  const counts = computed.panelCounts[panel.id];
                  return (
                    <div
                      key={panel.id}
                      className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] gap-2 px-3 py-2 text-sm"
                    >
                      <span>{panel.label}</span>
                      <span className="text-muted-foreground">
                        {counts.total_qty}
                      </span>
                      <span className="text-muted-foreground">
                        {counts.clerestory_qty}
                      </span>
                      <span className="text-muted-foreground">
                        {counts.replacement_qty}
                      </span>
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
          <div className="text-xs text-muted-foreground">
            Total installation value: {computed.breakdown.total_install_value.toFixed(2)}
          </div>
        </section>

        <Separator />

        <section className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Calculated Totals</p>
            <p className="text-xs text-muted-foreground">
              These values feed the proposal PDF fields.
            </p>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Product price", computed.totals.product_price],
              ["Bucking price", computed.totals.bucking_price],
              ["Waterproofing price", computed.totals.waterproofing_price],
              ["Installation price", computed.totals.installation_price],
              ["Total contract", computed.totals.total_contract_price],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-semibold text-foreground">
                  {value.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            ))}
          </div>
          <Separator />
          <div className="grid gap-3 md:grid-cols-2">
            {[
              ["Material draw 1", computed.schedule.material_draw_1],
              ["Material draw 2", computed.schedule.material_draw_2],
              ["Material draw 3", computed.schedule.material_draw_3],
              ["Mobilization deposit", computed.schedule.mobilization_deposit],
              ["Install draw 1", computed.schedule.installation_draw_1],
              ["Install draw 2", computed.schedule.installation_draw_2],
              ["Final payment", computed.schedule.final_payment],
            ].map(([label, value]) => (
              <div key={label} className="flex items-center justify-between gap-4">
                <span className="text-sm text-muted-foreground">{label}</span>
                <span className="text-sm font-semibold text-foreground">
                  {value.toLocaleString("en-US", {
                    minimumFractionDigits: 2,
                    maximumFractionDigits: 2,
                  })}
                </span>
              </div>
            ))}
          </div>
        </section>

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
