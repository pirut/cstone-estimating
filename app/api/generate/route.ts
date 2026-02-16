import { NextRequest, NextResponse } from "next/server";
import * as XLSX from "xlsx";
import mappingDefault from "@/config/mapping.json";
import { downloadBuffer, downloadJson } from "@/lib/server/download";
import {
  buildPandaDocDraft,
  createPandaDocDocument,
  getPandaDocMissingEnvVars,
  type PandaDocRecipientInput,
} from "@/lib/server/pandadoc";
import { buildBusinessCentralSyncPreview } from "@/lib/server/business-central-sync";
import { formatValue } from "@/lib/formatting";
import { computeEstimate, DEFAULT_DRAFT } from "@/lib/estimate-calculator";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOWNLOAD_TIMEOUT_MS = 20_000;
const DEFAULT_SEND_DOCUMENT = true;
const DEFAULT_CREATE_SESSION = true;
const DEFAULT_SESSION_LIFETIME_SECONDS = 900;

function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

function toPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : fallback;
}

function normalizePandaDocRecipient(
  value: unknown
): PandaDocRecipientInput | undefined {
  if (!value || typeof value !== "object") return undefined;
  const recipient = value as Record<string, unknown>;
  return {
    email: String(recipient.email ?? "").trim() || undefined,
    firstName: String(recipient.firstName ?? "").trim() || undefined,
    lastName: String(recipient.lastName ?? "").trim() || undefined,
    role: String(recipient.role ?? "").trim() || undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const workbookUrl = String(body.workbookUrl || "").trim();
    const mappingUrl = String(body.mappingUrl || "").trim();
    const estimateUrl = String(body.estimateUrl || "").trim();

    const estimatePayload =
      body.estimate && typeof body.estimate === "object" ? body.estimate : null;

    const mappingOverride =
      body.mappingOverride && typeof body.mappingOverride === "object"
        ? body.mappingOverride
        : null;

    const pandadocConfig =
      body.pandadoc && typeof body.pandadoc === "object"
        ? (body.pandadoc as Record<string, unknown>)
        : null;

    const pandadocTemplateUuid = String(
      pandadocConfig?.templateUuid ?? ""
    ).trim();
    const pandadocDocumentName = String(
      pandadocConfig?.documentName ?? ""
    ).trim();
    const pandadocRecipient = normalizePandaDocRecipient(
      pandadocConfig?.recipient
    );
    const sendDocument = toBoolean(
      pandadocConfig?.send,
      DEFAULT_SEND_DOCUMENT
    );
    const createSession = toBoolean(
      pandadocConfig?.createSession,
      DEFAULT_CREATE_SESSION
    );
    const sessionLifetimeSeconds = toPositiveInteger(
      pandadocConfig?.sessionLifetimeSeconds ??
        process.env.PANDADOC_SESSION_LIFETIME_SECONDS,
      DEFAULT_SESSION_LIFETIME_SECONDS
    );
    const sendMessage = String(pandadocConfig?.message ?? "").trim() || undefined;
    const sendSubject = String(pandadocConfig?.subject ?? "").trim() || undefined;
    const sendSilent = toBoolean(pandadocConfig?.silent, false);

    if (!workbookUrl && !estimateUrl && !estimatePayload) {
      return NextResponse.json(
        { error: "Provide either workbookUrl or estimate data." },
        { status: 400 }
      );
    }

    const mappingConfig = mappingOverride
      ? mappingOverride
      : mappingUrl
        ? await downloadJson(mappingUrl, "Mapping JSON", {
            baseUrl: request.nextUrl.origin,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          })
        : mappingDefault;

    let fieldValues: Record<string, string> = {};
    if (estimatePayload || estimateUrl) {
      const estimateData = estimatePayload
        ? estimatePayload
        : await downloadJson(estimateUrl, "Estimate JSON", {
            baseUrl: request.nextUrl.origin,
            timeoutMs: DOWNLOAD_TIMEOUT_MS,
          });
      const sourceValues = extractEstimateValues(estimateData);
      fieldValues = buildFieldValuesFromSourceValues(sourceValues, mappingConfig);
    } else {
      const workbookBuffer = await downloadBuffer(workbookUrl, "Workbook", {
        baseUrl: request.nextUrl.origin,
        timeoutMs: DOWNLOAD_TIMEOUT_MS,
      });
      fieldValues = buildFieldValues(workbookBuffer, mappingConfig);
    }

    const draftPayload = buildPandaDocDraft({
      fieldValues,
      templateUuid: pandadocTemplateUuid,
      documentName: pandadocDocumentName,
      recipient: pandadocRecipient,
    });

    const missingConfig = [...getPandaDocMissingEnvVars()];
    if (!draftPayload.templateUuid) {
      missingConfig.push("PANDADOC_TEMPLATE_UUID");
    }
    if (!draftPayload.recipients.length) {
      missingConfig.push("PANDADOC_RECIPIENT_EMAIL or pandadoc.recipient.email");
    }

    if (missingConfig.length > 0) {
      return NextResponse.json(
        {
          error: `PandaDoc configuration is incomplete: ${Array.from(
            new Set(missingConfig)
          ).join(", ")}.`,
          provider: "pandadoc",
          status: "missing_config",
          pandadocDraft: draftPayload,
        },
        { status: 400 }
      );
    }

    const recipientEmail = draftPayload.recipients[0]?.email;
    const generation = await createPandaDocDocument({
      draft: draftPayload,
      sendDocument,
      createSession: createSession && Boolean(recipientEmail),
      sessionLifetimeSeconds,
      recipientEmail,
      sendOptions: {
        message: sendMessage,
        subject: sendSubject,
        silent: sendSilent,
      },
    });

    const businessCentralSync = buildBusinessCentralSyncPreview({
      documentId: generation.document.id,
      fieldValues,
    });

    return NextResponse.json(
      {
        provider: "pandadoc",
        status: "created",
        document: generation.document,
        recipient: generation.recipient,
        sendResult: generation.sendResult,
        session: generation.session,
        businessCentralSync,
        fieldCount: Object.keys(fieldValues).length,
      },
      { status: 200 }
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

function buildFieldValues(workbookBuffer: Buffer, mappingConfig: any) {
  const workbook = XLSX.read(workbookBuffer, {
    type: "buffer",
    cellDates: true,
  });

  const missingValue = mappingConfig.missing_value ?? "";
  const preparedByMap = mappingConfig.prepared_by_map ?? {};
  const fieldSpecs = (mappingConfig.fields ?? {}) as Record<
    string,
    { sheet?: string; cell?: string; format?: string }
  >;

  const values: Record<string, string> = {};

  for (const [fieldName, spec] of Object.entries(fieldSpecs)) {
    const sheetName = String(spec.sheet || "");
    const cell = String(spec.cell || "");
    const format = String(spec.format || "text");
    const raw = getCellValue(workbook, sheetName, cell);
    values[fieldName] = formatValue(raw, format, preparedByMap, missingValue);
  }

  const planSetDate = values.plan_set_date;
  values.plan_set_date_line =
    planSetDate && planSetDate !== missingValue ? planSetDate : missingValue;

  return values;
}

function buildFieldValuesFromSourceValues(
  sourceValues: Record<string, unknown>,
  mappingConfig: any
) {
  const missingValue = mappingConfig.missing_value ?? "";
  const preparedByMap = mappingConfig.prepared_by_map ?? {};
  const fieldSpecs = (mappingConfig.fields ?? {}) as Record<
    string,
    { sheet?: string; cell?: string; format?: string }
  >;

  const values: Record<string, string> = {};

  for (const [fieldName, spec] of Object.entries(fieldSpecs)) {
    const format = String(spec.format || "text");
    const raw = sourceValues[fieldName];
    values[fieldName] = formatValue(raw, format, preparedByMap, missingValue);
  }

  const planSetDate = values.plan_set_date;
  values.plan_set_date_line =
    planSetDate && planSetDate !== missingValue ? planSetDate : missingValue;

  return values;
}

function extractEstimateValues(estimateData: any) {
  if (!estimateData || typeof estimateData !== "object") return {};
  if (estimateData.values && typeof estimateData.values === "object") {
    return estimateData.values as Record<string, unknown>;
  }

  if (
    estimateData.info ||
    estimateData.products ||
    estimateData.bucking ||
    estimateData.calculator
  ) {
    const computed = computeEstimate({
      info: estimateData.info ?? {},
      products:
        Array.isArray(estimateData.products) && estimateData.products.length
          ? estimateData.products
          : DEFAULT_DRAFT.products,
      bucking:
        Array.isArray(estimateData.bucking) && estimateData.bucking.length
          ? estimateData.bucking
          : DEFAULT_DRAFT.bucking,
      calculator: {
        ...DEFAULT_DRAFT.calculator,
        ...(estimateData.calculator ?? {}),
      },
    });
    return computed.pdfValues as Record<string, unknown>;
  }

  return estimateData as Record<string, unknown>;
}

function getCellValue(
  workbook: XLSX.WorkBook,
  sheetName: string,
  cell: string
) {
  if (!sheetName || !cell) return null;
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return null;
  const cellData = sheet[cell];
  if (!cellData) return null;
  return cellData.v ?? null;
}
