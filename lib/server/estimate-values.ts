import { formatValue } from "@/lib/formatting";
import { computeEstimate, DEFAULT_DRAFT } from "@/lib/estimate-calculator";

type MappingFieldSpec = {
  sheet?: string;
  cell?: string;
  format?: string;
};

type MappingConfigLike = {
  missing_value?: unknown;
  prepared_by_map?: unknown;
  fields?: Record<string, MappingFieldSpec>;
};

export function buildFieldValuesFromSourceValues(
  sourceValues: Record<string, unknown>,
  mappingConfig: MappingConfigLike
) {
  const missingValue = String(mappingConfig.missing_value ?? "");
  const preparedByMap = (mappingConfig.prepared_by_map ?? {}) as Record<
    string,
    string
  >;
  const fieldSpecs = (mappingConfig.fields ?? {}) as Record<string, MappingFieldSpec>;

  const values: Record<string, string> = {};

  for (const [fieldName, spec] of Object.entries(fieldSpecs)) {
    const format = String(spec.format || "text");
    const raw = sourceValues[fieldName];
    values[fieldName] = formatValue(raw, format, preparedByMap, missingValue);
  }

  const planSetDate = values.plan_set_date;
  values.plan_set_date_line =
    planSetDate && planSetDate !== missingValue ? planSetDate : missingValue;

  for (const [sourceKey, rawValue] of Object.entries(sourceValues)) {
    if (!sourceKey || sourceKey in values) continue;
    values[sourceKey] = formatValue(rawValue, "text", preparedByMap, missingValue);
  }

  return values;
}

export function extractEstimateValues(estimateData: unknown) {
  if (!estimateData || typeof estimateData !== "object") return {};
  const estimateObject = estimateData as Record<string, unknown>;

  if (
    estimateObject.values &&
    typeof estimateObject.values === "object" &&
    !Array.isArray(estimateObject.values)
  ) {
    return estimateObject.values as Record<string, unknown>;
  }

  if (
    estimateObject.info ||
    estimateObject.products ||
    estimateObject.bucking ||
    estimateObject.calculator ||
    estimateObject.changeOrder
  ) {
    const changeOrderSource =
      estimateObject.changeOrder &&
      typeof estimateObject.changeOrder === "object" &&
      !Array.isArray(estimateObject.changeOrder)
        ? (estimateObject.changeOrder as Record<string, unknown>)
        : {};

    const computed = computeEstimate({
      info:
        estimateObject.info &&
        typeof estimateObject.info === "object" &&
        !Array.isArray(estimateObject.info)
          ? estimateObject.info
          : {},
      products:
        Array.isArray(estimateObject.products) && estimateObject.products.length
          ? estimateObject.products
          : DEFAULT_DRAFT.products,
      bucking:
        Array.isArray(estimateObject.bucking) && estimateObject.bucking.length
          ? estimateObject.bucking
          : DEFAULT_DRAFT.bucking,
      calculator: {
        ...DEFAULT_DRAFT.calculator,
        ...((estimateObject.calculator as Record<string, unknown>) ?? {}),
      },
      changeOrder: {
        ...DEFAULT_DRAFT.changeOrder,
        ...changeOrderSource,
      },
    });
    return computed.pdfValues as Record<string, unknown>;
  }

  return estimateObject;
}
