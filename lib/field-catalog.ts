import estimateFields from "@/config/estimate-fields.json";
import mappingDefault from "@/config/mapping.json";

type MappingFieldSpec = {
  sheet?: string;
  cell?: string;
  format?: string;
};

export type FieldCatalogEntry = {
  key: string;
  label: string;
  format: string;
  source: string;
  notes?: string;
};

const DERIVED_FIELDS: Array<{
  key: string;
  format: string;
  source: string;
  notes?: string;
}> = [
  {
    key: "plan_set_date_line",
    format: "text",
    source: "Derived from plan_set_date",
    notes:
      "Auto-generated line value used when a plan set date is available.",
  },
];

const LABEL_OVERRIDES: Record<string, string> = {
  product_price: "Product Price",
  bucking_price: "Bucking Price",
  waterproofing_price: "Waterproofing Price",
  installation_price: "Installation Price",
  total_contract_price: "Total Contract Price",
  material_draw_1: "Material Draw 1",
  material_draw_2: "Material Draw 2",
  material_draw_3: "Material Draw 3",
  mobilization_deposit: "Mobilization Deposit",
  installation_draw_1: "Installation Draw 1",
  installation_draw_2: "Installation Draw 2",
  final_payment: "Final Payment",
  plan_set_date_line: "Plan Set Date Line",
  product_features_block: "Product Features",
};

const NOTE_OVERRIDES: Record<string, string> = {
  product_features_block:
    "Multiline bullet list generated from selected product feature values.",
};

function toTitleLabel(value: string) {
  return value
    .split("_")
    .filter(Boolean)
    .map((segment) => segment[0]?.toUpperCase() + segment.slice(1))
    .join(" ");
}

function getEstimateFieldLabelMap() {
  const map = new Map<string, string>();
  const groups = Array.isArray((estimateFields as { groups?: unknown[] }).groups)
    ? ((estimateFields as { groups?: unknown[] }).groups as Array<{
        fields?: Array<{ key?: unknown; label?: unknown }>;
      }>)
    : [];
  groups.forEach((group) => {
    (group.fields ?? []).forEach((field) => {
      const key = String(field.key ?? "").trim();
      const label = String(field.label ?? "").trim();
      if (!key || !label) return;
      map.set(key, label);
    });
  });
  return map;
}

export function getSourceFieldKeys() {
  const mappingFields =
    ((mappingDefault as { fields?: Record<string, MappingFieldSpec> }).fields ??
      {}) as Record<string, MappingFieldSpec>;
  const keys = [
    ...Object.keys(mappingFields),
    ...DERIVED_FIELDS.map((field) => field.key),
  ];
  return Array.from(new Set(keys)).sort((a, b) => a.localeCompare(b));
}

export function getFieldCatalog(): FieldCatalogEntry[] {
  const mappingFields =
    ((mappingDefault as { fields?: Record<string, MappingFieldSpec> }).fields ??
      {}) as Record<string, MappingFieldSpec>;
  const derivedMap = new Map(DERIVED_FIELDS.map((field) => [field.key, field]));
  const estimateLabelMap = getEstimateFieldLabelMap();

  return getSourceFieldKeys().map((key) => {
    const mappingSpec = mappingFields[key];
    const derivedSpec = derivedMap.get(key);
    const label =
      LABEL_OVERRIDES[key] ?? estimateLabelMap.get(key) ?? toTitleLabel(key);
    const format = String(
      mappingSpec?.format ?? derivedSpec?.format ?? "text"
    ).trim();
    const source =
      derivedSpec?.source ??
      (mappingSpec?.sheet && mappingSpec?.cell
        ? `${mappingSpec.sheet}!${mappingSpec.cell}`
        : "Computed in app");
    const notes = NOTE_OVERRIDES[key] ?? derivedSpec?.notes;

    return {
      key,
      label,
      format: format || "text",
      source,
      notes,
    };
  });
}

function escapeCsvValue(value: string) {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function getFieldCatalogCsv(entries = getFieldCatalog()) {
  const header = ["key", "label", "format", "source", "notes"];
  const rows = entries.map((entry) => [
    entry.key,
    entry.label,
    entry.format,
    entry.source,
    entry.notes ?? "",
  ]);
  return [header, ...rows]
    .map((row) => row.map((value) => escapeCsvValue(String(value))).join(","))
    .join("\n");
}
