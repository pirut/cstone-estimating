import { NextRequest, NextResponse } from "next/server";
import mappingDefault from "@/config/mapping.json";
import { downloadJson } from "@/lib/server/download";
import {
  buildPandaDocDraft,
  createPandaDocDocument,
  getPandaDocMissingEnvVars,
  updatePandaDocDocument,
  type PandaDocRecipientInput,
} from "@/lib/server/pandadoc";
import { buildBusinessCentralSyncPreview } from "@/lib/server/business-central-sync";
import { formatValue } from "@/lib/formatting";
import { computeEstimate, DEFAULT_DRAFT } from "@/lib/estimate-calculator";
import type { PandaDocTemplateBinding } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOWNLOAD_TIMEOUT_MS = 20_000;
const DEFAULT_SEND_DOCUMENT = true;
const DEFAULT_CREATE_SESSION = true;
const DEFAULT_SESSION_LIFETIME_SECONDS = 900;
const DEFAULT_ALLOW_CREATE_FALLBACK = true;

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

function normalizePandaDocBindings(value: unknown): PandaDocTemplateBinding[] {
  if (!Array.isArray(value)) return [];
  const normalized: PandaDocTemplateBinding[] = [];
  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const binding = entry as Record<string, unknown>;
    const sourceKey = String(binding.sourceKey ?? "").trim();
    const targetName = String(binding.targetName ?? "").trim();
    if (!sourceKey || !targetName) return;
    normalized.push({
      id: String(binding.id ?? `binding-${index + 1}`).trim() || `binding-${index + 1}`,
      sourceKey,
      targetType:
        String(binding.targetType ?? "").trim().toLowerCase() === "field"
          ? "field"
          : "token",
      targetName,
      targetFieldType: String(binding.targetFieldType ?? "").trim() || undefined,
      role: String(binding.role ?? "").trim() || undefined,
    });
  });
  return normalized;
}

function isRecoverablePandaDocUpdateError(message: string) {
  const normalized = message.toLowerCase();
  return (
    normalized.includes("not editable") ||
    normalized.includes("expected document.draft") ||
    normalized.includes("removed") ||
    normalized.includes("(403)") ||
    normalized.includes("permission to view this document") ||
    normalized.includes("permission_error") ||
    normalized.includes("(404)") ||
    normalized.includes("not found")
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
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
    const pandadocRecipientRole = String(
      pandadocConfig?.recipientRole ?? ""
    ).trim();
    const pandadocBindings = normalizePandaDocBindings(pandadocConfig?.bindings);
    const pandadocDocumentId = String(pandadocConfig?.documentId ?? "").trim();
    const allowCreateFallback = toBoolean(
      pandadocConfig?.allowCreateFallback,
      DEFAULT_ALLOW_CREATE_FALLBACK
    );
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

    if (!estimateUrl && !estimatePayload) {
      return NextResponse.json(
        { error: "Provide estimate data." },
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

    const estimateData = estimatePayload
      ? estimatePayload
      : await downloadJson(estimateUrl, "Estimate JSON", {
          baseUrl: request.nextUrl.origin,
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
        });
    const sourceValues = extractEstimateValues(estimateData);
    const fieldValues = buildFieldValuesFromSourceValues(
      sourceValues,
      mappingConfig
    );

    const updateDraftPayload = buildPandaDocDraft({
      fieldValues,
      templateUuid: pandadocTemplateUuid,
      documentName: pandadocDocumentName,
      recipient: pandadocRecipient,
      recipientRole: pandadocRecipientRole,
      bindings: pandadocBindings,
      useEnvRecipient: !pandadocDocumentId,
    });
    const createDraftPayload = buildPandaDocDraft({
      fieldValues,
      templateUuid: pandadocTemplateUuid,
      documentName: pandadocDocumentName,
      recipient: pandadocRecipient,
      recipientRole: pandadocRecipientRole,
      bindings: pandadocBindings,
      useEnvRecipient: true,
    });

    const missingConfig = [...getPandaDocMissingEnvVars()];
    const templateRequired = !pandadocDocumentId;
    if (templateRequired && !createDraftPayload.templateUuid) {
      missingConfig.push("PANDADOC_TEMPLATE_UUID");
    }
    const mayNeedCreate =
      !pandadocDocumentId ||
      (allowCreateFallback && Boolean(createDraftPayload.templateUuid));
    if (mayNeedCreate && !createDraftPayload.recipients.length) {
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
          pandadocDraft: pandadocDocumentId ? updateDraftPayload : createDraftPayload,
        },
        { status: 400 }
      );
    }

    const updateRecipientEmail = updateDraftPayload.recipients[0]?.email;
    const createRecipientEmail = createDraftPayload.recipients[0]?.email;
    const sendConfig = {
      message: sendMessage,
      subject: sendSubject,
      silent: sendSilent,
    };
    const generationUpdateCommon = {
      draft: updateDraftPayload,
      sendDocument,
      createSession: createSession && Boolean(updateRecipientEmail || createRecipientEmail),
      sessionLifetimeSeconds,
      recipientEmail: updateRecipientEmail || createRecipientEmail,
      sendOptions: sendConfig,
    };
    const generationCreateCommon = {
      draft: createDraftPayload,
      sendDocument,
      createSession: createSession && Boolean(createRecipientEmail),
      sessionLifetimeSeconds,
      recipientEmail: createRecipientEmail,
      sendOptions: sendConfig,
    };
    const canFallbackCreate =
      allowCreateFallback && Boolean(createDraftPayload.templateUuid);

    let generation: Awaited<ReturnType<typeof createPandaDocDocument>>;
    let operation: "created" | "updated" = "created";
    let revisedDocumentId: string | undefined;
    let fallbackFromDocumentId: string | undefined;

    if (pandadocDocumentId) {
      try {
        generation = await updatePandaDocDocument({
          ...generationUpdateCommon,
          documentId: pandadocDocumentId,
        });
        operation = "updated";
        revisedDocumentId = pandadocDocumentId;
      } catch (updateError) {
        const updateMessage =
          updateError instanceof Error ? updateError.message : "Unknown error.";
        if (!canFallbackCreate || !isRecoverablePandaDocUpdateError(updateMessage)) {
          throw updateError;
        }
        generation = await createPandaDocDocument(generationCreateCommon);
        operation = "created";
        fallbackFromDocumentId = pandadocDocumentId;
      }
    } else {
      generation = await createPandaDocDocument(generationCreateCommon);
      operation = "created";
    }

    const businessCentralSync = buildBusinessCentralSyncPreview({
      documentId: generation.document.id,
      fieldValues,
    });

    return NextResponse.json(
      {
        provider: "pandadoc",
        status: operation,
        operation,
        revisedDocumentId,
        fallbackFromDocumentId,
        revision: generation.revision,
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

  for (const [sourceKey, rawValue] of Object.entries(sourceValues)) {
    if (!sourceKey || sourceKey in values) continue;
    values[sourceKey] = formatValue(rawValue, "text", preparedByMap, missingValue);
  }

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
    estimateData.calculator ||
    estimateData.changeOrder
  ) {
    const changeOrderSource =
      estimateData.changeOrder && typeof estimateData.changeOrder === "object"
        ? estimateData.changeOrder
        : {};
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
      changeOrder: {
        ...DEFAULT_DRAFT.changeOrder,
        ...(changeOrderSource as Record<string, unknown>),
      },
    });
    return computed.pdfValues as Record<string, unknown>;
  }

  return estimateData as Record<string, unknown>;
}
