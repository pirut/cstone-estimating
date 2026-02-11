"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import estimateFields from "@/config/estimate-fields.json";
import { uploadFiles } from "@/components/uploadthing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input, inputVariants } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { LibraryItem, UploadedFile } from "@/lib/types";
import {
  computeEstimate,
  createId,
  DEFAULT_DRAFT,
  roundUp,
  toNumber,
  type BuckingLineItem,
  type EstimateDraft,
  type PanelType,
  type ProductItem,
} from "@/lib/estimate-calculator";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";

const EMPTY_VALUES: Record<string, string | number> = {};
const inputClassName = inputVariants({ uiSize: "default" });
const inputSmClassName = inputVariants({ uiSize: "sm" });

const REQUIRED_INFO_FIELDS: Array<keyof EstimateDraft["info"]> = [
  "prepared_for",
  "project_name",
  "proposal_date",
];

type EstimateBuilderCardProps = {
  values: Record<string, string | number>;
  onValuesChange: (values: Record<string, string | number>) => void;
  name: string;
  onNameChange: (name: string) => void;
  selectedEstimate?: UploadedFile | null;
  onSelectEstimate?: (estimate: UploadedFile | null) => void;
  onEstimatePayloadChange?: (payload: Record<string, any> | null) => void;
  loadPayload?: Record<string, any> | null;
  onActivate?: () => void;
  vendors?: Array<{
    id?: string;
    name: string;
    sortOrder?: number;
    isActive?: boolean;
  }>;
  panelTypes?: PanelType[];
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

type AddressSuggestion = {
  id: string;
  projectName: string;
  cityStateZip: string;
  fullAddress: string;
};

export function EstimateBuilderCard({
  values: _values,
  onValuesChange,
  name,
  onNameChange,
  selectedEstimate,
  onSelectEstimate,
  onEstimatePayloadChange,
  loadPayload,
  onActivate,
  vendors,
  panelTypes,
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
  const [addressSuggestions, setAddressSuggestions] = useState<
    AddressSuggestion[]
  >([]);
  const [isAddressLookupLoading, setIsAddressLookupLoading] = useState(false);
  const [addressLookupError, setAddressLookupError] = useState<string | null>(null);
  const [addressLookupOpen, setAddressLookupOpen] = useState(false);
  const addressLookupRequestRef = useRef(0);

  const groupList = useMemo(() => estimateFields.groups ?? [], []);

  const vendorOptions = useMemo(() => {
    const source = vendors ?? [];
    const normalized = source.map((vendor, index) => ({
      id: vendor.id ?? `${vendor.name}-${index}`,
      name: vendor.name,
      sortOrder:
        typeof vendor.sortOrder === "number" ? vendor.sortOrder : index + 1,
      isActive: vendor.isActive !== false,
    }));
    return normalized
      .filter((vendor) => vendor.isActive)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
  }, [vendors]);

  const panelTypeOptions = useMemo(() => {
    return panelTypes ?? [];
  }, [panelTypes]);

  const computed = useMemo(
    () => computeEstimate(draft, panelTypeOptions),
    [draft, panelTypeOptions]
  );
  const projectNameValue = String(draft.info.project_name ?? "").trim();

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
      values: computed.pdfValues,
      info: draft.info,
      products: draft.products,
      bucking: draft.bucking,
      calculator: draft.calculator,
      totals: computed.totals,
      schedule: computed.schedule,
      breakdown: computed.breakdown,
    });
  }, [computed, draft, legacyValues, name, onEstimatePayloadChange, onValuesChange]);

  useEffect(() => {
    if (!loadPayload) return;

    if (loadPayload.values && !loadPayload.calculator) {
      setLegacyValues(loadPayload.values as Record<string, string | number>);
      setDraft(DEFAULT_DRAFT);
      return;
    }

    const nextDraft: EstimateDraft = {
      info: loadPayload.info ?? DEFAULT_DRAFT.info,
      products:
        Array.isArray(loadPayload.products) && loadPayload.products.length
          ? loadPayload.products
          : DEFAULT_DRAFT.products,
      bucking:
        Array.isArray(loadPayload.bucking) && loadPayload.bucking.length
          ? loadPayload.bucking
          : DEFAULT_DRAFT.bucking,
      calculator: {
        ...DEFAULT_DRAFT.calculator,
        ...(loadPayload.calculator ?? {}),
      },
    };

    setLegacyValues(null);
    setDraft(nextDraft);
  }, [loadPayload]);

  useEffect(() => {
    if (legacyValues || !addressLookupOpen) {
      setAddressSuggestions([]);
      setIsAddressLookupLoading(false);
      setAddressLookupError(null);
      return;
    }

    if (projectNameValue.length < 4) {
      setAddressSuggestions([]);
      setIsAddressLookupLoading(false);
      setAddressLookupError(null);
      return;
    }

    const requestId = ++addressLookupRequestRef.current;
    const lookupTimeout = window.setTimeout(async () => {
      setIsAddressLookupLoading(true);
      setAddressLookupError(null);

      try {
        const response = await fetch(
          `/api/address-autofill?q=${encodeURIComponent(projectNameValue)}`,
          { cache: "no-store" }
        );
        if (!response.ok) {
          const data = await response.json().catch(() => null);
          throw new Error(data?.error || "Address lookup failed.");
        }
        const data = (await response.json()) as {
          suggestions?: AddressSuggestion[];
        };
        if (addressLookupRequestRef.current !== requestId) return;
        setAddressSuggestions(
          Array.isArray(data.suggestions) ? data.suggestions : []
        );
      } catch (err) {
        if (addressLookupRequestRef.current !== requestId) return;
        const message =
          err instanceof Error ? err.message : "Address lookup failed.";
        setAddressSuggestions([]);
        setAddressLookupError(message);
      } finally {
        if (addressLookupRequestRef.current === requestId) {
          setIsAddressLookupLoading(false);
        }
      }
    }, 250);

    return () => window.clearTimeout(lookupTimeout);
  }, [legacyValues, projectNameValue, addressLookupOpen]);

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

  const handleSelectAddressSuggestion = (suggestion: AddressSuggestion) => {
    handleDraftChange({
      ...draft,
      info: {
        ...draft.info,
        project_name: suggestion.projectName,
        city_state_zip: suggestion.cityStateZip,
      },
    });
    if (!name.trim()) {
      onNameChange(suggestion.projectName);
    }
    setAddressSuggestions([]);
    setAddressLookupError(null);
    setAddressLookupOpen(false);
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
    setAddressSuggestions([]);
    setIsAddressLookupLoading(false);
    setAddressLookupError(null);
    setAddressLookupOpen(false);
    onValuesChange(EMPTY_VALUES);
    onNameChange("");
    onSelectEstimate?.(null);
    onEstimatePayloadChange?.(null);
    setSaveStatus(null);
    setSaveError(null);
    setLoadError(null);
  };

  const projectStepComplete = REQUIRED_INFO_FIELDS.every((field) =>
    String(draft.info[field] ?? "").trim()
  );
  const productStepComplete = draft.products.some(
    (item) => item.name.trim() && toNumber(item.price) > 0
  );
  const buckingStepComplete = draft.bucking.some(
    (item) => toNumber(item.qty) > 0 && toNumber(item.sqft) > 0
  );
  const installStepComplete = computed.totals.total_contract_price > 0;

  const stepProgress = [
    {
      id: "project",
      label: "Project Details",
      done: projectStepComplete,
      locked: false,
    },
    {
      id: "products",
      label: "Product Pricing",
      done: productStepComplete,
      locked: !projectStepComplete,
    },
    {
      id: "bucking",
      label: "Bucking & Waterproof",
      done: buckingStepComplete,
      locked: !projectStepComplete || !productStepComplete,
    },
    {
      id: "install",
      label: "Install Calculator",
      done: installStepComplete,
      locked: !projectStepComplete || !productStepComplete || !buckingStepComplete,
    },
    {
      id: "review",
      label: "Review Totals",
      done: installStepComplete,
      locked: !projectStepComplete || !productStepComplete || !buckingStepComplete,
    },
  ] as const;

  const completedCount = stepProgress.filter((step) => step.done).length;
  const completionPercent = Math.round((completedCount / stepProgress.length) * 100);

  const showProducts = projectStepComplete;
  const showBucking = showProducts && productStepComplete;
  const showInstall = showBucking && buckingStepComplete;

  return (
    <Card className="relative overflow-hidden rounded-3xl border-border/60 bg-card/80 shadow-elevated">
      <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-accent/10 to-transparent" />
      <CardHeader className="relative space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="space-y-2">
            <Badge variant="muted" className="bg-muted/80 text-[10px]">
              Step 1
            </Badge>
            <CardTitle className="text-2xl font-serif">Manual Estimate Builder</CardTitle>
            <CardDescription>
              Complete each section to unlock the next and keep calculations clean.
            </CardDescription>
          </div>
          <Badge variant="outline" className="bg-background/80">
            Guided workflow
          </Badge>
        </div>

        <div className="space-y-2 rounded-xl border border-border/60 bg-background/65 p-3">
          <div className="flex items-center justify-between text-xs uppercase tracking-[0.2em] text-muted-foreground">
            <span>Completion</span>
            <span>{completionPercent}%</span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-accent transition-all duration-300"
              style={{ width: `${completionPercent}%` }}
            />
          </div>
          <div className="grid gap-2 md:grid-cols-5">
            {stepProgress.map((step) => (
              <div
                key={step.id}
                className={cn(
                  "flex items-center gap-2 rounded-lg border px-2 py-2 text-xs",
                  step.done && "border-accent/40 bg-accent/10 text-foreground",
                  !step.done && !step.locked && "border-border/60 bg-muted/20 text-muted-foreground",
                  step.locked && "border-border/50 bg-background/80 text-muted-foreground/80"
                )}
              >
                {step.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                ) : step.locked ? (
                  <LockKeyhole className="h-3.5 w-3.5" />
                ) : (
                  <CircleDashed className="h-3.5 w-3.5" />
                )}
                <span className="truncate">{step.label}</span>
              </div>
            ))}
          </div>
        </div>
      </CardHeader>

      <CardContent className="relative space-y-6">
        {legacyValues ? (
          <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800">
            Legacy estimate loaded. Convert to the new calculator to use the guided flow.
            <div className="mt-3">
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
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {saveError}
          </div>
        ) : null}
        {loadError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {loadError}
          </div>
        ) : null}
        {saveStatus ? (
          <div className="rounded-xl border border-border/60 bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
            {saveStatus}
          </div>
        ) : null}

        <section className="space-y-4 rounded-2xl border border-border/60 bg-background/65 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Estimate Session</p>
              <p className="text-xs text-muted-foreground">
                Name this estimate and save snapshots anytime.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="accent" onClick={handleSave} disabled={isSaving}>
                {isSaving ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                {isSaving ? "Saving..." : "Save estimate"}
              </Button>
              <Button variant="outline" onClick={handleClear} disabled={isSaving}>
                Clear
              </Button>
            </div>
          </div>
          <div className="space-y-2">
            <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
              Estimate name
            </label>
            <Input
              className={inputClassName}
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
        </section>

        <section className="space-y-4 rounded-2xl border border-border/60 bg-background/65 p-4">
          <SectionHeader
            title="Project Details"
            description="These values populate the proposal cover and headers."
            done={projectStepComplete}
          />
          <div className="grid gap-3 md:grid-cols-2">
            {groupList.flatMap((group) =>
              group.fields.map((field) => {
                const fieldValue =
                  draft.info[field.key as keyof EstimateDraft["info"]] ?? "";
                const isDate = field.type === "date";
                const isRequired = REQUIRED_INFO_FIELDS.includes(
                  field.key as keyof EstimateDraft["info"]
                );
                const isProjectNameField = field.key === "project_name";
                const isCityStateZipField = field.key === "city_state_zip";

                return (
                  <div key={field.key} className="space-y-2">
                    <label className="flex items-center gap-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                      <span>{field.label}</span>
                      {isRequired ? (
                        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground">
                          Required
                        </span>
                      ) : null}
                    </label>
                    {isDate ? (
                      <DatePicker
                        value={String(fieldValue)}
                        onChange={(value) => handleInfoChange(field.key, value)}
                        placeholder={field.placeholder ?? "Pick a date"}
                        disabled={Boolean(legacyValues)}
                      />
                    ) : (
                      <div className="space-y-2">
                        <Input
                          className={inputClassName}
                          type="text"
                          placeholder={field.placeholder ?? ""}
                          value={fieldValue}
                          autoComplete={
                            isProjectNameField
                              ? "organization"
                              : isCityStateZipField
                                ? "postal-code"
                                : undefined
                          }
                          onFocus={() => {
                            if (isProjectNameField) {
                              setAddressLookupOpen(true);
                            }
                          }}
                          onBlur={() => {
                            if (isProjectNameField) {
                              window.setTimeout(
                                () => setAddressLookupOpen(false),
                                120
                              );
                            }
                          }}
                          onChange={(event) => {
                            handleInfoChange(field.key, event.target.value);
                            if (isProjectNameField) {
                              setAddressLookupOpen(true);
                              setAddressLookupError(null);
                            }
                          }}
                          disabled={Boolean(legacyValues)}
                        />
                        {isProjectNameField ? (
                          <div className="space-y-2">
                            <p className="text-xs text-muted-foreground">
                              Type a project address to autofill the city/state/zip.
                            </p>
                            {isAddressLookupLoading ? (
                              <p className="text-xs text-muted-foreground">
                                Looking up addresses...
                              </p>
                            ) : null}
                            {addressLookupError ? (
                              <p className="text-xs text-destructive">
                                {addressLookupError}
                              </p>
                            ) : null}
                            {addressLookupOpen && addressSuggestions.length ? (
                              <div className="max-h-48 overflow-auto rounded-lg border border-border/60 bg-card/90">
                                {addressSuggestions.map((suggestion) => (
                                  <button
                                    key={suggestion.id}
                                    type="button"
                                    className="block w-full border-b border-border/60 px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
                                    onMouseDown={(event) => event.preventDefault()}
                                    onClick={() =>
                                      handleSelectAddressSuggestion(suggestion)
                                    }
                                  >
                                    <p className="text-sm font-medium text-foreground">
                                      {suggestion.projectName}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                      {suggestion.cityStateZip || suggestion.fullAddress}
                                    </p>
                                  </button>
                                ))}
                              </div>
                            ) : null}
                            {addressLookupOpen &&
                            !isAddressLookupLoading &&
                            !addressLookupError &&
                            projectNameValue.length >= 4 &&
                            !addressSuggestions.length ? (
                              <p className="text-xs text-muted-foreground">
                                No address matches found.
                              </p>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
          {!projectStepComplete ? (
            <UnlockNotice message="Complete Prepared For, Project Name, and Proposal Date to unlock Product Pricing." />
          ) : null}
        </section>

        {showProducts ? (
          <section className="space-y-4 rounded-2xl border border-border/60 bg-background/65 p-4">
            <SectionHeader
              title="Product Pricing"
              description="Add vendor/product lines and markup values."
              done={productStepComplete}
            />

            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Default product markup
                </label>
                <Input
                  className={inputClassName}
                  value={draft.calculator.product_markup_default}
                  onChange={(event) =>
                    handleCalculatorChange("product_markup_default", event.target.value)
                  }
                  inputMode="decimal"
                  disabled={Boolean(legacyValues)}
                />
              </div>
            </div>
            {!vendorOptions.length ? (
              <UnlockNotice message="No active vendors are configured for this team. Add vendors in Team Admin to use manual estimate dropdowns." />
            ) : null}

            <div className="space-y-3">
              {draft.products.map((item, index) => {
                const price = toNumber(item.price);
                const markup = item.markup.trim()
                  ? toNumber(item.markup)
                  : toNumber(draft.calculator.product_markup_default);
                const total = roundUp(price * (1 + markup));
                const selectedVendor =
                  vendorOptions.find((vendor) => vendor.name === item.name)?.id ?? "__none__";
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-border/60 bg-card/70 p-3"
                  >
                    <div className="grid gap-3 lg:grid-cols-[1.8fr_0.8fr_0.8fr_auto]">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Vendor</label>
                        <Select
                          value={selectedVendor}
                          onValueChange={(value) => {
                            const vendor = vendorOptions.find((entry) => entry.id === value);
                            handleProductChange(index, {
                              name: value === "__none__" ? "" : vendor?.name ?? "",
                            });
                          }}
                          disabled={Boolean(legacyValues) || !vendorOptions.length}
                        >
                          <SelectTrigger className={inputSmClassName}>
                            <SelectValue placeholder="Select vendor" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select vendor</SelectItem>
                            {vendorOptions.map((vendor) => (
                              <SelectItem key={vendor.id} value={vendor.id}>
                                {vendor.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Price</label>
                        <Input
                          className={inputSmClassName}
                          value={item.price}
                          onChange={(event) =>
                            handleProductChange(index, { price: event.target.value })
                          }
                          inputMode="decimal"
                          placeholder="0"
                          disabled={Boolean(legacyValues)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Markup</label>
                        <Input
                          className={inputSmClassName}
                          value={item.markup}
                          onChange={(event) =>
                            handleProductChange(index, { markup: event.target.value })
                          }
                          inputMode="decimal"
                          placeholder={draft.calculator.product_markup_default}
                          disabled={Boolean(legacyValues)}
                        />
                      </div>
                      <div className="flex items-end justify-end gap-2">
                        <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-semibold text-foreground">
                          {Number.isFinite(total) ? formatCurrency(total) : "-"}
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
                          aria-label="Remove product line"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
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
                disabled={Boolean(legacyValues) || !vendorOptions.length}
              >
                <Plus className="h-4 w-4" />
                Add product line
              </Button>
              <div className="text-xs text-muted-foreground">
                Product subtotal: {formatCurrency(computed.totals.product_price)}
              </div>
            </div>

            {!productStepComplete ? (
              <UnlockNotice message="Add at least one product name and price above 0 to unlock Bucking & Waterproof." />
            ) : null}
          </section>
        ) : null}

        {showBucking ? (
          <section className="space-y-4 rounded-2xl border border-border/60 bg-background/65 p-4">
            <SectionHeader
              title="Bucking & Waterproof"
              description="Capture lineal footage and rates for job conditions."
              done={buckingStepComplete}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <RateField
                label="Bucking $/ft"
                value={draft.calculator.bucking_rate}
                onChange={(value) => handleCalculatorChange("bucking_rate", value)}
                disabled={Boolean(legacyValues)}
              />
              <RateField
                label="Waterproofing $/ft"
                value={draft.calculator.waterproofing_rate}
                onChange={(value) =>
                  handleCalculatorChange("waterproofing_rate", value)
                }
                disabled={Boolean(legacyValues)}
              />
              <RateField
                label="Override bucking cost"
                value={draft.calculator.override_bucking_cost}
                onChange={(value) =>
                  handleCalculatorChange("override_bucking_cost", value)
                }
                placeholder="Optional"
                disabled={Boolean(legacyValues)}
              />
              <RateField
                label="Override waterproof cost"
                value={draft.calculator.override_waterproofing_cost}
                onChange={(value) =>
                  handleCalculatorChange("override_waterproofing_cost", value)
                }
                placeholder="Optional"
                disabled={Boolean(legacyValues)}
              />
            </div>

            <div className="space-y-3">
              {!panelTypeOptions.length ? (
                <UnlockNotice message="No active unit types are configured for this team. Add unit types in Team Admin to use bucking dropdowns." />
              ) : null}
              {draft.bucking.map((item, index) => {
                const qty = toNumber(item.qty);
                const sqft = toNumber(item.sqft);
                const lineal = qty ? Math.abs(Math.sqrt((sqft / qty) / 6) * 11) * qty : 0;
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-border/60 bg-card/70 p-3"
                  >
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-6">
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Unit Type</label>
                        <Select
                          value={
                            panelTypeOptions.some((panel) => panel.id === item.unit_type)
                              ? item.unit_type
                              : "__none__"
                          }
                          onValueChange={(value) =>
                            handleBuckingChange(index, {
                              unit_type: value === "__none__" ? "" : value,
                            })
                          }
                          disabled={Boolean(legacyValues) || !panelTypeOptions.length}
                        >
                          <SelectTrigger className={inputSmClassName}>
                            <SelectValue placeholder="Select unit type" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Select unit type</SelectItem>
                            {panelTypeOptions.map((panel) => (
                              <SelectItem key={panel.id} value={panel.id}>
                                {panel.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Qty</label>
                        <Input
                          className={inputSmClassName}
                          value={item.qty}
                          onChange={(event) =>
                            handleBuckingChange(index, { qty: event.target.value })
                          }
                          inputMode="decimal"
                          placeholder="0"
                          disabled={Boolean(legacyValues)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">SqFt</label>
                        <Input
                          className={inputSmClassName}
                          value={item.sqft}
                          onChange={(event) =>
                            handleBuckingChange(index, { sqft: event.target.value })
                          }
                          inputMode="decimal"
                          placeholder="0"
                          disabled={Boolean(legacyValues)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Replacement</label>
                        <Input
                          className={inputSmClassName}
                          value={item.replacement_qty}
                          onChange={(event) =>
                            handleBuckingChange(index, {
                              replacement_qty: event.target.value,
                            })
                          }
                          inputMode="decimal"
                          placeholder="0"
                          disabled={Boolean(legacyValues)}
                        />
                      </div>
                      <div className="space-y-1">
                        <label className="text-xs text-muted-foreground">Clerestory</label>
                        <Input
                          className={inputSmClassName}
                          value={item.clerestory_qty}
                          onChange={(event) =>
                            handleBuckingChange(index, {
                              clerestory_qty: event.target.value,
                            })
                          }
                          inputMode="decimal"
                          placeholder="0"
                          disabled={Boolean(legacyValues)}
                        />
                      </div>
                      <div className="flex items-end justify-between gap-2">
                        <div className="rounded-lg border border-border/60 bg-background px-3 py-2 text-sm font-semibold text-foreground">
                          {lineal ? `${lineal.toFixed(2)} ft` : "-"}
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
                          aria-label="Remove bucking line"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
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
                        unit_type: panelTypeOptions[0]?.id ?? "",
                        qty: "",
                        sqft: "",
                        replacement_qty: "",
                        clerestory_qty: "",
                      },
                    ],
                  })
                }
                disabled={Boolean(legacyValues) || !panelTypeOptions.length}
              >
                <Plus className="h-4 w-4" />
                Add line item
              </Button>
              <div className="text-xs text-muted-foreground">
                Total lineal ft: {computed.breakdown.total_lineal_ft.toFixed(2)}
              </div>
            </div>

            {!buckingStepComplete ? (
              <UnlockNotice message="Add at least one line with Qty and SqFt to unlock Install Calculator." />
            ) : null}
          </section>
        ) : null}

        {showInstall ? (
          <section className="space-y-4 rounded-2xl border border-border/60 bg-background/65 p-4">
            <SectionHeader
              title="Install Calculator"
              description="Control install markup, rentals, and optional overrides."
              done={installStepComplete}
            />

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              <RateField
                label="Install markup"
                value={draft.calculator.install_markup}
                onChange={(value) => handleCalculatorChange("install_markup", value)}
                disabled={Boolean(legacyValues)}
              />
              <RateField
                label="Rentals"
                value={draft.calculator.rentals}
                onChange={(value) => handleCalculatorChange("rentals", value)}
                placeholder="0"
                disabled={Boolean(legacyValues)}
              />
              <RateField
                label="Override total install"
                value={draft.calculator.override_install_total}
                onChange={(value) =>
                  handleCalculatorChange("override_install_total", value)
                }
                placeholder="Optional"
                disabled={Boolean(legacyValues)}
              />
            </div>

            <div className="rounded-xl border border-border/60 bg-card/70 p-3">
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Panel count summary
              </p>
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                {panelTypeOptions.map((panel) => {
                  const counts = computed.panelCounts[panel.id];
                  return (
                    <div
                      key={panel.id}
                      className="rounded-lg border border-border/60 bg-background px-3 py-2"
                    >
                      <p className="text-sm font-semibold text-foreground">{panel.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Qty {counts.total_qty} | Clerestory {counts.clerestory_qty} | Replacement {counts.replacement_qty}
                      </p>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="text-xs text-muted-foreground">
              Total installation value: {formatCurrency(computed.breakdown.total_install_value)}
            </div>
          </section>
        ) : null}

        {showInstall ? (
          <section className="space-y-4 rounded-2xl border border-border/60 bg-background/65 p-4">
            <SectionHeader
              title="Calculated Totals"
              description="These values are sent to the proposal PDF field mapping."
              done={installStepComplete}
            />

            <div className="grid gap-3 md:grid-cols-2">
              {[
                ["Product price", computed.totals.product_price],
                ["Bucking price", computed.totals.bucking_price],
                ["Waterproofing price", computed.totals.waterproofing_price],
                ["Installation price", computed.totals.installation_price],
                ["Total contract", computed.totals.total_contract_price],
              ].map(([label, value]) => (
                <div
                  key={label}
                  className="flex items-center justify-between rounded-lg border border-border/60 bg-card/70 px-3 py-2"
                >
                  <span className="text-sm text-muted-foreground">{label}</span>
                  <span className="text-sm font-semibold text-foreground">
                    {formatCurrency(value as number)}
                  </span>
                </div>
              ))}
            </div>

            <Separator />

            <div>
              <p className="mb-2 text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
                Payment schedule
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {[
                  ["Material draw 1", computed.schedule.material_draw_1],
                  ["Material draw 2", computed.schedule.material_draw_2],
                  ["Material draw 3", computed.schedule.material_draw_3],
                  ["Mobilization deposit", computed.schedule.mobilization_deposit],
                  ["Install draw 1", computed.schedule.installation_draw_1],
                  ["Install draw 2", computed.schedule.installation_draw_2],
                  ["Final payment", computed.schedule.final_payment],
                ].map(([label, value]) => (
                  <div
                    key={label}
                    className="flex items-center justify-between rounded-lg border border-border/60 bg-card/70 px-3 py-2"
                  >
                    <span className="text-sm text-muted-foreground">{label}</span>
                    <span className="text-sm font-semibold text-foreground">
                      {formatCurrency(value as number)}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            <div className="rounded-xl border border-accent/30 bg-accent/10 px-3 py-3 text-sm text-foreground">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-accent" />
                Ready to generate. Your totals and schedule are synced into the PDF payload.
              </div>
            </div>
          </section>
        ) : null}

        <section className="space-y-3">
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
            <ScrollArea className="h-56 rounded-xl border border-border/70 bg-background/70">
              <div className="divide-y divide-border/60">
                {library.items.map((item) => (
                  <div
                    key={item.key}
                    className="flex items-center justify-between gap-4 px-4 py-3"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{item.name}</p>
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
        </section>
      </CardContent>
    </Card>
  );
}

function SectionHeader({
  title,
  description,
  done,
}: {
  title: string;
  description: string;
  done: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <p className="text-sm font-semibold text-foreground">{title}</p>
        <p className="text-xs text-muted-foreground">{description}</p>
      </div>
      <Badge
        variant={done ? "accent" : "outline"}
        className={cn("text-[10px]", done && "bg-accent/90")}
      >
        {done ? "Complete" : "In progress"}
      </Badge>
    </div>
  );
}

function UnlockNotice({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-border/60 bg-muted/30 px-3 py-3 text-sm text-muted-foreground">
      <LockKeyhole className="mt-0.5 h-4 w-4" />
      <span>{message}</span>
    </div>
  );
}

function RateField({
  label,
  value,
  onChange,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </label>
      <Input
        className={inputClassName}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode="decimal"
        placeholder={placeholder}
        disabled={disabled}
      />
    </div>
  );
}

function formatCurrency(value: number) {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function stripJsonExtension(name: string) {
  return name.replace(/\.json$/i, "");
}
