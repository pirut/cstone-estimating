"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import estimateFields from "@/config/estimate-fields.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input, inputVariants } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import type { UploadedFile } from "@/lib/types";
import {
  computeEuroPricingTotals,
  createDefaultProductItem,
  createDefaultEuroPricing,
  computeEstimate,
  createId,
  DEFAULT_DRAFT,
  EURO_DEFAULT_FLUFF,
  roundUp,
  resolveProductBasePrice,
  toNumber,
  type BuckingLineItem,
  type EuroPricing,
  type EuroPricingSectionLine,
  type EstimateDraft,
  type PanelType,
  type ProductItem,
} from "@/lib/estimate-calculator";
import {
  EMPTY_PRODUCT_FEATURE_SELECTION,
  PRODUCT_FEATURE_SELECT_FIELDS,
  type ProductFeatureOption,
  type ProductFeatureSelection,
} from "@/lib/product-features";
import { cn } from "@/lib/utils";
import {
  CheckCircle2,
  CircleDashed,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";

const EMPTY_VALUES: Record<string, string | number> = {};
const inputClassName = inputVariants({ uiSize: "default" });
const inputSmClassName = inputVariants({ uiSize: "sm" });

const REQUIRED_INFO_FIELDS: Array<keyof EstimateDraft["info"]> = [
  "prepared_for",
  "project_name",
  "project_type",
  "proposal_date",
];

type EstimateBuilderCardProps = {
  values: Record<string, string | number>;
  onValuesChange: (values: Record<string, string | number>) => void;
  name: string;
  onNameChange: (name: string) => void;
  preparedByName?: string;
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
    allowsSplitFinish?: boolean;
    usesEuroPricing?: boolean;
  }>;
  panelTypes?: PanelType[];
  productFeatureOptions?: ProductFeatureOption[];
  projectTypeOptions?: string[];
};

type AddressSuggestion = {
  id: string;
  projectName: string;
  cityStateZip: string;
  fullAddress: string;
};

type ExchangeRateResponse = {
  from: string;
  to: string;
  rate: number;
  asOf: string;
};

type ExchangeRateStatusByProduct = Record<
  string,
  {
    loading: boolean;
    error: string | null;
  }
>;

function vendorSupportsEuroPricing(vendor: {
  name?: string;
  usesEuroPricing?: boolean;
} | null) {
  if (!vendor) return false;
  if (vendor.usesEuroPricing === true) return true;
  if (vendor.usesEuroPricing === false) return false;
  const name = String(vendor.name ?? "").trim().toLowerCase();
  if (!name) return false;
  return /\b(eur|euro)\b/.test(name) || name.includes("€");
}

function normalizeLoadedEuroPricing(
  source: unknown,
  fallback: EuroPricing
): EuroPricing {
  const input =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Partial<EuroPricing>)
      : null;
  const liveRateRaw = toNumber(input?.liveRate);
  const fluffRaw = toNumber(input?.fluff);
  const appliedRateRaw = toNumber(input?.appliedRate);
  const sectionsRaw = Array.isArray(input?.sections) ? input.sections : [];
  const normalizedSections = sectionsRaw.reduce<EuroPricingSectionLine[]>(
    (result, section) => {
      if (!section || typeof section !== "object") return result;
      const entry = section as Partial<EuroPricingSectionLine>;
      const label = String(entry.label ?? "").trim();
      if (!label) return result;
      result.push({
        id: String(entry.id ?? createId("euro")),
        label,
        amount: typeof entry.amount === "string" ? entry.amount : "",
        isMisc: entry.isMisc === true,
      });
      return result;
    },
    []
  );

  const hasMisc = normalizedSections.some((entry) => entry.isMisc);
  const fallbackMisc = fallback.sections.filter((entry) => entry.isMisc);
  const sections =
    normalizedSections.length > 0
      ? hasMisc
        ? normalizedSections
        : [...normalizedSections, ...fallbackMisc]
      : fallback.sections;

  return {
    liveRate:
      liveRateRaw > 0
        ? liveRateRaw.toFixed(4)
        : toNumber(fallback.liveRate).toFixed(4),
    fluff:
      Number.isFinite(fluffRaw) && fluffRaw >= 0
        ? fluffRaw.toFixed(2)
        : toNumber(fallback.fluff).toFixed(2),
    appliedRate:
      appliedRateRaw > 0
        ? appliedRateRaw.toFixed(4)
        : toNumber(fallback.appliedRate).toFixed(4),
    sections,
    lastUpdatedOn:
      typeof input?.lastUpdatedOn === "string" ? input.lastUpdatedOn : undefined,
  };
}

function buildProductFromPatch(
  item: ProductItem,
  patch: Partial<ProductItem>
): ProductItem {
  const merged = { ...item, ...patch };
  if (!merged.split_finish) {
    merged.exterior_frame_color = merged.interior_frame_color;
  }
  if (merged.euroPricingEnabled && !merged.euroPricing) {
    merged.euroPricing = createDefaultEuroPricing();
  }
  if (merged.euroPricingEnabled && merged.euroPricing) {
    const { usdSubtotal } = computeEuroPricingTotals(merged.euroPricing);
    merged.price = usdSubtotal > 0 ? usdSubtotal.toFixed(2) : "";
  }
  return merged;
}

function normalizeLoadedProductFeatures(
  source: Partial<ProductItem> | null | undefined
): ProductFeatureSelection {
  const getValue = (key: keyof ProductFeatureSelection) => {
    const value = source?.[key];
    return typeof value === "string" ? value : "";
  };
  return {
    interior_frame_color: getValue("interior_frame_color"),
    exterior_frame_color: getValue("exterior_frame_color"),
    glass_type: getValue("glass_type"),
    glass_makeup: getValue("glass_makeup"),
    stainless_operating_hardware:
      source?.stainless_operating_hardware === true,
    has_screens: source?.has_screens === true,
    door_hardware_color: getValue("door_hardware_color"),
    door_hinge_color: getValue("door_hinge_color"),
    window_hardware_color: getValue("window_hardware_color"),
  };
}

function normalizeLoadedProduct(
  source: Partial<ProductItem> | null | undefined,
  fallbackId: string
): ProductItem {
  const base = createDefaultProductItem(fallbackId);
  const features = normalizeLoadedProductFeatures(source);
  const interior = features.interior_frame_color;
  const splitFinish = source?.split_finish === true;
  const exterior = splitFinish
    ? features.exterior_frame_color
    : features.exterior_frame_color || interior;
  const euroPricingEnabled = source?.euroPricingEnabled === true;
  const fallbackEuroPricing = createDefaultEuroPricing();

  return buildProductFromPatch(
    base,
    {
    ...base,
    id: String(source?.id ?? base.id),
    vendorId: typeof source?.vendorId === "string" ? source.vendorId : "",
    name: typeof source?.name === "string" ? source.name : "",
    price: typeof source?.price === "string" ? source.price : "",
    markup:
      typeof source?.markup === "string" && source.markup.trim() !== ""
        ? source.markup
        : base.markup,
    split_finish: splitFinish,
    euroPricingEnabled,
    euroPricing: euroPricingEnabled
      ? normalizeLoadedEuroPricing(source?.euroPricing, fallbackEuroPricing)
      : undefined,
    ...features,
    exterior_frame_color: exterior,
  });
}

export function EstimateBuilderCard({
  values: _values,
  onValuesChange,
  name,
  onNameChange,
  preparedByName,
  selectedEstimate,
  onSelectEstimate,
  onEstimatePayloadChange,
  loadPayload,
  onActivate,
  vendors,
  panelTypes,
  productFeatureOptions,
  projectTypeOptions,
}: EstimateBuilderCardProps) {
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
  const [exchangeRateStatusByProduct, setExchangeRateStatusByProduct] =
    useState<ExchangeRateStatusByProduct>({});
  const addressLookupRequestRef = useRef(0);
  const normalizedPreparedByName = preparedByName?.trim() ?? "";

  const groupList = useMemo(() => estimateFields.groups ?? [], []);

  const vendorOptions = useMemo(() => {
    const source = vendors ?? [];
    const normalized = source.map((vendor, index) => ({
      id: vendor.id ?? `${vendor.name}-${index}`,
      name: vendor.name,
      sortOrder:
        typeof vendor.sortOrder === "number" ? vendor.sortOrder : index + 1,
      isActive: vendor.isActive !== false,
      allowsSplitFinish: vendor.allowsSplitFinish === true,
      usesEuroPricing: vendor.usesEuroPricing === true,
    }));
    return normalized
      .filter((vendor) => vendor.isActive)
      .sort((a, b) => {
        if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
        return a.name.localeCompare(b.name);
      });
  }, [vendors]);

  const normalizedProductFeatureOptions = useMemo(() => {
    return (productFeatureOptions ?? [])
      .map((option, index) => {
        const category = option.category;
        if (!category) return null;
        const label = String(option.label ?? "").trim();
        if (!label) return null;
        return {
          id: option.id ?? `${category}-${index}`,
          category,
          label,
          vendorId:
            typeof option.vendorId === "string" && option.vendorId.trim()
              ? option.vendorId
              : "",
          sortOrder:
            typeof option.sortOrder === "number" && Number.isFinite(option.sortOrder)
              ? option.sortOrder
              : index + 1,
          isActive: option.isActive !== false,
        };
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry))
      .filter((entry) => entry.isActive)
      .sort((a, b) => {
        if (a.category !== b.category) {
          return a.category.localeCompare(b.category);
        }
        if (a.sortOrder !== b.sortOrder) {
          return a.sortOrder - b.sortOrder;
        }
        return a.label.localeCompare(b.label);
      });
  }, [productFeatureOptions]);

  const panelTypeOptions = useMemo(() => {
    return panelTypes ?? [];
  }, [panelTypes]);
  const normalizedProjectTypeOptions = useMemo(() => {
    const source = Array.isArray(projectTypeOptions) ? projectTypeOptions : [];
    const seen = new Set<string>();
    const normalized: string[] = [];
    source.forEach((entry) => {
      const option = String(entry ?? "").trim();
      if (!option || seen.has(option)) return;
      seen.add(option);
      normalized.push(option);
    });
    return normalized;
  }, [projectTypeOptions]);

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
      setExchangeRateStatusByProduct({});
      return;
    }

    const nextDraft: EstimateDraft = {
      info: loadPayload.info ?? DEFAULT_DRAFT.info,
      products:
        Array.isArray(loadPayload.products) && loadPayload.products.length
          ? loadPayload.products.map((item, index) =>
              normalizeLoadedProduct(
                item as Partial<ProductItem>,
                createId(`product-${index + 1}`)
              )
            )
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
    setExchangeRateStatusByProduct({});
  }, [loadPayload]);

  useEffect(() => {
    if (legacyValues || !normalizedPreparedByName) return;
    setDraft((prev) => {
      if (
        String(prev.info.prepared_by ?? "").trim() === normalizedPreparedByName
      ) {
        return prev;
      }
      return {
        ...prev,
        info: {
          ...prev.info,
          prepared_by: normalizedPreparedByName,
        },
      };
    });
  }, [legacyValues, normalizedPreparedByName]);

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
      idx === index ? buildProductFromPatch(item, patch) : item
    );
    handleDraftChange({
      ...draft,
      products: next,
    });
  };

  const updateProductById = useCallback(
    (productId: string, updater: (item: ProductItem) => ProductItem) => {
      setDraft((prev) => ({
        ...prev,
        products: prev.products.map((item) =>
          item.id === productId ? updater(item) : item
        ),
      }));
      setLegacyValues(null);
      onActivate?.();
    },
    [onActivate]
  );

  const refreshEuroExchangeRate = useCallback(async (productId: string) => {
    setExchangeRateStatusByProduct((prev) => ({
      ...prev,
      [productId]: { loading: true, error: null },
    }));

    try {
      const response = await fetch("/api/exchange-rate?from=EUR&to=USD", {
        cache: "no-store",
      });
      const data = (await response.json().catch(() => null)) as
        | ExchangeRateResponse
        | { error?: string }
        | null;
      if (!response.ok || !data || typeof (data as ExchangeRateResponse).rate !== "number") {
        const message =
          data &&
          typeof data === "object" &&
          "error" in data &&
          typeof data.error === "string"
            ? data.error
            : "Failed to load EUR rate.";
        throw new Error(
          message
        );
      }
      const payload = data as ExchangeRateResponse;
      const liveRate = payload.rate;

      updateProductById(productId, (product) => {
        if (!product.euroPricingEnabled) return product;
        const currentPricing = product.euroPricing ?? createDefaultEuroPricing();
        const fluff = toNumber(currentPricing.fluff);
        const nextPricing: EuroPricing = {
          ...currentPricing,
          liveRate: liveRate.toFixed(4),
          appliedRate: (liveRate + Math.max(0, fluff)).toFixed(4),
          lastUpdatedOn: payload.asOf,
        };
        return buildProductFromPatch(product, {
          euroPricing: nextPricing,
          euroPricingEnabled: true,
        });
      });

      setExchangeRateStatusByProduct((prev) => ({
        ...prev,
        [productId]: { loading: false, error: null },
      }));
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to load EUR rate.";
      setExchangeRateStatusByProduct((prev) => ({
        ...prev,
        [productId]: { loading: false, error: message },
      }));
    }
  }, [updateProductById]);

  useEffect(() => {
    if (legacyValues) return;
    draft.products.forEach((item) => {
      if (!item.euroPricingEnabled) return;
      const liveRate = toNumber(item.euroPricing?.liveRate);
      const status = exchangeRateStatusByProduct[item.id];
      if (liveRate > 0 || status?.loading) return;
      void refreshEuroExchangeRate(item.id);
    });
  }, [
    draft.products,
    exchangeRateStatusByProduct,
    legacyValues,
    refreshEuroExchangeRate,
  ]);

  const resolveVendorForProduct = (item: ProductItem) => {
    if (item.vendorId) {
      const byId = vendorOptions.find((vendor) => vendor.id === item.vendorId);
      if (byId) return byId;
    }
    return (
      vendorOptions.find((vendor) => vendor.name === item.name) ??
      null
    );
  };

  const getFeatureOptionsForProduct = (
    item: ProductItem,
    category: ProductFeatureOption["category"]
  ) => {
    const vendorId = resolveVendorForProduct(item)?.id ?? "";
    return normalizedProductFeatureOptions.filter((option) => {
      if (option.category !== category) return false;
      if (!option.vendorId) return true;
      return Boolean(vendorId) && option.vendorId === vendorId;
    });
  };

  const getFrameColorOptionsForProduct = (item: ProductItem) => {
    const seen = new Set<string>();
    const combined = [
      ...getFeatureOptionsForProduct(item, "interior_frame_color"),
      ...getFeatureOptionsForProduct(item, "exterior_frame_color"),
    ];
    return combined.filter((option) => {
      const key = option.label.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
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

  const handleClear = () => {
    setDraft(DEFAULT_DRAFT);
    setLegacyValues(null);
    setAddressSuggestions([]);
    setIsAddressLookupLoading(false);
    setAddressLookupError(null);
    setAddressLookupOpen(false);
    setExchangeRateStatusByProduct({});
    onValuesChange(EMPTY_VALUES);
    onNameChange("");
    onSelectEstimate?.(null);
    onEstimatePayloadChange?.(null);
  };

  const projectStepComplete = REQUIRED_INFO_FIELDS.every((field) =>
    String(draft.info[field] ?? "").trim()
  );
  const productStepComplete = draft.products.some(
    (item) => item.name.trim() && resolveProductBasePrice(item) > 0
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

        <section className="space-y-4 rounded-2xl border border-border/60 bg-background/65 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-foreground">Estimate Session</p>
              <p className="text-xs text-muted-foreground">
                Name this estimate and manage save/version actions from the action dock.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button variant="outline" onClick={handleClear}>
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
                const selectOptionsFromField = Array.isArray((field as any).options)
                  ? ((field as any).options as unknown[])
                      .map((option) => String(option ?? "").trim())
                      .filter(Boolean)
                  : [];
                const selectOptions =
                  field.key === "project_type" &&
                  normalizedProjectTypeOptions.length
                    ? normalizedProjectTypeOptions
                    : selectOptionsFromField;
                const isProjectNameField = field.key === "project_name";
                const isCityStateZipField = field.key === "city_state_zip";
                const isPreparedByField = field.key === "prepared_by";
                const displayedValue =
                  isPreparedByField && normalizedPreparedByName
                    ? normalizedPreparedByName
                    : fieldValue;
                const currentSelectValue = String(displayedValue ?? "").trim();
                const includeCurrentSelectValue =
                  Boolean(currentSelectValue) &&
                  !selectOptions.includes(currentSelectValue);
                const isSelect = field.type === "select" && selectOptions.length > 0;
                const isRequired = REQUIRED_INFO_FIELDS.includes(
                  field.key as keyof EstimateDraft["info"]
                );
                const infoFieldDisabled =
                  Boolean(legacyValues) ||
                  (isPreparedByField && Boolean(normalizedPreparedByName));

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
                    ) : isSelect ? (
                      <Select
                        value={String(displayedValue || "__none__")}
                        onValueChange={(value) =>
                          handleInfoChange(
                            field.key,
                            value === "__none__" ? "" : value
                          )
                        }
                        disabled={infoFieldDisabled}
                      >
                        <SelectTrigger className={inputClassName}>
                          <SelectValue
                            placeholder={field.placeholder ?? "Select an option"}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">
                            {field.placeholder ?? "Select an option"}
                          </SelectItem>
                          {selectOptions.map((option) => (
                            <SelectItem key={option} value={option}>
                              {option}
                            </SelectItem>
                          ))}
                          {includeCurrentSelectValue ? (
                            <SelectItem value={currentSelectValue}>
                              {currentSelectValue}
                            </SelectItem>
                          ) : null}
                        </SelectContent>
                      </Select>
                    ) : (
                      <div className="space-y-2">
                        <Input
                          className={inputClassName}
                          type="text"
                          placeholder={field.placeholder ?? ""}
                          value={displayedValue}
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
                          disabled={infoFieldDisabled}
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
            <UnlockNotice message="Complete Prepared For, Project Name, Project Type, and Proposal Date to unlock Product Pricing." />
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
                const price = resolveProductBasePrice(item);
                const markup = item.markup.trim()
                  ? toNumber(item.markup)
                  : toNumber(draft.calculator.product_markup_default);
                const total = roundUp(price * (1 + markup));
                const selectedVendorRecord = resolveVendorForProduct(item);
                const selectedVendor = selectedVendorRecord?.id ?? "__none__";
                const usesEuroPricing =
                  vendorSupportsEuroPricing(selectedVendorRecord) ||
                  item.euroPricingEnabled;
                const euroPricing = item.euroPricing ?? createDefaultEuroPricing();
                const euroTotals = computeEuroPricingTotals(euroPricing);
                const rateStatus = exchangeRateStatusByProduct[item.id] ?? {
                  loading: false,
                  error: null,
                };
                const allowsSplitFinish =
                  selectedVendorRecord?.allowsSplitFinish === true;
                const visibleFeatureFields = allowsSplitFinish
                  ? PRODUCT_FEATURE_SELECT_FIELDS
                  : PRODUCT_FEATURE_SELECT_FIELDS.filter(
                      (field) => field.key !== "exterior_frame_color"
                    ).map((field) =>
                      field.key === "interior_frame_color"
                        ? { ...field, label: "Frame color" }
                        : field
                    );
                const featureListLines = [
                  `${
                    allowsSplitFinish ? "Interior frame color" : "Frame color"
                  }: ${item.interior_frame_color || "Not selected"}`,
                  ...(allowsSplitFinish
                    ? [
                        `Exterior frame color: ${
                          item.split_finish
                            ? item.exterior_frame_color || "Not selected"
                            : item.interior_frame_color
                              ? `${item.interior_frame_color} (same as interior)`
                              : "Not selected"
                        }`,
                      ]
                    : []),
                  `Glass type: ${item.glass_type || "Not selected"}`,
                  `Glass make up: ${item.glass_makeup || "Not selected"}`,
                  `Stainless steel operating hardware: ${
                    item.stainless_operating_hardware ? "Yes" : "No"
                  }`,
                  `Screens: ${item.has_screens ? "Yes" : "No"}`,
                  `Door hardware color: ${item.door_hardware_color || "Not selected"}`,
                  `Door hinge color: ${item.door_hinge_color || "Not selected"}`,
                  `Window hardware color: ${
                    item.window_hardware_color || "Not selected"
                  }`,
                ];
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
                            const vendorUsesEuroPricing =
                              value !== "__none__" &&
                              vendorSupportsEuroPricing(vendor ?? null);
                            const nextEuroPricing = vendorUsesEuroPricing
                              ? item.euroPricing ?? createDefaultEuroPricing()
                              : item.euroPricing;
                            handleProductChange(index, {
                              vendorId: value === "__none__" ? "" : vendor?.id ?? "",
                              name: value === "__none__" ? "" : vendor?.name ?? "",
                              split_finish:
                                value === "__none__"
                                  ? false
                                  : vendor?.allowsSplitFinish === true
                                    ? item.split_finish
                                    : false,
                              euroPricingEnabled: vendorUsesEuroPricing,
                              euroPricing: nextEuroPricing,
                            });
                            if (vendorUsesEuroPricing) {
                              void refreshEuroExchangeRate(item.id);
                            }
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
                        <label className="text-xs text-muted-foreground">
                          {usesEuroPricing ? "Price (USD, auto)" : "Price"}
                        </label>
                        <MoneyInput
                          className={inputSmClassName}
                          value={usesEuroPricing ? (price > 0 ? price.toFixed(2) : "") : item.price}
                          onValueChange={(nextValue) =>
                            handleProductChange(index, { price: nextValue })
                          }
                          currency="USD"
                          placeholder="0"
                          disabled={Boolean(legacyValues) || usesEuroPricing}
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
                              products: next.length
                                ? next
                                : [createDefaultProductItem()],
                            });
                          }}
                          disabled={draft.products.length === 1 || Boolean(legacyValues)}
                          aria-label="Remove product line"
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </div>
                    </div>

                    {usesEuroPricing ? (
                      <div className="mt-3 space-y-3 rounded-lg border border-border/60 bg-background/80 p-3">
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                              EUR Cost Calculator
                            </p>
                            <p className="text-xs text-muted-foreground">
                              Mirrors workbook section labels and converts to USD.
                            </p>
                          </div>
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => void refreshEuroExchangeRate(item.id)}
                            disabled={Boolean(legacyValues) || rateStatus.loading}
                          >
                            {rateStatus.loading ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RefreshCw className="h-4 w-4" />
                            )}
                            Refresh rate
                          </Button>
                        </div>
                        {rateStatus.error ? (
                          <p className="text-xs text-destructive">{rateStatus.error}</p>
                        ) : null}
                        <div className="grid gap-3 md:grid-cols-3">
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              Live EUR to USD
                            </label>
                            <Input
                              className={inputSmClassName}
                              value={euroPricing.liveRate}
                              disabled
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              Fluff (default +0.07)
                            </label>
                            <Input
                              className={inputSmClassName}
                              value={euroPricing.fluff}
                              onChange={(event) => {
                                const nextFluff = event.target.value;
                                const liveRate = toNumber(euroPricing.liveRate);
                                const parsedFluff = Math.max(0, toNumber(nextFluff));
                                handleProductChange(index, {
                                  euroPricing: {
                                    ...euroPricing,
                                    fluff: nextFluff,
                                    appliedRate: (liveRate + parsedFluff).toFixed(4),
                                  },
                                  euroPricingEnabled: true,
                                });
                              }}
                              inputMode="decimal"
                              placeholder={EURO_DEFAULT_FLUFF.toFixed(2)}
                              disabled={Boolean(legacyValues)}
                            />
                          </div>
                          <div className="space-y-1">
                            <label className="text-xs text-muted-foreground">
                              Applied rate
                            </label>
                            <Input
                              className={inputSmClassName}
                              value={euroPricing.appliedRate}
                              onChange={(event) =>
                                handleProductChange(index, {
                                  euroPricing: {
                                    ...euroPricing,
                                    appliedRate: event.target.value,
                                  },
                                  euroPricingEnabled: true,
                                })
                              }
                              inputMode="decimal"
                              disabled={Boolean(legacyValues)}
                            />
                          </div>
                        </div>
                        {euroPricing.lastUpdatedOn ? (
                          <p className="text-xs text-muted-foreground">
                            Rate date: {euroPricing.lastUpdatedOn}
                          </p>
                        ) : null}
                        <div className="space-y-2">
                          {euroPricing.sections.map((section) => {
                            return (
                              <div
                                key={section.id}
                                className={cn(
                                  "grid gap-2",
                                  section.isMisc
                                    ? "md:grid-cols-[1.4fr_1fr_auto]"
                                    : "md:grid-cols-[1.4fr_1fr]"
                                )}
                              >
                                {section.isMisc ? (
                                  <Input
                                    className={inputSmClassName}
                                    value={section.label}
                                    onChange={(event) =>
                                      handleProductChange(index, {
                                        euroPricing: {
                                          ...euroPricing,
                                          sections: euroPricing.sections.map((entry) =>
                                            entry.id === section.id
                                              ? { ...entry, label: event.target.value }
                                              : entry
                                          ),
                                        },
                                        euroPricingEnabled: true,
                                      })
                                    }
                                    placeholder="Misc"
                                    disabled={Boolean(legacyValues)}
                                  />
                                ) : (
                                  <div className="flex items-center rounded-md border border-border/60 bg-muted/30 px-3 text-sm text-foreground">
                                    {section.label}
                                  </div>
                                )}
                                <MoneyInput
                                  className={inputSmClassName}
                                  value={section.amount}
                                  onValueChange={(nextValue) =>
                                    handleProductChange(index, {
                                      euroPricing: {
                                        ...euroPricing,
                                        sections: euroPricing.sections.map((entry) =>
                                          entry.id === section.id
                                            ? { ...entry, amount: nextValue }
                                            : entry
                                        ),
                                      },
                                      euroPricingEnabled: true,
                                    })
                                  }
                                  currency="EUR"
                                  placeholder="0"
                                  disabled={Boolean(legacyValues)}
                                />
                                {section.isMisc ? (
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() =>
                                      handleProductChange(index, {
                                        euroPricing: {
                                          ...euroPricing,
                                          sections: euroPricing.sections.filter(
                                            (entry) => entry.id !== section.id
                                          ),
                                        },
                                        euroPricingEnabled: true,
                                      })
                                    }
                                    disabled={Boolean(legacyValues)}
                                    aria-label="Remove misc field"
                                  >
                                    <X className="h-4 w-4" />
                                  </Button>
                                ) : null}
                              </div>
                            );
                          })}
                        </div>
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              handleProductChange(index, {
                                euroPricing: {
                                  ...euroPricing,
                                  sections: [
                                    ...euroPricing.sections,
                                    {
                                      id: createId("euro-misc"),
                                      label: "Misc",
                                      amount: "",
                                      isMisc: true,
                                    },
                                  ],
                                },
                                euroPricingEnabled: true,
                              })
                            }
                            disabled={Boolean(legacyValues)}
                          >
                            <Plus className="h-4 w-4" />
                            Add misc field
                          </Button>
                          <div className="text-xs text-muted-foreground">
                            EUR subtotal: {formatCurrency(euroTotals.eurSubtotal, "EUR")} | USD subtotal:{" "}
                            {formatCurrency(euroTotals.usdSubtotal, "USD")}
                          </div>
                        </div>
                      </div>
                    ) : null}

                    <div className="mt-3 space-y-3 rounded-lg border border-border/60 bg-background/80 p-3">
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Features
                        </p>
                        <p className="text-xs text-muted-foreground">
                          Ordered to match your product details list.
                        </p>
                      </div>

                      <div className="grid gap-3 md:grid-cols-2">
                        {visibleFeatureFields.map((field) => {
                          const options =
                            field.key === "interior_frame_color" &&
                            !allowsSplitFinish
                              ? getFrameColorOptionsForProduct(item)
                              : getFeatureOptionsForProduct(item, field.category);
                          const value = item[field.key];
                          const isDisabled = Boolean(legacyValues);
                          return (
                            <div key={`${item.id}-${field.key}`} className="space-y-1">
                              <label className="text-xs text-muted-foreground">
                                {field.label}
                              </label>
                              <Select
                                value={value || "__none__"}
                                onValueChange={(nextValue) =>
                                  handleProductChange(index, {
                                    [field.key]:
                                      nextValue === "__none__" ? "" : nextValue,
                                  } as Partial<ProductItem>)
                                }
                                disabled={isDisabled}
                              >
                                <SelectTrigger className={inputSmClassName}>
                                  <SelectValue
                                    placeholder={
                                      options.length
                                        ? `Select ${field.label.toLowerCase()}`
                                        : "No options configured"
                                    }
                                  />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">
                                    Select {field.label.toLowerCase()}
                                  </SelectItem>
                                  {options.map((option) => (
                                    <SelectItem key={option.id} value={option.label}>
                                      {option.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          );
                        })}
                      </div>

                      <div className="grid gap-3 md:grid-cols-3">
                        <label className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-xs text-foreground">
                          <Checkbox
                            checked={item.split_finish}
                            onCheckedChange={(checked) =>
                              handleProductChange(index, {
                                split_finish:
                                  allowsSplitFinish && checked === true,
                              })
                            }
                            disabled={
                              Boolean(legacyValues) || !allowsSplitFinish
                            }
                          />
                          <span>Split finish</span>
                        </label>
                        <label className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-xs text-foreground">
                          <Checkbox
                            checked={item.stainless_operating_hardware}
                            onCheckedChange={(checked) =>
                              handleProductChange(index, {
                                stainless_operating_hardware: checked === true,
                              })
                            }
                            disabled={Boolean(legacyValues)}
                          />
                          <span>Stainless steel operating hardware</span>
                        </label>
                        <label className="flex items-center gap-2 rounded-lg border border-border/60 bg-card/80 px-3 py-2 text-xs text-foreground">
                          <Checkbox
                            checked={item.has_screens}
                            onCheckedChange={(checked) =>
                              handleProductChange(index, {
                                has_screens: checked === true,
                              })
                            }
                            disabled={Boolean(legacyValues)}
                          />
                          <span>Screens</span>
                        </label>
                      </div>

                      {!allowsSplitFinish ? (
                        <p className="text-xs text-muted-foreground">
                          This vendor does not allow split finish. A single frame
                          color is used.
                        </p>
                      ) : null}

                      <div className="rounded-lg border border-border/60 bg-card/70 px-3 py-2">
                        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                          Features list (ordered)
                        </p>
                        <ul className="mt-2 space-y-1 text-sm text-foreground">
                          {featureListLines.map((line) => (
                            <li key={`${item.id}-${line}`}>• {line}</li>
                          ))}
                        </ul>
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
                        ...createDefaultProductItem(createId("product")),
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
                moneyCurrency="USD"
                moneySuffix="/ft"
              />
              <RateField
                label="Waterproofing $/ft"
                value={draft.calculator.waterproofing_rate}
                onChange={(value) =>
                  handleCalculatorChange("waterproofing_rate", value)
                }
                disabled={Boolean(legacyValues)}
                moneyCurrency="USD"
                moneySuffix="/ft"
              />
              <RateField
                label="Override bucking cost"
                value={draft.calculator.override_bucking_cost}
                onChange={(value) =>
                  handleCalculatorChange("override_bucking_cost", value)
                }
                placeholder="Optional"
                disabled={Boolean(legacyValues)}
                moneyCurrency="USD"
              />
              <RateField
                label="Override waterproof cost"
                value={draft.calculator.override_waterproofing_cost}
                onChange={(value) =>
                  handleCalculatorChange("override_waterproofing_cost", value)
                }
                placeholder="Optional"
                disabled={Boolean(legacyValues)}
                moneyCurrency="USD"
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
                moneyCurrency="USD"
              />
              <RateField
                label="Override total install"
                value={draft.calculator.override_install_total}
                onChange={(value) =>
                  handleCalculatorChange("override_install_total", value)
                }
                placeholder="Optional"
                disabled={Boolean(legacyValues)}
                moneyCurrency="USD"
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
                Ready to generate. Your totals and schedule are ready to sync to PandaDoc.
              </div>
            </div>
          </section>
        ) : null}

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
  moneyCurrency,
  moneySuffix,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  moneyCurrency?: "USD" | "EUR";
  moneySuffix?: string;
}) {
  return (
    <div className="space-y-2">
      <label className="text-xs font-medium uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </label>
      {moneyCurrency ? (
        <MoneyInput
          className={inputClassName}
          value={value}
          onValueChange={onChange}
          currency={moneyCurrency}
          placeholder={placeholder}
          disabled={disabled}
          suffix={moneySuffix}
        />
      ) : (
        <Input
          className={inputClassName}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          inputMode="decimal"
          placeholder={placeholder}
          disabled={disabled}
        />
      )}
    </div>
  );
}

function formatCurrency(value: number, currency: "USD" | "EUR" = "USD") {
  if (!Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function MoneyInput({
  className,
  value,
  onValueChange,
  currency,
  placeholder,
  disabled,
  suffix,
}: {
  className?: string;
  value: string;
  onValueChange: (value: string) => void;
  currency: "USD" | "EUR";
  placeholder?: string;
  disabled?: boolean;
  suffix?: string;
}) {
  const symbol = currency === "EUR" ? "€" : "$";
  const normalizedValue = parseMoneyToModel(value);
  const displayValue = formatMoneyForInput(normalizedValue, currency);
  const suffixDisplay = suffix ? ` ${suffix}` : "";
  return (
    <div className="relative">
      <Input
        className={cn(className, suffix && "pr-14")}
        value={displayValue}
        onChange={(event) => onValueChange(parseMoneyToModel(event.target.value))}
        inputMode="decimal"
        placeholder={placeholder ? `${symbol}${placeholder}` : `${symbol}0`}
        disabled={disabled}
      />
      {suffix ? (
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-muted-foreground">
          {suffixDisplay}
        </span>
      ) : null}
    </div>
  );
}

function parseMoneyToModel(value: string) {
  let result = "";
  let hasDot = false;

  for (const char of String(value ?? "")) {
    if (char === "-" && !result.length) {
      result += char;
      continue;
    }
    if (char === "." && !hasDot) {
      result += char;
      hasDot = true;
      continue;
    }
    if (char >= "0" && char <= "9") {
      result += char;
    }
  }

  return result;
}

function formatMoneyForInput(value: string, currency: "USD" | "EUR") {
  if (!value) return "";
  const symbol = currency === "EUR" ? "€" : "$";
  const isNegative = value.startsWith("-");
  const unsigned = isNegative ? value.slice(1) : value;
  if (!unsigned || unsigned === ".") {
    return `${isNegative ? "-" : ""}${symbol}${unsigned ? "0." : ""}`;
  }

  const [intRaw, decimalRaw] = unsigned.split(".");
  const intDigits = intRaw.replace(/\D/g, "");
  const intValue = intDigits ? Number(intDigits) : 0;
  const intFormatted = Number.isFinite(intValue)
    ? intValue.toLocaleString("en-US")
    : "0";

  return `${isNegative ? "-" : ""}${symbol}${intFormatted}${
    decimalRaw !== undefined ? `.${decimalRaw}` : ""
  }`;
}
