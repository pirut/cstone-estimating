import * as XLSX from "xlsx";
import planningMappingData from "@/config/planning-lines-mapping.json";
import { parseDate } from "@/lib/formatting";
import {
  computeEstimate,
  DEFAULT_DRAFT,
  roundUp,
  toNumber,
} from "@/lib/estimate-calculator";

export type PlanningLineRow = {
  projectNo: string;
  projectTaskNo: string;
  lineType: string;
  planningDate: string;
  plannedDeliveryDate: string;
  documentNo: string;
  type: string;
  userId: string;
  no: string;
  description: string;
  quantity: string;
  qtyToAssemble: string;
  unitCost: string;
  totalCost: string;
  unitPrice: string;
  lineAmount: string;
  qtyToTransferToJournal: string;
  invoicedAmount: string;
  lineNo: string;
};

type PlanningBuildOptions = {
  omitUserId?: boolean;
};

type ProductAmounts = {
  cost: number;
  price: number;
};

type PlanningMappingSeed = {
  productCode?: string;
  taskNo?: string;
  name?: string;
  type?: string;
  lineType?: string;
  percentage?: number;
};

type PlanningMappingEntry = {
  productCode: string;
  taskNo: string;
  fallbackDescription: string;
  type: string;
  lineType: string;
  percentage: number;
};

type EstimateModel = {
  info: Record<string, unknown>;
  products: Array<Record<string, unknown>>;
  calculator: Record<string, unknown>;
  totals: Record<string, unknown>;
  breakdown: Record<string, unknown>;
  changeOrder: Record<string, unknown>;
};

const GL_ACCOUNT_NO = "42000";

const DEFAULT_MAPPING_ENTRIES: PlanningMappingEntry[] = (
  planningMappingData as PlanningMappingSeed[]
).map((entry) => ({
  productCode: String(entry.productCode ?? "").trim().toUpperCase(),
  taskNo: String(entry.taskNo ?? "").trim(),
  fallbackDescription: String(entry.name ?? "").trim(),
  type: String(entry.type ?? "Item").trim() || "Item",
  lineType: String(entry.lineType ?? "Budget").trim() || "Budget",
  percentage:
    typeof entry.percentage === "number" && Number.isFinite(entry.percentage)
      ? entry.percentage
      : 1,
}));

const FULL_HEADERS = [
  "Project No.",
  "Project Task No.",
  "Line Type",
  "Planning Date",
  "Planned Delivery Date",
  "Document No.",
  "Type",
  "User ID",
  "No.",
  "Description",
  "Quantity",
  "Qty. to Assemble",
  "Unit Cost",
  "Total Cost",
  "Unit Price",
  "Line Amount",
  "Qty. to Transfer to Journal",
  "Invoiced Amount ($)",
  "Line No.",
] as const;

const VISIBLE_HEADERS = [
  "Project Task No.",
  "Line Type",
  "Planning Date",
  "Planned Delivery Date",
  "Document No.",
  "Type",
  "User ID",
  "No.",
  "Description",
  "Quantity",
  "Qty. to Assemble",
  "Unit Cost",
  "Total Cost",
  "Unit Price",
  "Line Amount",
  "Qty. to Transfer to Journal",
  "Invoiced Amount ($)",
] as const;

export function buildPlanningLinesFromWorkbookBuffer(
  workbookBuffer: Buffer,
  options: PlanningBuildOptions = {}
): PlanningLineRow[] {
  const workbook = XLSX.read(workbookBuffer, {
    type: "buffer",
    cellDates: true,
  });
  return buildPlanningLinesFromWorkbook(workbook, options);
}

export function buildPlanningLinesFromWorkbook(
  workbook: XLSX.WorkBook,
  options: PlanningBuildOptions = {}
): PlanningLineRow[] {
  const mappingEntries = readPlanningMapping(workbook);
  if (!mappingEntries.length) return [];

  const amountsByProduct = readAmountsByProduct(workbook);
  const productNamesByCode = readProductNamesByCode(workbook, mappingEntries);

  const projectNo =
    getCellString(workbook, "Project Planning_SYNC", "U2") || "PR00000";
  const planningDate = formatDateForSync(getCellValue(workbook, "Job Info", "C9"));
  const plannedDeliveryDate = formatDateForSync(
    getCellValue(workbook, "Job Info", "C10")
  );
  const userId = options.omitUserId
    ? ""
    : getCellString(workbook, "Job Info", "C11");

  return composePlanningRows(
    mappingEntries,
    amountsByProduct,
    productNamesByCode,
    {
      projectNo,
      planningDate,
      plannedDeliveryDate,
      userId,
    }
  );
}

export function buildPlanningLinesFromEstimate(
  estimateData: unknown,
  options: PlanningBuildOptions = {}
): PlanningLineRow[] {
  const model = resolveEstimateModel(estimateData);
  if (!model) return [];

  const mappingEntries = DEFAULT_MAPPING_ENTRIES;
  const productNamesByCode = readProductNamesByMapping(mappingEntries);
  const amountsByProduct = readAmountsByProductFromEstimate(model, mappingEntries);

  const info = model.info ?? {};
  const values =
    estimateData &&
    typeof estimateData === "object" &&
    (estimateData as Record<string, unknown>).values &&
    typeof (estimateData as Record<string, unknown>).values === "object"
      ? ((estimateData as Record<string, unknown>).values as Record<string, unknown>)
      : {};

  const projectNo = asTrimmedString(values.project_no) || "PR00000";
  const planningDate = formatDateForSync(values.proposal_date ?? info.proposal_date);
  const plannedDeliveryDate = formatDateForSync(
    values.plan_set_date ?? info.plan_set_date
  );
  const userId = options.omitUserId
    ? ""
    : asTrimmedString(values.prepared_by ?? info.prepared_by);

  return composePlanningRows(
    mappingEntries,
    amountsByProduct,
    productNamesByCode,
    {
      projectNo,
      planningDate,
      plannedDeliveryDate,
      userId,
    }
  );
}

export function planningLinesToCsv(rows: PlanningLineRow[]) {
  return serializeRows(rows, ",", true);
}

export function planningLinesToTsv(rows: PlanningLineRow[]) {
  return serializeRows(rows, "\t", true);
}

export function planningLinesRowsToTsv(rows: PlanningLineRow[]) {
  return serializeRows(rows, "\t", false);
}

function composePlanningRows(
  mappingEntries: PlanningMappingEntry[],
  amountsByProduct: Map<string, ProductAmounts>,
  productNamesByCode: Map<string, string>,
  context: {
    projectNo: string;
    planningDate: string;
    plannedDeliveryDate: string;
    userId: string;
  }
) {
  const rows: PlanningLineRow[] = [];
  let lineNo = 10000;

  for (const entry of mappingEntries) {
    const amounts = amountsByProduct.get(entry.productCode) ?? { cost: 0, price: 0 };
    const scaledCost = roundCurrency(amounts.cost * entry.percentage);
    const scaledPrice = roundCurrency(amounts.price * entry.percentage);

    const isBudget = entry.lineType.toLowerCase() === "budget";
    const principalValue = isBudget ? scaledCost : scaledPrice;
    if (Math.abs(principalValue) < 0.005) continue;

    const displayName =
      productNamesByCode.get(entry.productCode) || entry.fallbackDescription;
    const description = buildDescription(displayName, entry, isBudget);
    const no = isBudget ? entry.productCode : GL_ACCOUNT_NO;

    rows.push({
      projectNo: context.projectNo,
      projectTaskNo: entry.taskNo,
      lineType: entry.lineType,
      planningDate: context.planningDate,
      plannedDeliveryDate: context.plannedDeliveryDate,
      documentNo: "",
      type: entry.type,
      userId: context.userId,
      no,
      description,
      quantity: "1",
      qtyToAssemble: "",
      unitCost: isBudget ? formatMoney(scaledCost) : formatMoney(0),
      totalCost: isBudget ? formatMoney(scaledCost) : formatMoney(0),
      unitPrice: isBudget ? formatMoney(0) : formatMoney(scaledPrice),
      lineAmount: isBudget ? formatMoney(0) : formatMoney(scaledPrice),
      qtyToTransferToJournal: "",
      invoicedAmount: "",
      lineNo: String(lineNo),
    });
    lineNo += 10000;
  }

  return rows;
}

function serializeRows(
  rows: PlanningLineRow[],
  delimiter: "," | "\t",
  includeHeaders: boolean
) {
  const body = rows.map((row) => toVisibleColumns(row, delimiter).join(delimiter));
  if (!includeHeaders) return body.join("\r\n");

  const headerRow = VISIBLE_HEADERS.map((value) =>
    escapeDelimitedValue(value, delimiter)
  ).join(delimiter);
  return [headerRow, ...body].join("\r\n");
}

export function planningLinesToFullCsv(rows: PlanningLineRow[]) {
  const headerRow = FULL_HEADERS.map((value) => escapeDelimitedValue(value, ",")).join(
    ","
  );
  const body = rows.map((row) =>
    [
      row.projectNo,
      row.projectTaskNo,
      row.lineType,
      row.planningDate,
      row.plannedDeliveryDate,
      row.documentNo,
      row.type,
      row.userId,
      row.no,
      row.description,
      row.quantity,
      row.qtyToAssemble,
      row.unitCost,
      row.totalCost,
      row.unitPrice,
      row.lineAmount,
      row.qtyToTransferToJournal,
      row.invoicedAmount,
      row.lineNo,
    ]
      .map((value) => escapeDelimitedValue(value, ","))
      .join(",")
  );

  return [headerRow, ...body].join("\r\n");
}

function toVisibleColumns(row: PlanningLineRow, delimiter: "," | "\t") {
  return [
    row.projectTaskNo,
    row.lineType,
    row.planningDate,
    row.plannedDeliveryDate,
    row.documentNo,
    row.type,
    row.userId,
    row.no,
    row.description,
    row.quantity,
    row.qtyToAssemble,
    row.unitCost,
    row.totalCost,
    row.unitPrice,
    row.lineAmount,
    row.qtyToTransferToJournal,
    row.invoicedAmount,
  ].map((value) => escapeDelimitedValue(value, delimiter));
}

function buildDescription(
  displayName: string,
  entry: PlanningMappingEntry,
  isBudget: boolean
) {
  const normalized = displayName.trim();
  if (!normalized) return entry.productCode;
  if (isBudget) return normalized;
  if (entry.percentage >= 0.9995) return normalized;
  return `${normalized} ${formatPercent(entry.percentage)}`;
}

function formatPercent(value: number) {
  const pct = Math.round(value * 100);
  return `${pct}%`;
}

function readPlanningMapping(workbook: XLSX.WorkBook): PlanningMappingEntry[] {
  const sheetName = "Product Planning Lines Mapping";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.["!ref"]) return DEFAULT_MAPPING_ENTRIES;

  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const entries: PlanningMappingEntry[] = [];
  let blankRows = 0;

  for (let row = 2; row <= range.e.r + 1; row += 1) {
    const productCode = getCellString(workbook, sheetName, `A${row}`).toUpperCase();
    const taskNo = getCellString(workbook, sheetName, `B${row}`);
    const description = getCellString(workbook, sheetName, `C${row}`);
    const type = getCellString(workbook, sheetName, `D${row}`);
    const lineType = getCellString(workbook, sheetName, `E${row}`);
    const percentageRaw = getCellNumber(workbook, sheetName, `F${row}`);

    if (!productCode && !taskNo && !description) {
      blankRows += 1;
      if (blankRows >= 8) break;
      continue;
    }
    blankRows = 0;

    if (!productCode || !taskNo) continue;

    entries.push({
      productCode,
      taskNo,
      fallbackDescription: description,
      type: type || "Item",
      lineType: lineType || "Budget",
      percentage: percentageRaw || 1,
    });
  }

  return entries.length ? entries : DEFAULT_MAPPING_ENTRIES;
}

function readProductNamesByCode(
  workbook: XLSX.WorkBook,
  mappingEntries: PlanningMappingEntry[]
) {
  const map = readProductNamesByMapping(mappingEntries);
  const sheetName = "Product Pricing";
  const sheet = workbook.Sheets[sheetName];
  const ref = sheet?.["!ref"];
  if (!sheet || !ref) return map;

  const range = XLSX.utils.decode_range(ref);
  for (let row = 2; row <= Math.max(range.e.r + 1, 500); row += 1) {
    const code = getCellString(workbook, sheetName, `E${row}`).toUpperCase();
    const name = getCellString(workbook, sheetName, `A${row}`);
    if (!code || !name) continue;
    map.set(code, name);
  }

  return map;
}

function readProductNamesByMapping(mappingEntries: PlanningMappingEntry[]) {
  const map = new Map<string, string>();
  for (const entry of mappingEntries) {
    if (!entry.productCode || !entry.fallbackDescription) continue;
    if (!map.has(entry.productCode)) {
      map.set(entry.productCode, entry.fallbackDescription);
    }
  }
  return map;
}

function readAmountsByProduct(workbook: XLSX.WorkBook) {
  const amountsByProduct = new Map<string, ProductAmounts>();
  const pricingSheet = "Product Pricing";
  const pricingSheetRef = workbook.Sheets[pricingSheet]?.["!ref"];

  if (pricingSheetRef) {
    const range = XLSX.utils.decode_range(pricingSheetRef);
    for (let row = 2; row <= Math.max(range.e.r + 1, 500); row += 1) {
      const code = getCellString(workbook, pricingSheet, `E${row}`).toUpperCase();
      if (!code) continue;
      const cost = getCellNumber(workbook, pricingSheet, `B${row}`);
      const price = getCellNumber(workbook, pricingSheet, `D${row}`);
      setAmounts(amountsByProduct, code, cost, price, "merge");
    }
  }

  const installSheet = "Install Pricing";
  setAmounts(
    amountsByProduct,
    "SUB0001",
    getCellNumber(workbook, installSheet, "A2"),
    getCellNumber(workbook, installSheet, "I2"),
    "replace"
  );
  setAmounts(
    amountsByProduct,
    "SUB0002",
    getCellNumber(workbook, installSheet, "B2"),
    getCellNumber(workbook, installSheet, "J2"),
    "replace"
  );
  setAmounts(
    amountsByProduct,
    "SUB0003",
    getCellNumber(workbook, installSheet, "C2"),
    getCellNumber(workbook, installSheet, "K2"),
    "replace"
  );
  setAmounts(
    amountsByProduct,
    "SUB0004",
    getCellNumber(workbook, installSheet, "D2"),
    getCellNumber(workbook, installSheet, "L2"),
    "replace"
  );
  setAmounts(
    amountsByProduct,
    "SUB0005",
    getCellNumber(workbook, installSheet, "E2"),
    getCellNumber(workbook, installSheet, "M2"),
    "replace"
  );

  const rentalsCost = getCellNumber(workbook, installSheet, "E7");
  const rentalsPriceRaw = getCellNumber(workbook, installSheet, "I7");
  const markup = getCellNumber(workbook, installSheet, "G2");
  const rentalsPrice = rentalsPriceRaw || rentalsCost * (1 + markup);
  setAmounts(amountsByProduct, "RENT0001", rentalsCost, rentalsPrice, "replace");

  return amountsByProduct;
}

function readAmountsByProductFromEstimate(
  model: EstimateModel,
  mappingEntries: PlanningMappingEntry[]
) {
  const amountsByProduct = new Map<string, ProductAmounts>();
  const defaultMarkup = toNumber(
    asNumberish(model.calculator.product_markup_default)
  );

  for (const item of model.products) {
    const vendorName = asTrimmedString(item.name);
    const code = resolveProductCode(vendorName, mappingEntries);
    if (!code) continue;

    const cost = toNumber(asNumberish(item.price));
    const hasMarkup = asTrimmedString(item.markup) !== "";
    const markup = hasMarkup ? toNumber(asNumberish(item.markup)) : defaultMarkup;
    const price = roundUp(cost * (1 + markup));
    setAmounts(amountsByProduct, code, cost, price, "merge");
  }

  if (!model.products.length) {
    const vendorName = asTrimmedString(model.changeOrder.vendorName);
    const code = resolveProductCode(vendorName, mappingEntries);
    if (code) {
      const cost = toNumber(asNumberish(model.changeOrder.vendorCost));
      const markup = toNumber(asNumberish(model.changeOrder.vendorMarkup));
      const price = roundUp(cost * (1 + markup));
      setAmounts(amountsByProduct, code, cost, price, "merge");
    }
  }

  const installMarkup = toNumber(asNumberish(model.calculator.install_markup));
  const rentals = toNumber(asNumberish(model.calculator.rentals));
  const breakdown = model.breakdown;
  const totals = model.totals;

  const buckingCostBase = toNumber(asNumberish(breakdown.bucking_cost_base));
  const waterproofingCostBase = toNumber(
    asNumberish(breakdown.waterproofing_cost_base)
  );
  const installCostBase = toNumber(asNumberish(breakdown.install_cost_base));
  const coversCostBase = toNumber(asNumberish(breakdown.covers_cost_base));
  const punchCostBase = toNumber(asNumberish(breakdown.punch_cost_base));

  const buckingPrice = toNumber(asNumberish(totals.bucking_price));
  const waterproofingPrice = toNumber(asNumberish(totals.waterproofing_price));
  const rentalsMarkup = toNumber(asNumberish(breakdown.rentals_markup));
  const installPrice = roundUp(installCostBase * (1 + installMarkup) + rentalsMarkup);
  const coversPrice = roundUp(coversCostBase * (1 + installMarkup));
  const punchPrice = roundUp(punchCostBase * (1 + installMarkup));

  setAmounts(amountsByProduct, "SUB0001", buckingCostBase, buckingPrice, "replace");
  setAmounts(
    amountsByProduct,
    "SUB0002",
    waterproofingCostBase,
    waterproofingPrice,
    "replace"
  );
  setAmounts(amountsByProduct, "SUB0003", installCostBase, installPrice, "replace");
  setAmounts(amountsByProduct, "SUB0004", coversCostBase, coversPrice, "replace");
  setAmounts(amountsByProduct, "SUB0005", punchCostBase, punchPrice, "replace");
  setAmounts(
    amountsByProduct,
    "RENT0001",
    rentals,
    rentalsMarkup || rentals * (1 + installMarkup),
    "replace"
  );

  return amountsByProduct;
}

function resolveEstimateModel(estimateData: unknown): EstimateModel | null {
  if (!estimateData || typeof estimateData !== "object") return null;
  const raw = estimateData as Record<string, unknown>;

  const infoRaw = raw.info && typeof raw.info === "object" ? raw.info : {};
  const productsRaw = Array.isArray(raw.products) ? raw.products : [];
  const buckingRaw = Array.isArray(raw.bucking) ? raw.bucking : [];
  const calculatorRaw =
    raw.calculator && typeof raw.calculator === "object" ? raw.calculator : {};
  const changeOrderRaw =
    raw.changeOrder && typeof raw.changeOrder === "object" ? raw.changeOrder : {};

  const hasStructured =
    Array.isArray(raw.products) ||
    Array.isArray(raw.bucking) ||
    (raw.calculator && typeof raw.calculator === "object") ||
    (raw.changeOrder && typeof raw.changeOrder === "object");

  if (hasStructured) {
    const computed =
      raw.totals && raw.breakdown
        ? {
            totals: raw.totals as Record<string, unknown>,
            breakdown: raw.breakdown as Record<string, unknown>,
          }
        : computeEstimate({
            info: infoRaw as any,
            products: productsRaw.length ? (productsRaw as any) : DEFAULT_DRAFT.products,
            bucking: buckingRaw.length ? (buckingRaw as any) : DEFAULT_DRAFT.bucking,
            calculator: {
              ...DEFAULT_DRAFT.calculator,
              ...(calculatorRaw as Record<string, unknown>),
            } as any,
            changeOrder: {
              ...DEFAULT_DRAFT.changeOrder,
              ...(changeOrderRaw as Record<string, unknown>),
            } as any,
          });

    return {
      info: infoRaw as Record<string, unknown>,
      products: productsRaw as Array<Record<string, unknown>>,
      calculator: {
        ...DEFAULT_DRAFT.calculator,
        ...(calculatorRaw as Record<string, unknown>),
      },
      changeOrder: {
        ...DEFAULT_DRAFT.changeOrder,
        ...(changeOrderRaw as Record<string, unknown>),
      },
      totals: computed.totals as Record<string, unknown>,
      breakdown: computed.breakdown as Record<string, unknown>,
    };
  }

  return null;
}

function resolveProductCode(name: string, mappingEntries: PlanningMappingEntry[]) {
  const trimmed = name.trim();
  if (!trimmed) return "";

  const codeMatch = trimmed.match(/\b([A-Z]{2,}\d{3,})\b/i);
  if (codeMatch) return codeMatch[1].toUpperCase();

  const normalizedName = normalizeName(trimmed);
  const exactMatches = new Set<string>();
  for (const entry of mappingEntries) {
    if (!entry.productCode || !entry.fallbackDescription) continue;
    if (normalizeName(entry.fallbackDescription) === normalizedName) {
      exactMatches.add(entry.productCode);
    }
  }
  if (exactMatches.size === 1) return Array.from(exactMatches)[0];

  const fuzzyMatches = new Set<string>();
  for (const entry of mappingEntries) {
    if (!entry.productCode || !entry.fallbackDescription) continue;
    const candidate = normalizeName(entry.fallbackDescription);
    if (candidate.includes(normalizedName) || normalizedName.includes(candidate)) {
      fuzzyMatches.add(entry.productCode);
    }
  }
  if (fuzzyMatches.size === 1) return Array.from(fuzzyMatches)[0];

  return "";
}

function normalizeName(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function setAmounts(
  map: Map<string, ProductAmounts>,
  productCode: string,
  cost: number,
  price: number,
  mode: "merge" | "replace"
) {
  if (!productCode) return;
  if (mode === "replace") {
    map.set(productCode, {
      cost: Number.isFinite(cost) ? cost : 0,
      price: Number.isFinite(price) ? price : 0,
    });
    return;
  }

  const current = map.get(productCode) ?? { cost: 0, price: 0 };
  map.set(productCode, {
    cost: current.cost + (Number.isFinite(cost) ? cost : 0),
    price: current.price + (Number.isFinite(price) ? price : 0),
  });
}

function getCellValue(workbook: XLSX.WorkBook, sheetName: string, cell: string) {
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  return sheet[cell]?.v ?? null;
}

function getCellString(workbook: XLSX.WorkBook, sheetName: string, cell: string) {
  const value = getCellValue(workbook, sheetName, cell);
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getCellNumber(workbook: XLSX.WorkBook, sheetName: string, cell: string) {
  const value = getCellValue(workbook, sheetName, cell);
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return 0;
  const cleaned = value.replace(/[$,]/g, "").trim();
  if (!cleaned) return 0;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function asTrimmedString(value: unknown) {
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asNumberish(value: unknown): string | number | undefined {
  if (typeof value === "string" || typeof value === "number") return value;
  return undefined;
}

function roundCurrency(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "0.00";
  return value.toFixed(2);
}

function formatDateForSync(value: unknown) {
  const parsed = parseDate(value);
  if (!parsed) return "";
  const year = parsed.getFullYear();
  const month = String(parsed.getMonth() + 1).padStart(2, "0");
  const day = String(parsed.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeDelimitedValue(value: string, delimiter: "," | "\t") {
  const stringValue = value ?? "";
  const escaped = stringValue.includes('"')
    ? stringValue.replace(/"/g, '""')
    : stringValue;

  const needsQuoting =
    escaped.includes(delimiter) || escaped.includes("\n") || escaped.includes("\r");
  return needsQuoting ? `"${escaped}"` : escaped;
}
