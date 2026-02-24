import { NextRequest, NextResponse } from "next/server";
import mappingDefault from "@/config/mapping.json";
import { downloadJson } from "@/lib/server/download";
import {
  buildPandaDocDraft,
  createPandaDocDocument,
  getPandaDocMissingEnvVars,
  updatePandaDocDocument,
} from "@/lib/server/pandadoc";
import { buildBusinessCentralSyncPreview } from "@/lib/server/business-central-sync";
import {
  buildFieldValuesFromSourceValues,
  extractEstimateValues,
} from "@/lib/server/estimate-values";
import {
  normalizePandaDocBindings,
  normalizePandaDocRecipient,
  toBoolean,
  toPositiveInteger,
} from "@/lib/server/pandadoc-input";

export const runtime = "nodejs";
export const maxDuration = 60;

const DOWNLOAD_TIMEOUT_MS = 20_000;
const DEFAULT_SEND_DOCUMENT = true;
const DEFAULT_CREATE_SESSION = true;
const DEFAULT_SESSION_LIFETIME_SECONDS = 900;
const DEFAULT_ALLOW_CREATE_FALLBACK = true;

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
