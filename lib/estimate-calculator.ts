import { DEFAULT_UNIT_TYPES } from "@/lib/catalog-defaults";

export type EstimateInfo = {
  prepared_for?: string;
  project_name?: string;
  city_state_zip?: string;
  proposal_date?: string;
  plan_set_date?: string;
  prepared_by?: string;
};

export type ProductItem = {
  id: string;
  name: string;
  price: string;
  markup: string;
};

export type BuckingLineItem = {
  id: string;
  unit_type: string;
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
  override_bucking_cost: string;
  override_waterproofing_cost: string;
  override_install_total: string;
};

export type EstimateDraft = {
  info: EstimateInfo;
  products: ProductItem[];
  bucking: BuckingLineItem[];
  calculator: InstallCalculator;
};

export type PanelType = {
  id: string;
  label: string;
  price: number;
};

export const PANEL_TYPES: PanelType[] = DEFAULT_UNIT_TYPES.map((unit) => ({
  id: unit.code,
  label: unit.label,
  price: unit.price,
}));

export const DEFAULT_DRAFT: EstimateDraft = {
  info: {},
  products: [
    {
      id: "product-1",
      name: "",
      price: "",
      markup: "0.5",
    },
  ],
  bucking: [
    {
      id: "bucking-1",
      unit_type: "SH",
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
    override_bucking_cost: "",
    override_waterproofing_cost: "",
    override_install_total: "",
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
  panelCounts: Record<
    string,
    { total_qty: number; clerestory_qty: number; replacement_qty: number }
  >;
  panelTotals: Record<string, number>;
  pdfValues: Record<string, number | string>;
};

export function computeEstimate(
  draft: EstimateDraft,
  panelTypes: PanelType[] = PANEL_TYPES
): EstimateComputed {
  const resolvedPanelTypes = normalizePanelTypes(panelTypes, draft.bucking ?? []);
  const productMarkupDefault = toNumber(draft.calculator.product_markup_default);
  const installMarkup = toNumber(draft.calculator.install_markup);
  const buckingRate = toNumber(draft.calculator.bucking_rate);
  const waterproofRate = toNumber(draft.calculator.waterproofing_rate);
  const rentals = toNumber(draft.calculator.rentals);

  const products = draft.products ?? [];
  const productTotals = products.map((item) => {
    const price = toNumber(item.price);
    const markup = item.markup.trim() ? toNumber(item.markup) : productMarkupDefault;
    return roundUp(price * (1 + markup));
  });
  const productPrice = sum(productTotals);

  const linealTotals = (draft.bucking ?? []).map((item) => {
    const qty = toNumber(item.qty);
    const sqft = toNumber(item.sqft);
    if (!qty) return 0;
    const perUnit = Math.sqrt((sqft / qty) / 6) * 11;
    return Math.abs(perUnit) * qty;
  });
  const totalLinealFt = sum(linealTotals);

  const overrideBucking = toNumber(draft.calculator.override_bucking_cost);
  const overrideWaterproof = toNumber(draft.calculator.override_waterproofing_cost);

  const buckingCostBase =
    draft.calculator.override_bucking_cost.trim() !== ""
      ? overrideBucking
      : totalLinealFt * buckingRate;
  const waterproofingCostBase =
    draft.calculator.override_waterproofing_cost.trim() !== ""
      ? overrideWaterproof
      : totalLinealFt * waterproofRate;

  const panelCounts: EstimateComputed["panelCounts"] = {};
  const panelTotals: EstimateComputed["panelTotals"] = {};
  resolvedPanelTypes.forEach((panel) => {
    panelCounts[panel.id] = {
      total_qty: 0,
      clerestory_qty: 0,
      replacement_qty: 0,
    };
  });

  for (const item of draft.bucking ?? []) {
    const type = item.unit_type;
    if (!panelCounts[type]) continue;
    panelCounts[type].total_qty += toNumber(item.qty);
    panelCounts[type].clerestory_qty += toNumber(item.clerestory_qty);
    panelCounts[type].replacement_qty += toNumber(item.replacement_qty);
  }

  for (const panel of resolvedPanelTypes) {
    const counts = panelCounts[panel.id];
    const total =
      panel.price * counts.total_qty +
      panel.price * counts.clerestory_qty * 0.5 +
      panel.price * counts.replacement_qty;
    panelTotals[panel.id] = total;
  }

  const panelInstallValue = sum(Object.values(panelTotals));
  const overrideInstallTotal = toNumber(draft.calculator.override_install_total);
  const totalInstallValue =
    draft.calculator.override_install_total.trim() !== ""
      ? overrideInstallTotal
      : panelInstallValue;

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

  const totalContractPrice =
    productPrice + buckingPrice + waterproofingPrice + installationPrice;

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

  const pdfValues: Record<string, number | string> = {
    ...draft.info,
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
    panelCounts,
    panelTotals,
    pdfValues,
  };
}

function normalizePanelTypes(
  panelTypes: PanelType[],
  bucking: BuckingLineItem[]
) {
  const fallback = panelTypes.length ? panelTypes : PANEL_TYPES;
  const map = new Map(fallback.map((panel) => [panel.id, panel] as const));

  for (const item of bucking) {
    if (!item.unit_type || map.has(item.unit_type)) continue;
    map.set(item.unit_type, {
      id: item.unit_type,
      label: item.unit_type,
      price: 0,
    });
  }

  return Array.from(map.values());
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
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}`;
}
