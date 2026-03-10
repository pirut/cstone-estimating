"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import estimateFields from "@/config/estimate-fields.json";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
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
  hasOverrideInput,
  isChangeOrderProjectType,
  createDefaultProductItem,
  createDefaultEuroPricing,
  computeEstimate,
  createId,
  DEFAULT_DRAFT,
  EURO_DEFAULT_FLUFF,
  normalizeUnitTypeCostOverrides,
  roundUp,
  resolveProductBasePrice,
  toNumber,
  type BuckingLineItem,
  type ChangeOrderDraft,
  type EuroPricing,
  type EuroPricingSectionLine,
  type EstimateDraft,
  type MarginThresholds,
  type PanelType,
  type ProductItem,
} from "@/lib/estimate-calculator";
import {
  EMPTY_PRODUCT_FEATURE_SELECTION,
  PRODUCT_FEATURE_SELECT_FIELDS,
  type ProductFeatureCategory,
  type ProductFeatureOption,
  type ProductFeatureSelection,
} from "@/lib/product-features";
import { cn } from "@/lib/utils";
import { db, id } from "@/lib/convex";
import {
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  Loader2,
  LockKeyhole,
  Plus,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  FeatureOptionCombobox,
  formatCurrency,
  formatPercentForInput,
  formatMargin,
  MoneyInput,
  parsePercentToDecimalString,
  PercentInput,
  RateField,
  SectionHeader,
} from "@/components/estimate-builder-card.helpers";

const EMPTY_VALUES: Record<string, string | number> = {};
const inputClassName = inputVariants({ uiSize: "default" });
const inputSmClassName = inputVariants({ uiSize: "sm" });
const MIN_ADDRESS_LOOKUP_CHARS = 3;

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
  catalogTeamId?: string | null;
  projectTypeOptions?: string[];
  marginThresholds?: Partial<MarginThresholds> | null;
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

type EstimateInfoField = {
  key: string;
  label: string;
  type?: string;
  placeholder?: string;
  options?: unknown[];
};

type EstimateInfoGroup = {
  title?: string;
  label?: string;
  fields: EstimateInfoField[];
};

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

function ensureSingleProductLine(products: ProductItem[]): ProductItem[] {
  if (!Array.isArray(products) || products.length === 0) {
    return [createDefaultProductItem()];
  }
  return [products[0]];
}

function normalizeLoadedChangeOrder(
  source: unknown,
  fallback: ChangeOrderDraft,
  products: ProductItem[],
  totals: Record<string, unknown> | null
): ChangeOrderDraft {
  const input =
    source && typeof source === "object" && !Array.isArray(source)
      ? (source as Partial<ChangeOrderDraft>)
      : null;
  const firstProduct = products[0];
  const rawLaborTotal = totals?.installation_price;
  const inferredLaborTotal =
    typeof rawLaborTotal === "string" || typeof rawLaborTotal === "number"
      ? toNumber(rawLaborTotal)
      : 0;

  return {
    vendorId: String(input?.vendorId ?? firstProduct?.vendorId ?? fallback.vendorId),
    vendorName: String(input?.vendorName ?? firstProduct?.name ?? fallback.vendorName),
    vendorCost: String(input?.vendorCost ?? firstProduct?.price ?? fallback.vendorCost),
    vendorMarkup: String(
      input?.vendorMarkup ??
        firstProduct?.markup ??
        fallback.vendorMarkup
    ),
    laborCost: String(
      input?.laborCost ??
        (inferredLaborTotal > 0 ? inferredLaborTotal.toFixed(2) : fallback.laborCost)
    ),
    laborMarkup: String(input?.laborMarkup ?? fallback.laborMarkup),
  };
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
  catalogTeamId,
  projectTypeOptions,
  marginThresholds,
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
  const [sessionFeatureOptions, setSessionFeatureOptions] = useState<
    ProductFeatureOption[]
  >([]);
  const [sectionOpenOverrides, setSectionOpenOverrides] = useState<
    Record<string, boolean>
  >({});
  const [editingSections, setEditingSections] = useState<Set<string>>(new Set());
  const [expandedProductDetails, setExpandedProductDetails] = useState<Set<string>>(
    new Set()
  );
  const [isPanelSummaryOpen, setIsPanelSummaryOpen] = useState(false);
  const addressLookupRequestRef = useRef(0);
  const normalizedPreparedByName = preparedByName?.trim() ?? "";

  const groupList = useMemo<EstimateInfoGroup[]>(
    () =>
      Array.isArray((estimateFields as { groups?: unknown }).groups)
        ? ((estimateFields as { groups: EstimateInfoGroup[] }).groups ?? [])
        : [],
    []
  );

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
    const combined = [...(productFeatureOptions ?? []), ...sessionFeatureOptions];
    const seen = new Set<string>();
    return combined
      .map((option, index) => {
        const category = option.category;
        if (!category) return null;
        const label = String(option.label ?? "").trim();
        if (!label) return null;
        const vendorKey =
          typeof option.vendorId === "string" && option.vendorId.trim()
            ? option.vendorId.trim()
            : "";
        const dedupeKey = `${category}::${vendorKey}::${label.toLowerCase()}`;
        if (seen.has(dedupeKey)) return null;
        seen.add(dedupeKey);
        return {
          id: option.id ?? `${category}-${index}`,
          category,
          label,
          vendorId: vendorKey,
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
  }, [productFeatureOptions, sessionFeatureOptions]);

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
    if (!normalized.some((option) => option.toLowerCase() === "change order")) {
      normalized.push("Change Order");
    }
    return normalized;
  }, [projectTypeOptions]);

  const computed = useMemo(
    () => computeEstimate(draft, panelTypeOptions, marginThresholds ?? null),
    [draft, marginThresholds, panelTypeOptions]
  );
  const isChangeOrderMode = isChangeOrderProjectType(draft.info.project_type);
  const projectNameValue = String(draft.info.project_name ?? "").trim();
  const changeOrderVendorTotal = roundUp(
    toNumber(draft.changeOrder.vendorCost) *
      (1 + toNumber(draft.changeOrder.vendorMarkup))
  );
  const changeOrderLaborTotal = roundUp(
    toNumber(draft.changeOrder.laborCost) *
      (1 + toNumber(draft.changeOrder.laborMarkup))
  );
  const defaultBuckingVendorId = useMemo(() => {
    for (const item of draft.products) {
      const productVendorId = String(item.vendorId ?? "").trim();
      if (
        productVendorId &&
        vendorOptions.some((vendor) => vendor.id === productVendorId)
      ) {
        return productVendorId;
      }
      const matchedByName = vendorOptions.find(
        (vendor) => vendor.name === item.name
      );
      if (matchedByName?.id) {
        return matchedByName.id;
      }
    }
    return vendorOptions[0]?.id ?? "";
  }, [draft.products, vendorOptions]);

  useEffect(() => {
    if (legacyValues) {
      onValuesChange(legacyValues);
      onEstimatePayloadChange?.({ values: legacyValues });
      return;
    }

    onValuesChange(computed.pdfValues);
    onEstimatePayloadChange?.({
      version: 2,
      mode: isChangeOrderMode ? "change_order" : "standard",
      name: name.trim(),
      values: computed.pdfValues,
      info: draft.info,
      products: draft.products,
      bucking: draft.bucking,
      calculator: draft.calculator,
      changeOrder: draft.changeOrder,
      totals: computed.totals,
      schedule: computed.schedule,
      breakdown: computed.breakdown,
      marginThresholds: computed.marginThresholds,
      margins: computed.margins,
      marginChecks: computed.marginChecks,
    });
  }, [
    computed,
    draft,
    isChangeOrderMode,
    legacyValues,
    name,
    onEstimatePayloadChange,
    onValuesChange,
  ]);

  useEffect(() => {
    if (!loadPayload) return;

    if (loadPayload.values && !loadPayload.calculator) {
      setLegacyValues(loadPayload.values as Record<string, string | number>);
      setDraft(DEFAULT_DRAFT);
      setExchangeRateStatusByProduct({});
      return;
    }

    const loadedProducts = ensureSingleProductLine(
      Array.isArray(loadPayload.products) && loadPayload.products.length
        ? loadPayload.products.map((item, index) =>
            normalizeLoadedProduct(
              item as Partial<ProductItem>,
              createId(`product-${index + 1}`)
            )
          )
        : DEFAULT_DRAFT.products
    );
    const loadCalculator =
      loadPayload.calculator &&
      typeof loadPayload.calculator === "object" &&
      !Array.isArray(loadPayload.calculator)
        ? (loadPayload.calculator as Partial<EstimateDraft["calculator"]>)
        : null;
    const loadedTotals =
      loadPayload.totals && typeof loadPayload.totals === "object"
        ? (loadPayload.totals as Record<string, unknown>)
        : null;

    const nextDraft: EstimateDraft = {
      info: loadPayload.info ?? DEFAULT_DRAFT.info,
      products: loadedProducts,
      bucking:
        Array.isArray(loadPayload.bucking) && loadPayload.bucking.length
          ? loadPayload.bucking
          : DEFAULT_DRAFT.bucking,
      calculator: {
        ...DEFAULT_DRAFT.calculator,
        ...(loadCalculator ?? {}),
        unit_type_cost_overrides: normalizeUnitTypeCostOverrides(
          loadCalculator?.unit_type_cost_overrides
        ),
      },
      changeOrder: normalizeLoadedChangeOrder(
        loadPayload.changeOrder,
        DEFAULT_DRAFT.changeOrder,
        loadedProducts,
        loadedTotals
      ),
    };

    setLegacyValues(null);
    setDraft(nextDraft);
    setExchangeRateStatusByProduct({});
    setSectionOpenOverrides({});
    setEditingSections(new Set());

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
    setSessionFeatureOptions([]);
  }, [catalogTeamId]);

  useEffect(() => {
    if (legacyValues || !addressLookupOpen) {
      setAddressSuggestions([]);
      setIsAddressLookupLoading(false);
      setAddressLookupError(null);
      return;
    }

    if (projectNameValue.length < MIN_ADDRESS_LOOKUP_CHARS) {
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
    setDraft({
      ...next,
      products: ensureSingleProductLine(next.products),
    });
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
      setDraft((prev) => {
        const nextProducts = ensureSingleProductLine(
          prev.products.map((item) =>
            item.id === productId ? updater(item) : item
          )
        );
        return {
          ...prev,
          products: nextProducts,
        };
      });
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

  const createProductFeatureOption = useCallback(
    async (
      item: ProductItem,
      category: ProductFeatureCategory,
      rawLabel: string
    ): Promise<{ ok: boolean; value?: string; error?: string }> => {
      const label = rawLabel.trim().replace(/\s+/g, " ");
      if (!label) {
        return { ok: false, error: "Enter a value before adding." };
      }
      if (!catalogTeamId) {
        return {
          ok: false,
          error: "Pick a valid team before adding feature options.",
        };
      }

      const vendorId = resolveVendorForProduct(item)?.id ?? "";
      const sameScope = normalizedProductFeatureOptions.filter(
        (option) =>
          option.category === category && (option.vendorId ?? "") === vendorId
      );
      const existing = sameScope.find(
        (option) => option.label.toLowerCase() === label.toLowerCase()
      );
      if (existing) {
        return { ok: true, value: existing.label };
      }

      const nextSortOrder =
        sameScope.reduce(
          (max, option) =>
            Math.max(
              max,
              typeof option.sortOrder === "number" ? option.sortOrder : 0
            ),
          0
        ) + 1;
      const optionId = id();
      const now = Date.now();
      const tx = db.tx as any;

      try {
        await db.transact(
          tx.productFeatureOptions[optionId]
            .create({
              category,
              label,
              vendorId: vendorId || undefined,
              sortOrder: nextSortOrder,
              isActive: true,
              createdAt: now,
              updatedAt: now,
            })
            .link({ team: catalogTeamId })
        );
        setSessionFeatureOptions((prev) => [
          ...prev,
          {
            id: optionId,
            category,
            label,
            vendorId: vendorId || undefined,
            sortOrder: nextSortOrder,
            isActive: true,
          },
        ]);
        return { ok: true, value: label };
      } catch (error) {
        return {
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Unable to add feature option.",
        };
      }
    },
    [catalogTeamId, normalizedProductFeatureOptions, resolveVendorForProduct]
  );

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
    field: Exclude<keyof EstimateDraft["calculator"], "unit_type_cost_overrides">,
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

  const handleUnitTypeCostOverrideChange = (
    unitTypeId: string,
    value: string
  ) => {
    const nextOverrides = {
      ...draft.calculator.unit_type_cost_overrides,
    };
    const normalizedValue = value.trim();
    if (normalizedValue) {
      nextOverrides[unitTypeId] = value;
    } else {
      delete nextOverrides[unitTypeId];
    }
    handleDraftChange({
      ...draft,
      calculator: {
        ...draft.calculator,
        unit_type_cost_overrides: nextOverrides,
      },
    });
  };

  const handleChangeOrderChange = (
    field: keyof EstimateDraft["changeOrder"],
    value: string
  ) => {
    handleDraftChange({
      ...draft,
      changeOrder: {
        ...draft.changeOrder,
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
    setSectionOpenOverrides({});
    setEditingSections(new Set());

    onValuesChange(EMPTY_VALUES);
    onNameChange("");
    onSelectEstimate?.(null);
    onEstimatePayloadChange?.(null);
  };

  const projectStepReady = REQUIRED_INFO_FIELDS.every((field) =>
    String(draft.info[field] ?? "").trim()
  );
  const productStepReady = draft.products.some(
    (item) => item.name.trim() && resolveProductBasePrice(item) > 0
  );
  const changeOrderStepReady =
    Boolean(draft.changeOrder.vendorName.trim()) &&
    toNumber(draft.changeOrder.vendorCost) > 0 &&
    toNumber(draft.changeOrder.laborCost) > 0;
  const hasBuckingLineItems = draft.bucking.some(
    (item) => toNumber(item.qty) > 0 && toNumber(item.sqft) > 0
  );
  const hasBuckingOverrides =
    hasOverrideInput(draft.calculator.override_bucking_cost) &&
    hasOverrideInput(draft.calculator.override_waterproofing_cost);
  const hasInstallOverride = hasOverrideInput(
    draft.calculator.override_install_total
  );
  const buckingStepReady = hasBuckingLineItems || hasBuckingOverrides;
  const installInputsComplete =
    hasBuckingLineItems || hasBuckingOverrides || hasInstallOverride;
  const installStepReady = isChangeOrderMode
    ? computed.totals.total_contract_price > 0
    : computed.totals.total_contract_price > 0 && installInputsComplete;
  const projectStepComplete =
    projectStepReady && !editingSections.has("project");
  const productStepComplete =
    productStepReady && !editingSections.has("product");
  const changeOrderStepComplete =
    changeOrderStepReady && !editingSections.has("changeOrder");
  const buckingStepComplete =
    buckingStepReady && !editingSections.has("bucking");
  const installStepComplete =
    installStepReady && !editingSections.has("install");
  const hasMarginRisk =
    !computed.marginChecks.product_margin_ok ||
    !computed.marginChecks.install_margin_ok ||
    !computed.marginChecks.project_margin_ok;

  const stepProgress = isChangeOrderMode
    ? ([
        {
          id: "project",
          label: "Project Details",
          done: projectStepComplete,
          locked: false,
        },
        {
          id: "change-order",
          label: "Change Order Pricing",
          done: changeOrderStepComplete,
          locked: !projectStepReady,
        },
        {
          id: "review",
          label: "Review Totals",
          done: installStepComplete,
          locked: !projectStepReady || !changeOrderStepReady,
        },
      ] as const)
    : ([
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
          locked: !projectStepReady,
        },
        {
          id: "bucking",
          label: "Bucking & Waterproof",
          done: buckingStepComplete,
          locked: !projectStepReady || !productStepReady,
        },
        {
          id: "install",
          label: "Install Calculator",
          done: installStepComplete,
          locked: !projectStepReady || !productStepReady || !buckingStepReady,
        },
        {
          id: "review",
          label: "Review Totals",
          done: installStepComplete,
          locked: !projectStepReady || !productStepReady || !buckingStepReady,
        },
      ] as const);

  const completedCount = stepProgress.filter((step) => step.done).length;
  const completionPercent = Math.round((completedCount / stepProgress.length) * 100);

  const showProducts = projectStepReady && !isChangeOrderMode;
  const showChangeOrder = projectStepReady && isChangeOrderMode;
  const showBucking = showProducts && productStepReady;
  const showInstall = showBucking && buckingStepReady;
  const showReview =
    (isChangeOrderMode && showChangeOrder && changeOrderStepReady) ||
    (!isChangeOrderMode && showInstall);

  const getDefaultSectionOpen = useCallback(
    (sectionId: string, isDone: boolean) => {
      if (!isDone) return true;
      const sectionOrder = ["project", "changeOrder", "product", "bucking", "install", "review"];
      const sectionVisible: Record<string, boolean> = {
        project: true,
        changeOrder: showChangeOrder,
        product: showProducts,
        bucking: showBucking,
        install: showInstall,
        review: showReview,
      };
      const sectionDone: Record<string, boolean> = {
        project: projectStepComplete,
        changeOrder: changeOrderStepComplete,
        product: productStepComplete,
        bucking: buckingStepComplete,
        install: installStepComplete,
        review: installStepComplete,
      };
      const currentIdx = sectionOrder.indexOf(sectionId);
      const hasLaterActiveSection = sectionOrder.some(
        (id, idx) => idx > currentIdx && sectionVisible[id] && !sectionDone[id]
      );
      return !hasLaterActiveSection;
    },
    [
      showChangeOrder,
      showProducts,
      showBucking,
      showInstall,
      showReview,
      projectStepComplete,
      changeOrderStepComplete,
      productStepComplete,
      buckingStepComplete,
      installStepComplete,
    ]
  );

  const toggleSection = useCallback(
    (sectionId: string, isDone: boolean) => {
      setSectionOpenOverrides((prev) => {
        const currentOpen =
          typeof prev[sectionId] === "boolean"
            ? prev[sectionId]
            : getDefaultSectionOpen(sectionId, isDone);
        return {
          ...prev,
          [sectionId]: !currentOpen,
        };
      });
    },
    [getDefaultSectionOpen]
  );

  const isSectionOpen = useCallback(
    (sectionId: string, isDone: boolean) => {
      if (typeof sectionOpenOverrides[sectionId] === "boolean") {
        return sectionOpenOverrides[sectionId];
      }
      return getDefaultSectionOpen(sectionId, isDone);
    },
    [
      getDefaultSectionOpen,
      sectionOpenOverrides,
    ]
  );

  const handleSectionFocus = useCallback((sectionId: string) => {
    setEditingSections((prev) => {
      if (prev.has(sectionId)) return prev;
      const next = new Set(prev);
      next.add(sectionId);
      return next;
    });
  }, []);

  const handleSectionBlur = useCallback(
    (sectionId: string, currentTarget: HTMLDivElement, nextTarget: EventTarget | null) => {
      if (nextTarget instanceof Node && currentTarget.contains(nextTarget)) {
        return;
      }
      setEditingSections((prev) => {
        if (!prev.has(sectionId)) return prev;
        const next = new Set(prev);
        next.delete(sectionId);
        return next;
      });
    },
    []
  );

  return (
    <Card className="relative overflow-hidden shadow-elevated hover:shadow-elevated-lg">
      <CardHeader className="space-y-4 pb-4">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-serif font-light tracking-tight">Estimate Builder</CardTitle>
          <span className="text-lg font-serif font-light text-accent tabular-nums">{completionPercent}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-gradient-to-r from-accent/80 to-accent transition-all duration-500 ease-out"
            style={{ width: `${completionPercent}%` }}
          />
        </div>
        <div className="flex flex-wrap gap-x-1 gap-y-1">
          {stepProgress.map((step) => {
            const sectionMap: Record<string, string> = {
              project: "project",
              changeOrder: "changeOrder",
              product: "product",
              bucking: "bucking",
              install: "install",
              review: "review",
            };
            const sectionId = sectionMap[step.id];
            const canClick = !step.locked && sectionId;
            return (
              <button
                key={step.id}
                type="button"
                disabled={!canClick}
                className={cn(
                  "flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs transition-all duration-150",
                  step.done && "text-foreground bg-accent/5 hover:bg-accent/10",
                  !step.done && !step.locked && "text-muted-foreground hover:bg-muted/60",
                  step.locked && "text-muted-foreground/40 cursor-default"
                )}
                onClick={() => {
                  if (!canClick) return;
                  const allSections = [
                    "project",
                    "changeOrder",
                    "product",
                    "bucking",
                    "install",
                    "review",
                  ];
                  setSectionOpenOverrides(
                    Object.fromEntries(
                      allSections.map((id) => [id, id === sectionId])
                    )
                  );
                }}
              >
                {step.done ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-accent" />
                ) : step.locked ? (
                  <LockKeyhole className="h-3.5 w-3.5" />
                ) : (
                  <CircleDashed className="h-3.5 w-3.5" />
                )}
                <span>{step.label}</span>
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="relative space-y-8">
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

        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <Input
              className={cn(inputClassName, "flex-1 text-base font-medium")}
              value={name}
              onChange={(event) => {
                onNameChange(event.target.value);
                onActivate?.();
              }}
              placeholder="Estimate name..."
            />
            <Button variant="ghost" size="sm" className="text-xs text-muted-foreground shrink-0" onClick={handleClear}>
              Clear
            </Button>
          </div>
          {selectedEstimate ? (
            <p className="text-xs text-muted-foreground">
              Loaded from: <span className="text-foreground">{selectedEstimate.name}</span>
            </p>
          ) : null}
        </section>

        <Separator />

        <section className="space-y-4">
          <SectionHeader
            title="Project Details"
            done={projectStepComplete}
            isOpen={isSectionOpen("project", projectStepComplete)}
            onToggle={() => toggleSection("project", projectStepComplete)}
            summary={projectStepComplete ? `${draft.info.prepared_for || ""}${draft.info.project_name ? ` — ${draft.info.project_name}` : ""}` : undefined}
          />
          {isSectionOpen("project", projectStepComplete) ? (
          <div
            className="grid gap-x-4 gap-y-3 md:grid-cols-2"
            onFocusCapture={() => handleSectionFocus("project")}
            onBlurCapture={(event) =>
              handleSectionBlur("project", event.currentTarget, event.relatedTarget)
            }
          >
            {groupList.flatMap((group) =>
              group.fields.map((field) => {
                const fieldValue =
                  draft.info[field.key as keyof EstimateDraft["info"]] ?? "";
                const isDate = field.type === "date";
                const selectOptionsFromField = Array.isArray(field.options)
                  ? field.options
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
                  <div key={field.key} className="space-y-1.5">
                    <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <span>{field.label}</span>
                      {isRequired ? (
                        <span className="text-accent">*</span>
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
                              <div className="max-h-48 overflow-auto rounded-lg border border-border bg-card">
                                {addressSuggestions.map((suggestion) => (
                                  <button
                                    key={suggestion.id}
                                    type="button"
                                    className="block w-full border-b border-border px-3 py-2 text-left last:border-b-0 hover:bg-muted/40"
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
                            projectNameValue.length >= MIN_ADDRESS_LOOKUP_CHARS &&
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
          ) : null}
        </section>

        {showChangeOrder ? (
          <>
          <Separator />

          <section className="space-y-4">
            <SectionHeader
              title="Change Order Pricing"
              done={changeOrderStepComplete}
              isOpen={isSectionOpen("changeOrder", changeOrderStepComplete)}
              onToggle={() => toggleSection("changeOrder", changeOrderStepComplete)}
              summary={changeOrderStepComplete ? formatCurrency(computed.totals.total_contract_price) : undefined}
            />
            {isSectionOpen("changeOrder", changeOrderStepComplete) ? (
            <div
              className="space-y-4"
              onFocusCapture={() => handleSectionFocus("changeOrder")}
              onBlurCapture={(event) =>
                handleSectionBlur("changeOrder", event.currentTarget, event.relatedTarget)
              }
            >
            {!vendorOptions.length ? (
              <div className="text-xs text-muted-foreground">No active vendors.</div>
            ) : null}

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
              <div className="space-y-1">
                <label className="text-xs text-muted-foreground">Vendor</label>
                <Select
                  value={draft.changeOrder.vendorId || "__none__"}
                  onValueChange={(value) => {
                    const vendor =
                      value === "__none__"
                        ? null
                        : vendorOptions.find((entry) => entry.id === value) ?? null;
                    handleDraftChange({
                      ...draft,
                      changeOrder: {
                        ...draft.changeOrder,
                        vendorId: vendor?.id ?? "",
                        vendorName: vendor?.name ?? "",
                      },
                    });
                  }}
                  disabled={Boolean(legacyValues) || !vendorOptions.length}
                >
                  <SelectTrigger className={inputClassName}>
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
              <RateField
                label="Vendor cost"
                value={draft.changeOrder.vendorCost}
                onChange={(value) => handleChangeOrderChange("vendorCost", value)}
                disabled={Boolean(legacyValues)}
                moneyCurrency="USD"
                placeholder="0"
              />
              <RateField
                label="Vendor markup"
                value={draft.changeOrder.vendorMarkup}
                onChange={(value) => handleChangeOrderChange("vendorMarkup", value)}
                disabled={Boolean(legacyValues)}
                percent
              />
              <RateField
                label="Labor cost"
                value={draft.changeOrder.laborCost}
                onChange={(value) => handleChangeOrderChange("laborCost", value)}
                disabled={Boolean(legacyValues)}
                moneyCurrency="USD"
                placeholder="0"
              />
              <RateField
                label="Labor markup"
                value={draft.changeOrder.laborMarkup}
                onChange={(value) => handleChangeOrderChange("laborMarkup", value)}
                disabled={Boolean(legacyValues)}
                percent
              />
            </div>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-lg bg-muted/40 px-4 py-3">
              <div>
                <p className="text-xs text-muted-foreground">Vendor Total</p>
                <p className="text-sm font-semibold text-foreground">{formatCurrency(changeOrderVendorTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Labor Total</p>
                <p className="text-sm font-semibold text-foreground">{formatCurrency(changeOrderLaborTotal)}</p>
              </div>
              <div className="ml-auto">
                <p className="text-xs text-muted-foreground">Change Order Total</p>
                <p className="text-base font-semibold text-accent">{formatCurrency(computed.totals.total_contract_price)}</p>
              </div>
            </div>
            </div>
            ) : null}

          </section>
          </>
        ) : null}

        {showProducts ? (
          <>
          <Separator />

          <section className="space-y-4">
            <SectionHeader
              title="Product Pricing"
              done={productStepComplete}
              isOpen={isSectionOpen("product", productStepComplete)}
              onToggle={() => toggleSection("product", productStepComplete)}
              summary={productStepComplete ? `${draft.products.length} product${draft.products.length !== 1 ? "s" : ""} — ${formatCurrency(computed.totals.product_price)}` : undefined}
            />
            {isSectionOpen("product", productStepComplete) ? (
            <div
              className="space-y-4"
              onFocusCapture={() => handleSectionFocus("product")}
              onBlurCapture={(event) =>
                handleSectionBlur("product", event.currentTarget, event.relatedTarget)
              }
            >
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">
                  Default product markup
                </label>
                <Input
                  className={inputClassName}
                  value={formatPercentForInput(draft.calculator.product_markup_default)}
                  onChange={(event) =>
                    handleCalculatorChange(
                      "product_markup_default",
                      parsePercentToDecimalString(event.target.value)
                    )
                  }
                  inputMode="decimal"
                  placeholder="50"
                  disabled={Boolean(legacyValues)}
                />
              </div>
            </div>
            {!vendorOptions.length ? (
              <div className="text-xs text-muted-foreground">No active vendors.</div>
            ) : null}

            <div className="space-y-3">
              {draft.products.map((item, index) => {
                const price = resolveProductBasePrice(item);
                const markup = item.markup.trim()
                  ? toNumber(item.markup)
                  : toNumber(draft.calculator.product_markup_default);
                const total = roundUp(price * (1 + markup));
                const markupAmount = total - price;
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
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border/60 p-4"
                  >
                    <div className="grid gap-2 md:grid-cols-[1.8fr_0.8fr_0.8fr_auto]">
                      <div className="space-y-1">
                        <label className="text-[11px] text-muted-foreground">Vendor</label>
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
                        <label className="text-[11px] text-muted-foreground">
                          {usesEuroPricing ? "Price (auto)" : "Price"}
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
                        <label className="text-[11px] text-muted-foreground">Markup</label>
                        <PercentInput
                          className={inputSmClassName}
                          value={item.markup}
                          onValueChange={(nextMarkup) =>
                            handleProductChange(index, { markup: nextMarkup })
                          }
                          placeholder={formatPercentForInput(
                            draft.calculator.product_markup_default
                          )}
                          disabled={Boolean(legacyValues)}
                        />
                      </div>
                      <div className="flex items-end justify-end">
                        <div className="px-1 py-2 text-right">
                          <p className="text-sm font-semibold text-foreground tabular-nums">
                            {Number.isFinite(total) ? formatCurrency(total) : "-"}
                          </p>
                          <p className="text-xs text-muted-foreground tabular-nums">
                            {Number.isFinite(markupAmount)
                              ? `${formatCurrency(markupAmount)} (${formatMargin(markup)})`
                              : "-"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {usesEuroPricing ? (
                      <div className="mt-3 border-t border-border/40 pt-3">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <button
                            type="button"
                            className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground"
                            onClick={() => {
                              setExpandedProductDetails((prev) => {
                                const next = new Set(prev);
                                const key = `${item.id}-euro`;
                                if (next.has(key)) next.delete(key); else next.add(key);
                                return next;
                              });
                            }}
                          >
                            <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", !expandedProductDetails.has(`${item.id}-euro`) && "-rotate-90")} />
                            EUR Cost Calculator
                            {!expandedProductDetails.has(`${item.id}-euro`) && euroTotals.usdSubtotal > 0 ? (
                              <span className="text-foreground ml-1">{formatCurrency(euroTotals.usdSubtotal)}</span>
                            ) : null}
                          </button>
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
                        {expandedProductDetails.has(`${item.id}-euro`) ? (
                        <div className="mt-3 space-y-3">
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
                                  <div className="flex items-center px-1 text-sm text-muted-foreground">
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
                      </div>
                    ) : null}

                    <div className="mt-3 border-t border-border/40 pt-3 space-y-3">
                      <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
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
                              <label className="text-[11px] text-muted-foreground">
                                {field.label}
                              </label>
                              <FeatureOptionCombobox
                                className={inputSmClassName}
                                value={value}
                                options={options.map((option) => option.label)}
                                onSelect={(nextValue) =>
                                  handleProductChange(index, {
                                    [field.key]: nextValue,
                                  } as Partial<ProductItem>)
                                }
                                onCreate={async (nextLabel) => {
                                  return await createProductFeatureOption(
                                    item,
                                    field.category,
                                    nextLabel
                                  );
                                }}
                                placeholder={
                                  options.length
                                    ? field.label
                                    : `Type ${field.label.toLowerCase()}`
                                }
                                disabled={isDisabled}
                              />
                            </div>
                          );
                        })}
                      </div>
                      <div className="flex flex-wrap gap-x-5 gap-y-2">
                        <label className="flex items-center gap-2 text-xs text-foreground">
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
                          Split finish
                        </label>
                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <Checkbox
                            checked={item.stainless_operating_hardware}
                            onCheckedChange={(checked) =>
                              handleProductChange(index, {
                                stainless_operating_hardware: checked === true,
                              })
                            }
                            disabled={Boolean(legacyValues)}
                          />
                          SS hardware
                        </label>
                        <label className="flex items-center gap-2 text-xs text-foreground">
                          <Checkbox
                            checked={item.has_screens}
                            onCheckedChange={(checked) =>
                              handleProductChange(index, {
                                has_screens: checked === true,
                              })
                            }
                            disabled={Boolean(legacyValues)}
                          />
                          Screens
                        </label>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="flex justify-end">
              <div className="text-xs text-muted-foreground">
                Product subtotal: {formatCurrency(computed.totals.product_price)}
              </div>
            </div>
            </div>
            ) : null}

          </section>
          </>
        ) : null}

        {showBucking ? (
          <>
          <Separator />

          <section className="space-y-4">
            <SectionHeader
              title="Bucking & Waterproof"
              done={buckingStepComplete}
              isOpen={isSectionOpen("bucking", buckingStepComplete)}
              onToggle={() => toggleSection("bucking", buckingStepComplete)}
              summary={buckingStepComplete ? `${computed.breakdown.total_lineal_ft.toFixed(0)} lineal ft` : undefined}
            />
            {isSectionOpen("bucking", buckingStepComplete) ? (
            <div
              className="space-y-4"
              onFocusCapture={() => handleSectionFocus("bucking")}
              onBlurCapture={(event) =>
                handleSectionBlur("bucking", event.currentTarget, event.relatedTarget)
              }
            >
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
            <p className="text-[11px] text-muted-foreground">
              Tip: enter `+` or `-` to apply an adjustment from the calculated value.
            </p>

            <div className="space-y-3">
              {!panelTypeOptions.length ? (
                <div className="text-xs text-muted-foreground">No active unit types.</div>
              ) : null}
              {draft.bucking.map((item, index) => {
                const qty = toNumber(item.qty);
                const sqft = toNumber(item.sqft);
                const lineal = qty ? Math.abs(Math.sqrt((sqft / qty) / 6) * 11) * qty : 0;
                return (
                  <div
                    key={item.id}
                    className="rounded-lg border border-border/60 p-3 space-y-2"
                  >
                    <div className="flex items-start gap-2">
                      <div className="grid flex-1 gap-2 md:grid-cols-2">
                        <Select
                          value={
                            vendorOptions.some(
                              (vendor) => vendor.id === item.vendor_id
                            )
                              ? String(item.vendor_id)
                              : "__none__"
                          }
                          onValueChange={(value) =>
                            handleBuckingChange(index, {
                              vendor_id: value === "__none__" ? "" : value,
                            })
                          }
                          disabled={Boolean(legacyValues) || !vendorOptions.length}
                        >
                          <SelectTrigger className={inputSmClassName}>
                            <SelectValue placeholder="Vendor" />
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
                            <SelectValue placeholder="Unit type" />
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
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-muted-foreground"
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
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 md:grid-cols-5">
                      <div className="space-y-1">
                        <label className="text-[11px] text-muted-foreground">Qty</label>
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
                        <label className="text-[11px] text-muted-foreground">SqFt</label>
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
                        <label className="text-[11px] text-muted-foreground">Replacement</label>
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
                        <label className="text-[11px] text-muted-foreground">Clerestory</label>
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
                      <div className="flex items-end">
                        <p className="px-1 py-2 text-sm font-semibold text-foreground tabular-nums whitespace-nowrap">
                          {lineal ? `${lineal.toFixed(1)} ft` : "-"}
                        </p>
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
                        vendor_id: defaultBuckingVendorId,
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
            </div>
            ) : null}

          </section>
          </>
        ) : null}

        {showInstall ? (
          <>
          <Separator />

          <section className="space-y-4">
            <SectionHeader
              title="Install Calculator"
              done={installStepComplete}
              isOpen={isSectionOpen("install", installStepComplete)}
              onToggle={() => toggleSection("install", installStepComplete)}
              summary={installStepComplete ? formatCurrency(computed.breakdown.total_install_value) : undefined}
            />
            {isSectionOpen("install", installStepComplete) ? (
            <div
              className="space-y-4"
              onFocusCapture={() => handleSectionFocus("install")}
              onBlurCapture={(event) =>
                handleSectionBlur("install", event.currentTarget, event.relatedTarget)
              }
            >
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              <RateField
                label="Install markup"
                value={draft.calculator.install_markup}
                onChange={(value) => handleCalculatorChange("install_markup", value)}
                disabled={Boolean(legacyValues)}
                percent
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
                placeholder="Optional (+/-)"
                disabled={Boolean(legacyValues)}
                moneyCurrency="USD"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              Use `+` or `-` to adjust from the calculated install total.
            </p>

            <div>
              <button
                type="button"
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
                onClick={() => setIsPanelSummaryOpen((prev) => !prev)}
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition-transform duration-200", !isPanelSummaryOpen && "-rotate-90")} />
                Unit cost overrides
              </button>
              {isPanelSummaryOpen ? (
                <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                  {panelTypeOptions.map((panel) => {
                    const counts = computed.panelCounts[panel.id];
                    return (
                      <div
                        key={panel.id}
                        className="rounded-lg border border-border/60 px-3 py-2"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium text-foreground">{panel.label}</p>
                          <p className="text-[11px] text-muted-foreground tabular-nums">
                            {counts.total_qty} qty
                          </p>
                        </div>
                        <div className="mt-1.5">
                          <MoneyInput
                            className={inputSmClassName}
                            value={
                              draft.calculator.unit_type_cost_overrides[panel.id] ?? ""
                            }
                            onValueChange={(value) =>
                              handleUnitTypeCostOverrideChange(panel.id, value)
                            }
                            currency="USD"
                            placeholder={
                              Number.isFinite(panel.price) && panel.price > 0
                                ? `${panel.price.toFixed(2)} default`
                                : "Cost override"
                            }
                            disabled={Boolean(legacyValues)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>

            <div className="text-xs text-muted-foreground">
              Total installation value: {formatCurrency(computed.breakdown.total_install_value)}
            </div>
            </div>
            ) : null}
          </section>
          </>
        ) : null}

        {showReview ? (
          <>
          <Separator />

          <section className="space-y-4">
            <SectionHeader title="Pricing Breakdown" done={installStepComplete} />

            <div className="rounded-lg border border-border/60 overflow-hidden">
              <div className="grid grid-cols-4 gap-px bg-border/30 text-xs text-muted-foreground">
                <div className="bg-card px-3 py-2">Line Item</div>
                <div className="bg-card px-3 py-2 text-right">Cost</div>
                <div className="bg-card px-3 py-2 text-right">Markup</div>
                <div className="bg-card px-3 py-2 text-right">Price</div>
              </div>
              {[
                {
                  label: "Product",
                  cost: computed.breakdown.product_cost_base,
                  price: computed.totals.product_price,
                },
                {
                  label: "Bucking",
                  cost: computed.breakdown.bucking_cost_base,
                  price: computed.totals.bucking_price,
                },
                {
                  label: "Waterproofing",
                  cost: computed.breakdown.waterproofing_cost_base,
                  price: computed.totals.waterproofing_price,
                },
                {
                  label: "Installation",
                  cost: computed.breakdown.install_cost_base + computed.breakdown.covers_cost_base + computed.breakdown.punch_cost_base,
                  price: computed.totals.installation_price,
                },
              ].map((row) => {
                const markupAmount = row.price - row.cost;
                const markupPercent =
                  row.cost > 0 && Number.isFinite(markupAmount)
                    ? markupAmount / row.cost
                    : Number.NaN;

                return (
                  <div
                    key={row.label}
                    className="grid grid-cols-4 gap-px bg-border/30 text-sm"
                  >
                    <div className="bg-card px-3 py-2 text-muted-foreground">{row.label}</div>
                    <div className="bg-card px-3 py-2 text-right font-medium text-foreground">
                      {formatCurrency(row.cost)}
                    </div>
                    <div className="bg-card px-3 py-2 text-right font-medium text-foreground">
                      <div>{formatCurrency(markupAmount)}</div>
                      <div className="text-xs text-muted-foreground">
                        {Number.isFinite(markupPercent) ? formatMargin(markupPercent) : "-"}
                      </div>
                    </div>
                    <div className="bg-card px-3 py-2 text-right font-semibold text-foreground">
                      {formatCurrency(row.price)}
                    </div>
                  </div>
                );
              })}
              <div className="grid grid-cols-4 gap-px bg-border/30">
                <div className="bg-accent/10 px-3 py-2.5 text-sm font-semibold text-foreground">
                  Total Contract
                </div>
                <div className="bg-accent/10 px-3 py-2.5 text-right text-sm font-semibold text-foreground">
                  {formatCurrency(
                    computed.breakdown.product_cost_base +
                    computed.breakdown.bucking_cost_base +
                    computed.breakdown.waterproofing_cost_base +
                    computed.breakdown.install_cost_base +
                    computed.breakdown.covers_cost_base +
                    computed.breakdown.punch_cost_base
                  )}
                </div>
                <div className="bg-accent/10 px-3 py-2.5 text-right text-sm font-semibold text-foreground">
                  {(() => {
                    const totalCost =
                      computed.breakdown.product_cost_base +
                      computed.breakdown.bucking_cost_base +
                      computed.breakdown.waterproofing_cost_base +
                      computed.breakdown.install_cost_base +
                      computed.breakdown.covers_cost_base +
                      computed.breakdown.punch_cost_base;
                    const markupAmount =
                      computed.totals.total_contract_price - totalCost;
                    const markupPercent =
                      totalCost > 0 && Number.isFinite(markupAmount)
                        ? markupAmount / totalCost
                        : Number.NaN;

                    return (
                      <>
                        <div>{formatCurrency(markupAmount)}</div>
                        <div className="text-xs text-muted-foreground">
                          {Number.isFinite(markupPercent) ? formatMargin(markupPercent) : "-"}
                        </div>
                      </>
                    );
                  })()}
                </div>
                <div className="bg-accent/10 px-3 py-2.5 text-right text-base font-bold text-foreground">
                  {formatCurrency(computed.totals.total_contract_price)}
                </div>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground">Margin checks</p>
              <div className="grid gap-3 md:grid-cols-3">
                {[
                  ["Product", computed.margins.product_margin, computed.marginChecks.product_margin_ok, computed.marginThresholds.product_margin_min],
                  ["Install", computed.margins.install_margin, computed.marginChecks.install_margin_ok, computed.marginThresholds.install_margin_min],
                  ["Overall", computed.margins.project_margin, computed.marginChecks.project_margin_ok, computed.marginThresholds.project_margin_min],
                ].map(([label, value, ok, threshold]) => (
                  <div key={String(label)} className="flex items-center justify-between gap-2 rounded-lg bg-muted/40 px-3 py-2.5">
                    <div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className={cn("text-sm font-semibold tabular-nums", ok ? "text-accent" : "text-destructive")}>
                        {formatMargin(value as number)}
                      </p>
                    </div>
                    <div className="text-right">
                      <Badge variant={ok ? "accent" : "outline"} className="text-[10px]">
                        {ok ? "Pass" : "Review"}
                      </Badge>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        min {formatMargin(threshold as number)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {!isChangeOrderMode ? (
              <>
                <Separator />

                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground">Payment schedule</p>
                  <div className="grid gap-x-6 gap-y-1 md:grid-cols-2">
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
                        className="flex items-center justify-between py-1.5 border-b border-border/30 last:border-b-0"
                      >
                        <span className="text-sm text-muted-foreground">{label}</span>
                        <span className="text-sm font-medium text-foreground tabular-nums">
                          {formatCurrency(value as number)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </>
            ) : null}

            {hasMarginRisk ? (
              <div className="flex items-center gap-2.5 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3.5 text-sm font-medium text-foreground">
                <Sparkles className="h-4 w-4 text-destructive" />
                Margin review required.
              </div>
            ) : (
              <div className="flex items-center gap-2.5 rounded-lg border border-accent/20 bg-accent/5 px-4 py-3.5 text-sm font-medium text-foreground">
                <Sparkles className="h-4 w-4 text-accent" />
                Ready to generate.
              </div>
            )}
          </section>
          </>
        ) : null}

      </CardContent>
    </Card>
  );
}
