
import {
  EMPTY_PRODUCT_FEATURE_SELECTION,
  PRODUCT_FEATURE_SELECT_FIELDS,
  type ProductFeatureSelection,
} from "@/lib/product-features";

export type EstimateInfo = {
  prepared_for?: string;
  project_name?: string;
  project_type?: string;
  city_state_zip?: string;
  proposal_date?: string;
  plan_set_date?: string;
  prepared_by?: string;
};

export type EuroPricingSectionLine = {
  id: string;
  label: string;
  amount: string;
  isMisc?: boolean;
};

export type EuroPricing = {
  liveRate: string;
  fluff: string;
  appliedRate: string;
  sections: EuroPricingSectionLine[];
  lastUpdatedOn?: string;
};

export const EURO_DEFAULT_FLUFF = 0.07;
export const EURO_BASE_SECTION_LABELS = [
  "Frames",
  "Crating",
  "Freight",
  "Glass",
  "Glass Crating",
  "Stiffiners",
  "Standard Thresholds",
  "Nail Fin",
  "Factory Glazing",
  "Anchor Straps",
  "Temporary Handles",
  "Installation Assistance",
] as const;
export const EURO_DEFAULT_MISC_ROWS = 2;

function createDefaultEuroSectionLine(
  label: string,
  isMisc = false
): EuroPricingSectionLine {
  return {
    id: createId(isMisc ? "euro-misc" : "euro"),
    label,
    amount: "",
    isMisc,
  };
}

export function createDefaultEuroPricing(): EuroPricing {
  const liveRate = 1;
  const fluff = EURO_DEFAULT_FLUFF;
  return {
    liveRate: liveRate.toFixed(4),
    fluff: fluff.toFixed(2),
    appliedRate: (liveRate + fluff).toFixed(4),
    sections: [
      ...EURO_BASE_SECTION_LABELS.map((label) => createDefaultEuroSectionLine(label)),
      ...Array.from({ length: EURO_DEFAULT_MISC_ROWS }, () =>
        createDefaultEuroSectionLine("Misc", true)
      ),
    ],
  };
}

export type ProductItem = {
  id: string;
  vendorId: string;
  name: string;
  price: string;
  markup: string;
  split_finish: boolean;
  euroPricingEnabled: boolean;
  euroPricing?: EuroPricing;
} & ProductFeatureSelection;

export function createDefaultProductItem(id = "product-1"): ProductItem {
  return {
    id,
    vendorId: "",
    name: "",
    price: "",
    markup: "0.5",
    split_finish: false,
    euroPricingEnabled: false,
    euroPricing: undefined,
    ...EMPTY_PRODUCT_FEATURE_SELECTION,
  };
};

export type BuckingLineItem = {
  id: string;
  unit_type: string;
  vendor_id?: string;
  qty: string;
  sqft: string;
  replacement_qty: string;
  clerestory_qty: string;
};

export type InstallCalculator = {
  install_markup: string;
  product_markup_default: string;
  bucking_rate: string;
  waterproofing_rate: string;
  rentals: string;
  unit_type_cost_overrides: Record<string, string>;
  override_bucking_cost: string;
  override_waterproofing_cost: string;
  override_install_total: string;
};

export type ChangeOrderDraft = {
  vendorId: string;
  vendorName: string;
  vendorCost: string;
  vendorMarkup: string;
  laborCost: string;
  laborMarkup: string;
};

export type MarginThresholds = {
  product_margin_min: number;
  install_margin_min: number;
  project_margin_min: number;
};

export const DEFAULT_MARGIN_THRESHOLDS: MarginThresholds = {
  product_margin_min: 0,
  install_margin_min: 0,
  project_margin_min: 0,
};

export type EstimateDraft = {
  info: EstimateInfo;
  products: ProductItem[];
  bucking: BuckingLineItem[];
  calculator: InstallCalculator;
  changeOrder: ChangeOrderDraft;
};

export type PanelType = {
  id: string;
  label: string;
  price: number;
  vendorPrices?: Record<string, number>;
};

export type OverrideInputMode = "none" | "absolute" | "delta";

export type ParsedOverrideInput = {
  mode: OverrideInputMode;
  value: number;
  raw: string;
};

export const DEFAULT_DRAFT: EstimateDraft = {
  info: {},
  products: [createDefaultProductItem()],
  bucking: [
    {
      id: "bucking-1",
      unit_type: "",
      vendor_id: "",
      qty: "",
      sqft: "",
      replacement_qty: "",
      clerestory_qty: "",
    },
  ],
  calculator: {
    install_markup: "0.35",
    product_markup_default: "0.5",
    bucking_rate: "7.71",
    waterproofing_rate: "5.61",
    rentals: "",
    unit_type_cost_overrides: {},
    override_bucking_cost: "",
    override_waterproofing_cost: "",
    override_install_total: "",
  },
  changeOrder: {
    vendorId: "",
    vendorName: "",
    vendorCost: "",
    vendorMarkup: "0.5",
    laborCost: "",
    laborMarkup: "0.35",
  },
};

export type EstimateComputed = {
  totals: {
    product_price: number;
    bucking_price: number;
    waterproofing_price: number;
    installation_price: number;
    total_contract_price: number;
  };
  schedule: {
    material_draw_1: number;
    material_draw_2: number;
    material_draw_3: number;
    mobilization_deposit: number;
    installation_draw_1: number;
    installation_draw_2: number;
    final_payment: number;
  };
  breakdown: {
    total_lineal_ft: number;
    total_install_value: number;
    install_cost_base: number;
    covers_cost_base: number;
    punch_cost_base: number;
    bucking_cost_base: number;
    waterproofing_cost_base: number;
    rentals_markup: number;
  };
  margins: {
    product_margin: number;
    install_margin: number;
    project_margin: number;
  };
  marginThresholds: MarginThresholds;
  marginChecks: {
    product_margin_ok: boolean;
    install_margin_ok: boolean;
    project_margin_ok: boolean;
  };
  panelCounts: Record<
    string,
    { total_qty: number; clerestory_qty: number; replacement_qty: number }
  >;
  panelTotals: Record<string, number>;
  pdfValues: Record<string, number | string>;
};

export function computeEuroPricingTotals(
  pricing: EuroPricing | null | undefined
): {
  eurSubtotal: number;
  appliedRate: number;
  usdSubtotal: number;
} {
  const sections = Array.isArray(pricing?.sections) ? pricing.sections : [];
  const eurSubtotal = sum(sections.map((section) => toNumber(section.amount)));
  const appliedRate = toNumber(pricing?.appliedRate);
  const usdSubtotal = eurSubtotal * appliedRate;
  return {
    eurSubtotal,
    appliedRate,
    usdSubtotal,
  };
}

export function resolveProductBasePrice(item: ProductItem): number {
  if (item.euroPricingEnabled && item.euroPricing) {
    return computeEuroPricingTotals(item.euroPricing).usdSubtotal;
  }
  return toNumber(item.price);
}

export function computeEstimate(
  draft: EstimateDraft,
  panelTypes: PanelType[] = [],
  marginThresholdsInput: Partial<MarginThresholds> | null = null
): EstimateComputed {
  const marginThresholds = normalizeMarginThresholds(marginThresholdsInput);
  if (isChangeOrderProjectType(draft.info.project_type)) {
    return computeChangeOrderEstimate(draft, marginThresholds);
  }

  const resolvedPanelTypes = normalizePanelTypes(panelTypes, draft.bucking ?? []);
  const productMarkupDefault = toNumber(draft.calculator.product_markup_default);
  const installMarkup = toNumber(draft.calculator.install_markup);
  const buckingRate = toNumber(draft.calculator.bucking_rate);
  const waterproofRate = toNumber(draft.calculator.waterproofing_rate);
  const rentals = toNumber(draft.calculator.rentals);
  const unitTypeCostOverrides = normalizeUnitTypeCostOverrides(
    draft.calculator.unit_type_cost_overrides
  );

  const products = draft.products ?? [];
  const productLineItems = products.map((item) => {
    const price = resolveProductBasePrice(item);
    const markup = item.markup.trim() ? toNumber(item.markup) : productMarkupDefault;
    const total = roundUp(price * (1 + markup));
    return {
      basePrice: price,
      total,
    };
  });
  const productPrice = sum(productLineItems.map((item) => item.total));
  const productCostBase = sum(productLineItems.map((item) => item.basePrice));

  const linealTotals = (draft.bucking ?? []).map((item) => {
    const qty = toNumber(item.qty);
    const sqft = toNumber(item.sqft);
    if (!qty) return 0;
    const perUnit = Math.sqrt((sqft / qty) / 6) * 11;
    return Math.abs(perUnit) * qty;
  });
  const totalLinealFt = sum(linealTotals);

  const buckingCostBaseComputed = totalLinealFt * buckingRate;
  const waterproofingCostBaseComputed = totalLinealFt * waterproofRate;
  const buckingOverride = parseOverrideInput(draft.calculator.override_bucking_cost);
  const waterproofingOverride = parseOverrideInput(
    draft.calculator.override_waterproofing_cost
  );
  const buckingCostBase = applyOverrideValue(
    buckingCostBaseComputed,
    buckingOverride
  );
  const waterproofingCostBase = applyOverrideValue(
    waterproofingCostBaseComputed,
    waterproofingOverride
  );

  const panelCounts: EstimateComputed["panelCounts"] = {};
  const panelTotals: EstimateComputed["panelTotals"] = {};
  const panelTypeById = new Map(
    resolvedPanelTypes.map((panel) => [panel.id, panel] as const)
  );
  const defaultInstallVendorId = resolveDefaultInstallVendorId(products);
  resolvedPanelTypes.forEach((panel) => {
    panelCounts[panel.id] = {
      total_qty: 0,
      clerestory_qty: 0,
      replacement_qty: 0,
    };
    panelTotals[panel.id] = 0;
  });

  for (const item of draft.bucking ?? []) {
    const type = item.unit_type;
    const counts = panelCounts[type];
    if (!counts) continue;
    const qty = toNumber(item.qty);
    const clerestoryQty = toNumber(item.clerestory_qty);
    const replacementQty = toNumber(item.replacement_qty);

    counts.total_qty += qty;
    counts.clerestory_qty += clerestoryQty;
    counts.replacement_qty += replacementQty;

    const hasExplicitVendor =
      item.vendor_id !== undefined && item.vendor_id !== null;
    const effectiveVendorId = hasExplicitVendor
      ? String(item.vendor_id).trim()
      : defaultInstallVendorId;
    const panelPrice = resolvePanelPrice(
      panelTypeById.get(type),
      effectiveVendorId
    );
    const unitTypeOverridePrice = resolveUnitTypeOverridePrice(
      unitTypeCostOverrides,
      type
    );
    const effectivePanelPrice =
      unitTypeOverridePrice === null ? panelPrice : unitTypeOverridePrice;
    panelTotals[type] +=
      effectivePanelPrice * qty +
      effectivePanelPrice * clerestoryQty * 0.5 +
      effectivePanelPrice * replacementQty;
  }

  const panelInstallValue = sum(Object.values(panelTotals));
  const installOverride = parseOverrideInput(draft.calculator.override_install_total);
  const totalInstallValue = applyOverrideValue(panelInstallValue, installOverride);
  const installCostBase = roundUp(totalInstallValue * 0.7);
  const coversCostBase = roundUp(totalInstallValue * 0.2);
  const punchCostBase = roundUp(totalInstallValue * 0.1);

  const buckingPrice = roundUp(buckingCostBase * (1 + installMarkup));
  const waterproofingPrice = roundUp(waterproofingCostBase * (1 + installMarkup));
  const rentalsMarkup = rentals * (1 + installMarkup);
  const installPrice = roundUp(installCostBase * (1 + installMarkup) + rentalsMarkup);
  const coversPrice = roundUp(coversCostBase * (1 + installMarkup));
  const punchPrice = roundUp(punchCostBase * (1 + installMarkup));
  const installationPrice = installPrice + coversPrice + punchPrice;

  const installRevenue = buckingPrice + waterproofingPrice + installationPrice;
  const installCostTotal =
    buckingCostBase +
    waterproofingCostBase +
    installCostBase +
    coversCostBase +
    punchCostBase +
    rentals;
  const totalContractPrice =
    productPrice + installRevenue;
  const projectCostTotal = productCostBase + installCostTotal;
  const productMargin = calculateMargin(productPrice, productCostBase);
  const installMargin = calculateMargin(installRevenue, installCostTotal);
  const projectMargin = calculateMargin(totalContractPrice, projectCostTotal);

  const materialDraw1 = productPrice * 0.33333;
  const materialDraw2 = productPrice * 0.33333;
  const materialDraw3 = productPrice - materialDraw1 - materialDraw2;

  const mobilizationDeposit =
    buckingPrice + waterproofingPrice + installationPrice * 0.3;
  const installationDraw1 = installationPrice * 0.3;
  const installationDraw2 = installationPrice * 0.3;
  const finalPayment =
    buckingPrice +
    waterproofingPrice +
    installationPrice -
    (mobilizationDeposit + installationDraw1 + installationDraw2);
  const productFeaturesBlock = buildProductFeaturesBlock(products);
  const pdfInfoValues = buildPdfInfoValues(draft.info);

  const pdfValues: Record<string, number | string> = {
    ...pdfInfoValues,
    product_price: productPrice,
    bucking_price: buckingPrice,
    waterproofing_price: waterproofingPrice,
    installation_price: installationPrice,
    total_contract_price: totalContractPrice,
    material_draw_1: materialDraw1,
    material_draw_2: materialDraw2,
    material_draw_3: materialDraw3,
    mobilization_deposit: mobilizationDeposit,
    installation_draw_1: installationDraw1,
    installation_draw_2: installationDraw2,
    final_payment: finalPayment,
    product_features_block: productFeaturesBlock,
  };

  return {
    totals: {
      product_price: productPrice,
      bucking_price: buckingPrice,
      waterproofing_price: waterproofingPrice,
      installation_price: installationPrice,
      total_contract_price: totalContractPrice,
    },
    schedule: {
      material_draw_1: materialDraw1,
      material_draw_2: materialDraw2,
      material_draw_3: materialDraw3,
      mobilization_deposit: mobilizationDeposit,
      installation_draw_1: installationDraw1,
      installation_draw_2: installationDraw2,
      final_payment: finalPayment,
    },
    breakdown: {
      total_lineal_ft: totalLinealFt,
      total_install_value: totalInstallValue,
      install_cost_base: installCostBase,
      covers_cost_base: coversCostBase,
      punch_cost_base: punchCostBase,
      bucking_cost_base: buckingCostBase,
      waterproofing_cost_base: waterproofingCostBase,
      rentals_markup: rentalsMarkup,
    },
    margins: {
      product_margin: productMargin,
      install_margin: installMargin,
      project_margin: projectMargin,
    },
    marginThresholds,
    marginChecks: {
      product_margin_ok: productMargin > marginThresholds.product_margin_min,
      install_margin_ok: installMargin > marginThresholds.install_margin_min,
      project_margin_ok: projectMargin > marginThresholds.project_margin_min,
    },
    panelCounts,
    panelTotals,
    pdfValues,
  };
}

function computeChangeOrderEstimate(
  draft: EstimateDraft,
  marginThresholds: MarginThresholds
): EstimateComputed {
  const vendorName = String(draft.changeOrder.vendorName ?? "").trim();
  const vendorCost = toNumber(draft.changeOrder.vendorCost);
  const vendorMarkup = toNumber(draft.changeOrder.vendorMarkup);
  const vendorPrice = roundUp(vendorCost * (1 + vendorMarkup));

  const laborCost = toNumber(draft.changeOrder.laborCost);
  const laborMarkup = toNumber(draft.changeOrder.laborMarkup);
  const laborPrice = roundUp(laborCost * (1 + laborMarkup));

  const totalContractPrice = vendorPrice + laborPrice;
  const totalCostBase = vendorCost + laborCost;

  const productMargin = calculateMargin(vendorPrice, vendorCost);
  const installMargin = calculateMargin(laborPrice, laborCost);
  const projectMargin = calculateMargin(totalContractPrice, totalCostBase);

  const pdfInfoValues = buildPdfInfoValues(draft.info);
  const pdfValues: Record<string, number | string> = {
    ...pdfInfoValues,
    product_price: vendorPrice,
    bucking_price: 0,
    waterproofing_price: 0,
    installation_price: laborPrice,
    total_contract_price: totalContractPrice,
    material_draw_1: 0,
    material_draw_2: 0,
    material_draw_3: 0,
    mobilization_deposit: 0,
    installation_draw_1: 0,
    installation_draw_2: 0,
    final_payment: totalContractPrice,
    product_features_block: "- No product features selected.",
    change_order_vendor: vendorName,
    change_order_vendor_cost: vendorCost,
    change_order_vendor_markup: vendorMarkup,
    change_order_vendor_total: vendorPrice,
    change_order_labor_cost: laborCost,
    change_order_labor_markup: laborMarkup,
    change_order_labor_total: laborPrice,
    change_order_total: totalContractPrice,
  };

  return {
    totals: {
      product_price: vendorPrice,
      bucking_price: 0,
      waterproofing_price: 0,
      installation_price: laborPrice,
      total_contract_price: totalContractPrice,
    },
    schedule: {
      material_draw_1: 0,
      material_draw_2: 0,
      material_draw_3: 0,
      mobilization_deposit: 0,
      installation_draw_1: 0,
      installation_draw_2: 0,
      final_payment: totalContractPrice,
    },
    breakdown: {
      total_lineal_ft: 0,
      total_install_value: laborCost,
      install_cost_base: laborCost,
      covers_cost_base: 0,
      punch_cost_base: 0,
      bucking_cost_base: 0,
      waterproofing_cost_base: 0,
      rentals_markup: 0,
    },
    margins: {
      product_margin: productMargin,
      install_margin: installMargin,
      project_margin: projectMargin,
    },
    marginThresholds,
    marginChecks: {
      product_margin_ok: productMargin > marginThresholds.product_margin_min,
      install_margin_ok: installMargin > marginThresholds.install_margin_min,
      project_margin_ok: projectMargin > marginThresholds.project_margin_min,
    },
    panelCounts: {},
    panelTotals: {},
    pdfValues,
  };
}

function buildProductFeaturesBlock(products: ProductItem[]) {
  const lines: string[] = [];

  products.forEach((product) => {
    const productLines: string[] = [];

    PRODUCT_FEATURE_SELECT_FIELDS.forEach((field) => {
      const value = String(product[field.key] ?? "").trim();
      if (!value) return;
      productLines.push(`- ${field.label}: ${value}`);
    });

    if (product.stainless_operating_hardware) {
      productLines.push("- Stainless operating hardware: Yes");
    }
    if (product.has_screens) {
      productLines.push("- Screens: Yes");
    }

    if (!productLines.some((line) => line.startsWith("- "))) return;
    if (lines.length) {
      lines.push("");
    }
    lines.push(...productLines);
  });

  if (!lines.length) return "- No product features selected.";
  return lines.join("\n");
}

function buildPdfInfoValues(info: EstimateInfo) {
  const planSetDate = String(info.plan_set_date ?? "").trim() || "N/A";
  return {
    ...info,
    plan_set_date: planSetDate,
  };
}

function normalizePanelTypes(
  panelTypes: PanelType[],
  bucking: BuckingLineItem[]
) {
  const map = new Map(
    panelTypes.map(
      (panel) =>
        [
          panel.id,
          {
            ...panel,
            vendorPrices: normalizeVendorPriceMap(panel.vendorPrices),
          },
        ] as const
    )
  );

  for (const item of bucking) {
    if (!item.unit_type || map.has(item.unit_type)) continue;
    map.set(item.unit_type, {
      id: item.unit_type,
      label: item.unit_type,
      price: 0,
      vendorPrices: {},
    });
  }

  return Array.from(map.values());
}

function normalizeVendorPriceMap(value: Record<string, number> | undefined) {
  if (!value || typeof value !== "object") return {};
  const entries = Object.entries(value)
    .map(([vendorId, price]) => [String(vendorId).trim(), Number(price)] as const)
    .filter(([vendorId, price]) => vendorId && Number.isFinite(price));
  return Object.fromEntries(entries);
}

function resolvePanelPrice(
  panel: PanelType | undefined,
  vendorId: string
) {
  if (!panel) return 0;
  if (vendorId) {
    const vendorPrice = panel.vendorPrices?.[vendorId];
    if (typeof vendorPrice === "number" && Number.isFinite(vendorPrice)) {
      return vendorPrice;
    }
  }
  return Number.isFinite(panel.price) ? panel.price : 0;
}

function resolveDefaultInstallVendorId(products: ProductItem[]) {
  const ids = products
    .map((item) => String(item.vendorId ?? "").trim())
    .filter(Boolean);
  if (!ids.length) return "";
  return ids[0];
}

function resolveUnitTypeOverridePrice(
  overrides: Record<string, string>,
  unitType: string
) {
  const raw = String(overrides[unitType] ?? "").trim();
  if (!raw) return null;
  const parsed = toNumber(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return parsed;
}

export function normalizeUnitTypeCostOverrides(
  value: unknown
): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const entries: Array<[string, string]> = [];
  Object.entries(value as Record<string, unknown>).forEach(([key, raw]) => {
    const unitType = String(key).trim();
    if (!unitType) return;
    const normalized = String(raw ?? "").trim();
    if (!normalized) return;
    entries.push([unitType, normalized]);
  });
  return Object.fromEntries(entries);
}

function applyOverrideValue(baseValue: number, override: ParsedOverrideInput) {
  if (override.mode === "none") return baseValue;
  if (override.mode === "delta") return baseValue + override.value;
  return override.value;
}

export function roundUp(value: number) {
  if (!Number.isFinite(value)) return 0;
  return value >= 0 ? Math.ceil(value) : Math.floor(value);
}

export function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

export function toNumber(value: string | number | undefined | null) {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/[^\d.-]/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function parseOverrideInput(
  value: string | number | undefined | null
): ParsedOverrideInput {
  if (value === null || value === undefined) {
    return { mode: "none", value: 0, raw: "" };
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return { mode: "absolute", value, raw: String(value) };
  }
  const raw = String(value).trim();
  if (!raw || !/\d/.test(raw)) {
    return { mode: "none", value: 0, raw };
  }
  const parsed = toNumber(raw);
  if (!Number.isFinite(parsed)) {
    return { mode: "none", value: 0, raw };
  }
  const sign = raw[0];
  if (sign === "+" || sign === "-") {
    return { mode: "delta", value: parsed, raw };
  }
  return { mode: "absolute", value: parsed, raw };
}

export function hasOverrideInput(value: string | number | undefined | null) {
  return parseOverrideInput(value).mode !== "none";
}

export function normalizeMarginThresholds(
  value: Partial<MarginThresholds> | null | undefined
): MarginThresholds {
  return {
    product_margin_min: normalizeMarginThreshold(value?.product_margin_min),
    install_margin_min: normalizeMarginThreshold(value?.install_margin_min),
    project_margin_min: normalizeMarginThreshold(value?.project_margin_min),
  };
}

export function isChangeOrderProjectType(value: unknown) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized) return false;
  return (
    normalized === "change order" ||
    normalized === "change-order" ||
    normalized.includes("change order")
  );
}

function normalizeMarginThreshold(value: string | number | undefined | null) {
  const numeric = toNumber(value);
  if (!Number.isFinite(numeric)) return 0;
  if (numeric < 0) return 0;
  if (numeric > 1) return 1;
  return numeric;
}

function calculateMargin(revenue: number, cost: number) {
  if (!Number.isFinite(revenue) || revenue <= 0) return 0;
  if (!Number.isFinite(cost)) return 0;
  return (revenue - cost) / revenue;
}

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
