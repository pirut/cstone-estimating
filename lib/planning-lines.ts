import * as XLSX from "xlsx";
import { parseDate } from "@/lib/formatting";

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

type ProductAmounts = {
  cost: number;
  price: number;
};

type PlanningMappingEntry = {
  productCode: string;
  taskNo: string;
  description: string;
  type: string;
  lineType: string;
  percentage: number;
};

const SYNC_HEADERS = [
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

export function buildPlanningLinesFromWorkbookBuffer(
  workbookBuffer: Buffer
): PlanningLineRow[] {
  const workbook = XLSX.read(workbookBuffer, {
    type: "buffer",
    cellDates: true,
  });
  return buildPlanningLinesFromWorkbook(workbook);
}

export function buildPlanningLinesFromWorkbook(
  workbook: XLSX.WorkBook
): PlanningLineRow[] {
  const mappingEntries = readPlanningMapping(workbook);
  if (!mappingEntries.length) return [];

  const amountsByProduct = readAmountsByProduct(workbook);
  const projectNo =
    getCellString(workbook, "Project Planning_SYNC", "U2") || "PR00000";
  const planningDate = formatDateForSync(
    getCellValue(workbook, "Job Info", "C9")
  );
  const plannedDeliveryDate = formatDateForSync(
    getCellValue(workbook, "Job Info", "C10")
  );
  const userId = getCellString(workbook, "Job Info", "C11");

  const rows: PlanningLineRow[] = [];
  let lineNo = 10000;
  for (const entry of mappingEntries) {
    const amounts = amountsByProduct.get(entry.productCode) ?? { cost: 0, price: 0 };
    const scaledCost = roundCurrency(amounts.cost * entry.percentage);
    const scaledPrice = roundCurrency(amounts.price * entry.percentage);

    const useBudget = entry.lineType.toLowerCase() === "budget";
    const principalValue = useBudget ? scaledCost : scaledPrice;
    if (Math.abs(principalValue) < 0.005) continue;

    rows.push({
      projectNo,
      projectTaskNo: entry.taskNo,
      lineType: entry.lineType,
      planningDate,
      plannedDeliveryDate,
      documentNo: "",
      type: entry.type,
      userId,
      no: entry.productCode,
      description: entry.description,
      quantity: "1",
      qtyToAssemble: "",
      unitCost: useBudget ? formatMoney(scaledCost) : "",
      totalCost: useBudget ? formatMoney(scaledCost) : "",
      unitPrice: useBudget ? "" : formatMoney(scaledPrice),
      lineAmount: useBudget ? "" : formatMoney(scaledPrice),
      qtyToTransferToJournal: "",
      invoicedAmount: "",
      lineNo: String(lineNo),
    });
    lineNo += 10000;
  }

  return rows;
}

export function planningLinesToCsv(rows: PlanningLineRow[]) {
  const lines = rows.map((row) =>
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
      .map(csvEscape)
      .join(",")
  );

  return [SYNC_HEADERS.map(csvEscape).join(","), ...lines].join("\n");
}

function readPlanningMapping(workbook: XLSX.WorkBook): PlanningMappingEntry[] {
  const sheetName = "Product Planning Lines Mapping";
  const sheet = workbook.Sheets[sheetName];
  if (!sheet?.["!ref"]) return [];

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
      description,
      type: type || "Item",
      lineType: lineType || "Budget",
      percentage: percentageRaw || 1,
    });
  }

  return entries;
}

function readAmountsByProduct(workbook: XLSX.WorkBook) {
  const amountsByProduct = new Map<string, ProductAmounts>();
  const pricingSheet = "Product Pricing";
  const pricingSheetRef = workbook.Sheets[pricingSheet]?.["!ref"];

  if (pricingSheetRef) {
    const range = XLSX.utils.decode_range(pricingSheetRef);
    for (let row = 2; row <= Math.max(range.e.r + 1, 300); row += 1) {
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

function roundCurrency(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "";
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

function csvEscape(value: string) {
  if (value.includes('"')) {
    value = value.replace(/"/g, '""');
  }
  if (value.includes(",") || value.includes("\n") || value.includes("\r")) {
    return `"${value}"`;
  }
  return value;
}
