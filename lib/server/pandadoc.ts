import type { PandaDocTemplateBinding } from "@/lib/types";

const REQUIRED_PANDADOC_ENV_VARS = ["PANDADOC_API_KEY"] as const;
const DEFAULT_RECIPIENT_ROLE = "Client";
const DEFAULT_API_BASE_URL = "https://api.pandadoc.com/public/v1";
const DEFAULT_APP_BASE_URL = "https://app.pandadoc.com";
const DEFAULT_READY_TIMEOUT_MS = 45_000;
const DEFAULT_READY_POLL_INTERVAL_MS = 1_200;
const UPLOADED_STATUS = "document.uploaded";
const ERROR_STATUS = "document.error";

export type PandaDocRecipientInput = {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
};

export type PandaDocDraft = {
  name: string;
  templateUuid: string;
  recipients: Array<{
    email: string;
    first_name: string;
    last_name: string;
    role: string;
  }>;
  tokens: Array<{
    name: string;
    value: string;
  }>;
  fields: Record<
    string,
    {
      value: string | number | boolean;
      role?: string;
    }
  >;
  metadata: {
    source: string;
    preparedAt: string;
  };
};

type BuildPandaDocDraftOptions = {
  fieldValues: Record<string, string>;
  templateUuid?: string;
  documentName?: string;
  recipient?: PandaDocRecipientInput;
  recipientRole?: string;
  bindings?: PandaDocTemplateBinding[];
};

export type PandaDocSendOptions = {
  subject?: string;
  message?: string;
  silent?: boolean;
};

export type CreatePandaDocDocumentOptions = {
  draft: PandaDocDraft;
  sendDocument: boolean;
  createSession: boolean;
  sessionLifetimeSeconds: number;
  recipientEmail?: string;
  sendOptions?: PandaDocSendOptions;
};

export type PandaDocCreateResult = {
  document: {
    id: string;
    name: string;
    status: string;
    appUrl: string;
    apiUrl: string;
    sharedLink?: string;
  };
  recipient?: {
    email: string;
    firstName?: string;
    lastName?: string;
    role?: string;
  };
  sendResult?: {
    status: string;
  };
  session?: {
    id: string;
    url: string;
    expiresAt?: string;
  };
};

type PandaDocErrorShape = {
  type?: string;
  code?: string;
  detail?: unknown;
  details?: unknown;
  info_message?: string;
};

type PandaDocCreateResponse = {
  id?: string;
  name?: string;
  status?: string;
};

type PandaDocStatusResponse = {
  id?: string;
  name?: string;
  status?: string;
};

type PandaDocSendResponse = {
  status?: string;
};

type PandaDocSessionResponse = {
  id?: string;
  expires_at?: string;
};

type PandaDocRecipientDetails = {
  type?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  role?: string;
  shared_link?: string;
};

type PandaDocDetailsResponse = {
  recipients?: PandaDocRecipientDetails[];
};

type PandaDocTemplateListResponse = {
  results?: Array<{
    id?: string;
    name?: string;
    date_modified?: string;
    date_created?: string;
    version?: string;
  }>;
};

type PandaDocTemplateDetailsResponse = {
  id?: string;
  name?: string;
  tokens?: Array<{ name?: string; value?: string }>;
  fields?: Array<{
    field_id?: string;
    name?: string;
    merge_field?: string;
    type?: string;
  }>;
  roles?: Array<{ id?: string; name?: string; signing_order?: string | null }>;
};

export type PandaDocTemplateListItem = {
  id: string;
  name: string;
  dateModified?: string;
  dateCreated?: string;
  version?: string;
};

export type PandaDocTemplateDetails = {
  id: string;
  name: string;
  roles: Array<{ id: string; name: string; signingOrder?: string }>;
  tokens: Array<{ name: string }>;
  fields: Array<{ name: string; mergeField?: string; type?: string }>;
};

function coerceString(value: unknown) {
  return String(value ?? "").trim();
}

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

function inferDocumentName(fieldValues: Record<string, string>) {
  const preparedFor = coerceString(fieldValues.prepared_for);
  const projectName = coerceString(fieldValues.project_name);

  if (projectName && preparedFor) {
    return `${projectName} - ${preparedFor}`;
  }

  if (projectName) {
    return projectName;
  }

  if (preparedFor) {
    return `Cornerstone Proposal - ${preparedFor}`;
  }

  return "Cornerstone Proposal";
}

function inferRecipientName(fieldValues: Record<string, string>) {
  const preparedFor = coerceString(fieldValues.prepared_for);
  if (!preparedFor) return { firstName: "Client", lastName: "" };
  const segments = preparedFor.split(/\s+/).filter(Boolean);
  if (!segments.length) return { firstName: "Client", lastName: "" };
  if (segments.length === 1) return { firstName: segments[0], lastName: "" };
  return {
    firstName: segments[0],
    lastName: segments.slice(1).join(" "),
  };
}

function buildTokens(fieldValues: Record<string, string>) {
  return Object.entries(fieldValues)
    .map(([name, value]) => ({
      name: coerceString(name),
      value: coerceString(value),
    }))
    .filter((token) => token.name.length > 0);
}

function valueForBinding(
  fieldValues: Record<string, string>,
  binding: PandaDocTemplateBinding
) {
  const raw = coerceString(fieldValues[binding.sourceKey]);
  const type = coerceString(binding.targetFieldType).toLowerCase();
  if (!raw) return raw;
  if (type === "checkbox") {
    const normalized = raw.toLowerCase();
    return ["true", "yes", "1", "y", "checked"].includes(normalized);
  }
  if (type === "number") {
    const parsed = Number(raw.replace(/[$,]/g, "").trim());
    return Number.isFinite(parsed) ? parsed : raw;
  }
  return raw;
}

function buildTokensFromBindings(
  fieldValues: Record<string, string>,
  bindings: PandaDocTemplateBinding[]
) {
  return bindings
    .filter((binding) => binding.targetType === "token")
    .map((binding) => ({
      name: coerceString(binding.targetName),
      value: coerceString(fieldValues[binding.sourceKey]),
    }))
    .filter((token) => token.name.length > 0);
}

function buildFieldsFromBindings(
  fieldValues: Record<string, string>,
  bindings: PandaDocTemplateBinding[]
) {
  const fields: Record<
    string,
    {
      value: string | number | boolean;
      role?: string;
    }
  > = {};
  bindings
    .filter((binding) => binding.targetType === "field")
    .forEach((binding) => {
      const fieldName = coerceString(binding.targetName);
      if (!fieldName) return;
      fields[fieldName] = {
        value: valueForBinding(fieldValues, binding),
        role: coerceString(binding.role) || undefined,
      };
    });
  return fields;
}

function getApiKey() {
  return coerceString(process.env.PANDADOC_API_KEY);
}

function getApiBaseUrl() {
  return (
    coerceString(process.env.PANDADOC_API_BASE_URL) || DEFAULT_API_BASE_URL
  ).replace(/\/+$/, "");
}

function getAppBaseUrl() {
  return (
    coerceString(process.env.PANDADOC_APP_BASE_URL) || DEFAULT_APP_BASE_URL
  ).replace(/\/+$/, "");
}

function buildDocumentAppUrl(documentId: string) {
  return `${getAppBaseUrl()}/a/#/documents/${documentId}`;
}

function buildSessionUrl(sessionId: string) {
  return `${getAppBaseUrl()}/s/${sessionId}`;
}

async function parseJsonSafe(response: Response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function formatPandaDocError(status: number, payload: unknown, fallback: string) {
  if (typeof payload === "string" && payload.trim()) {
    return `${fallback} (${status}): ${payload.trim()}`;
  }

  if (!payload || typeof payload !== "object") {
    return `${fallback} (${status}).`;
  }

  const errorPayload = payload as PandaDocErrorShape;
  const details =
    typeof errorPayload.detail === "string"
      ? errorPayload.detail
      : typeof errorPayload.details === "string"
        ? errorPayload.details
        : errorPayload.info_message;

  if (details && details.trim()) {
    return `${fallback} (${status}): ${details.trim()}`;
  }

  if (errorPayload.detail && typeof errorPayload.detail === "object") {
    const flattened = Object.entries(
      errorPayload.detail as Record<string, unknown>
    )
      .map(([key, value]) => {
        if (Array.isArray(value)) {
          return `${key}: ${value.map((entry) => String(entry)).join(", ")}`;
        }
        return `${key}: ${String(value)}`;
      })
      .join("; ");

    if (flattened) {
      return `${fallback} (${status}): ${flattened}`;
    }
  }

  return `${fallback} (${status}).`;
}

async function pandadocRequest<T>(
  path: string,
  init: {
    method: "GET" | "POST";
    body?: unknown;
    expectedStatus?: number | number[];
  }
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) {
    throw new Error("Missing PandaDoc configuration: PANDADOC_API_KEY.");
  }

  const url = `${getApiBaseUrl()}${path}`;
  const expectedStatus = Array.isArray(init.expectedStatus)
    ? init.expectedStatus
    : [init.expectedStatus ?? 200];

  const response = await fetch(url, {
    method: init.method,
    headers: {
      Authorization: `API-Key ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
    cache: "no-store",
  });

  const payload = await parseJsonSafe(response);

  if (!expectedStatus.includes(response.status)) {
    const message = formatPandaDocError(
      response.status,
      payload,
      "PandaDoc API request failed"
    );
    throw new Error(message);
  }

  return (payload ?? {}) as T;
}

async function waitForDocumentReady(documentId: string) {
  const timeoutMs = toPositiveInteger(
    process.env.PANDADOC_READY_TIMEOUT_MS,
    DEFAULT_READY_TIMEOUT_MS
  );
  const pollIntervalMs = toPositiveInteger(
    process.env.PANDADOC_READY_POLL_INTERVAL_MS,
    DEFAULT_READY_POLL_INTERVAL_MS
  );
  const startedAt = Date.now();
  let lastStatus = "unknown";

  while (Date.now() - startedAt < timeoutMs) {
    const statusResponse = await pandadocRequest<PandaDocStatusResponse>(
      `/documents/${documentId}`,
      {
        method: "GET",
        expectedStatus: 200,
      }
    );

    lastStatus = coerceString(statusResponse.status) || "unknown";

    if (!lastStatus || lastStatus === UPLOADED_STATUS) {
      await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
      continue;
    }

    if (lastStatus === ERROR_STATUS) {
      throw new Error(
        "PandaDoc reported document.error while building the document."
      );
    }

    return statusResponse;
  }

  throw new Error(
    `PandaDoc document was not ready before timeout. Last status: ${lastStatus}.`
  );
}

function extractRecipientByEmail(
  recipients: PandaDocRecipientDetails[] | undefined,
  recipientEmail: string | undefined
) {
  if (!recipients?.length) return null;
  const normalizedEmail = coerceString(recipientEmail).toLowerCase();
  if (!normalizedEmail) {
    return recipients.find((recipient) => recipient.type === "recipient") ?? recipients[0];
  }

  return (
    recipients.find(
      (recipient) => coerceString(recipient.email).toLowerCase() === normalizedEmail
    ) ?? recipients.find((recipient) => recipient.type === "recipient") ?? recipients[0]
  );
}

export function getPandaDocMissingEnvVars(): string[] {
  return REQUIRED_PANDADOC_ENV_VARS.filter(
    (envVar) => !coerceString(process.env[envVar])
  );
}

export function buildPandaDocDraft(
  options: BuildPandaDocDraftOptions
): PandaDocDraft {
  const {
    fieldValues,
    templateUuid,
    documentName,
    recipient,
    recipientRole,
    bindings,
  } = options;

  const envTemplateUuid = coerceString(process.env.PANDADOC_TEMPLATE_UUID);
  const resolvedTemplateUuid = coerceString(templateUuid) || envTemplateUuid;

  const inferredName = inferDocumentName(fieldValues);
  const resolvedName = coerceString(documentName) || inferredName;

  const defaultRecipient = inferRecipientName(fieldValues);
  const resolvedRole =
    coerceString(recipientRole) ||
    coerceString(recipient?.role) ||
    coerceString(process.env.PANDADOC_RECIPIENT_ROLE) ||
    DEFAULT_RECIPIENT_ROLE;
  const resolvedEmail =
    coerceString(recipient?.email) ||
    coerceString(process.env.PANDADOC_RECIPIENT_EMAIL);
  const firstName =
    coerceString(recipient?.firstName) || defaultRecipient.firstName;
  const lastName = coerceString(recipient?.lastName) || defaultRecipient.lastName;
  const validBindings = Array.isArray(bindings)
    ? bindings.filter(
        (binding) =>
          binding &&
          typeof binding === "object" &&
          coerceString(binding.sourceKey) &&
          coerceString(binding.targetName)
      )
    : [];
  const mappedTokens = validBindings.length
    ? buildTokensFromBindings(fieldValues, validBindings)
    : buildTokens(fieldValues);
  const mappedFields = validBindings.length
    ? buildFieldsFromBindings(fieldValues, validBindings)
    : {};

  return {
    name: resolvedName,
    templateUuid: resolvedTemplateUuid,
    recipients: resolvedEmail
      ? [
          {
            email: resolvedEmail,
            first_name: firstName,
            last_name: lastName,
            role: resolvedRole,
          },
        ]
      : [],
    tokens: mappedTokens,
    fields: mappedFields,
    metadata: {
      source: "cstone-estimating",
      preparedAt: new Date().toISOString(),
    },
  };
}

export async function createPandaDocDocument(
  options: CreatePandaDocDocumentOptions
): Promise<PandaDocCreateResult> {
  const {
    draft,
    sendDocument,
    createSession,
    sessionLifetimeSeconds,
    recipientEmail,
    sendOptions,
  } = options;

  const createResponse = await pandadocRequest<PandaDocCreateResponse>(
    "/documents",
    {
      method: "POST",
      expectedStatus: [201, 202],
      body: {
        name: draft.name,
        template_uuid: draft.templateUuid,
        recipients: draft.recipients,
        tokens: draft.tokens,
        fields: draft.fields,
        metadata: draft.metadata,
      },
    }
  );

  const documentId = coerceString(createResponse.id);
  if (!documentId) {
    throw new Error("PandaDoc create response did not return a document id.");
  }

  const statusResponse = await waitForDocumentReady(documentId);
  const documentStatus = coerceString(statusResponse.status) || UPLOADED_STATUS;

  let sendResult: PandaDocCreateResult["sendResult"];
  if (sendDocument) {
    const sendPayload: Record<string, unknown> = {};
    if (coerceString(sendOptions?.subject)) {
      sendPayload.subject = coerceString(sendOptions?.subject);
    }
    if (coerceString(sendOptions?.message)) {
      sendPayload.message = coerceString(sendOptions?.message);
    }
    sendPayload.silent = toBoolean(sendOptions?.silent, false);

    const sendResponse = await pandadocRequest<PandaDocSendResponse>(
      `/documents/${documentId}/send`,
      {
        method: "POST",
        expectedStatus: 200,
        body: sendPayload,
      }
    );
    sendResult = {
      status: coerceString(sendResponse.status) || "document.sent",
    };
  }

  let sessionResult: PandaDocCreateResult["session"];
  if (createSession && coerceString(recipientEmail)) {
    const sessionResponse = await pandadocRequest<PandaDocSessionResponse>(
      `/documents/${documentId}/session`,
      {
        method: "POST",
        expectedStatus: 201,
        body: {
          recipient: recipientEmail,
          lifetime: toPositiveInteger(sessionLifetimeSeconds, 900),
        },
      }
    );
    const sessionId = coerceString(sessionResponse.id);
    if (sessionId) {
      sessionResult = {
        id: sessionId,
        url: buildSessionUrl(sessionId),
        expiresAt: coerceString(sessionResponse.expires_at) || undefined,
      };
    }
  }

  const detailsResponse = await pandadocRequest<PandaDocDetailsResponse>(
    `/documents/${documentId}/details`,
    {
      method: "GET",
      expectedStatus: 200,
    }
  );
  const matchedRecipient = extractRecipientByEmail(
    detailsResponse.recipients,
    recipientEmail
  );

  return {
    document: {
      id: documentId,
      name: coerceString(createResponse.name) || draft.name,
      status: sendResult?.status || documentStatus,
      appUrl: buildDocumentAppUrl(documentId),
      apiUrl: `${getApiBaseUrl()}/documents/${documentId}`,
      sharedLink: coerceString(matchedRecipient?.shared_link) || undefined,
    },
    recipient:
      matchedRecipient && coerceString(matchedRecipient.email)
        ? {
            email: coerceString(matchedRecipient.email),
            firstName: coerceString(matchedRecipient.first_name) || undefined,
            lastName: coerceString(matchedRecipient.last_name) || undefined,
            role: coerceString(matchedRecipient.role) || undefined,
          }
        : undefined,
    sendResult,
    session: sessionResult,
  };
}

export async function listPandaDocTemplates(query?: string, count = 50) {
  const normalizedCount = Math.max(1, Math.min(100, Math.trunc(count)));
  const searchParams = new URLSearchParams();
  searchParams.set("count", String(normalizedCount));
  if (coerceString(query)) {
    searchParams.set("q", coerceString(query));
  }

  const response = await pandadocRequest<PandaDocTemplateListResponse>(
    `/templates?${searchParams.toString()}`,
    {
      method: "GET",
      expectedStatus: 200,
    }
  );

  const templates: PandaDocTemplateListItem[] = (response.results ?? []).map(
    (item) => ({
      id: coerceString(item.id),
      name: coerceString(item.name),
      dateModified: coerceString(item.date_modified) || undefined,
      dateCreated: coerceString(item.date_created) || undefined,
      version: coerceString(item.version) || undefined,
    })
  );

  return templates.filter((item) => Boolean(item.id && item.name));
}

export async function getPandaDocTemplateDetails(
  templateId: string
): Promise<PandaDocTemplateDetails> {
  const id = coerceString(templateId);
  if (!id) {
    throw new Error("PandaDoc template id is required.");
  }

  const response = await pandadocRequest<PandaDocTemplateDetailsResponse>(
    `/templates/${encodeURIComponent(id)}/details`,
    {
      method: "GET",
      expectedStatus: 200,
    }
  );

  return {
    id,
    name: coerceString(response.name) || id,
    roles: (response.roles ?? [])
      .map((role) => ({
        id: coerceString(role.id),
        name: coerceString(role.name),
        signingOrder: coerceString(role.signing_order) || undefined,
      }))
      .filter((role) => Boolean(role.id && role.name)),
    tokens: (response.tokens ?? [])
      .map((token) => ({ name: coerceString(token.name) }))
      .filter((token) => Boolean(token.name)),
    fields: (response.fields ?? [])
      .map((field) => ({
        name: coerceString(field.merge_field) || coerceString(field.name),
        mergeField: coerceString(field.merge_field) || undefined,
        type: coerceString(field.type) || undefined,
      }))
      .filter((field) => Boolean(field.name)),
  };
}
