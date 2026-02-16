const REQUIRED_PANDADOC_ENV_VARS = ["PANDADOC_API_KEY"] as const;
const DEFAULT_RECIPIENT_ROLE = "Client";

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
};

function coerceString(value: unknown) {
  return String(value ?? "").trim();
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

export function getPandaDocMissingEnvVars(): string[] {
  return REQUIRED_PANDADOC_ENV_VARS.filter((envVar) => !coerceString(process.env[envVar]));
}

export function buildPandaDocDraft(
  options: BuildPandaDocDraftOptions
): PandaDocDraft {
  const {
    fieldValues,
    templateUuid,
    documentName,
    recipient,
  } = options;

  const envTemplateUuid = coerceString(process.env.PANDADOC_TEMPLATE_UUID);
  const resolvedTemplateUuid = coerceString(templateUuid) || envTemplateUuid;

  const inferredName = inferDocumentName(fieldValues);
  const resolvedName = coerceString(documentName) || inferredName;

  const defaultRecipient = inferRecipientName(fieldValues);
  const resolvedRole =
    coerceString(recipient?.role) ||
    coerceString(process.env.PANDADOC_RECIPIENT_ROLE) ||
    DEFAULT_RECIPIENT_ROLE;
  const resolvedEmail =
    coerceString(recipient?.email) ||
    coerceString(process.env.PANDADOC_RECIPIENT_EMAIL);
  const firstName =
    coerceString(recipient?.firstName) || defaultRecipient.firstName;
  const lastName =
    coerceString(recipient?.lastName) || defaultRecipient.lastName;

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
    tokens: buildTokens(fieldValues),
    metadata: {
      source: "cstone-estimating",
      preparedAt: new Date().toISOString(),
    },
  };
}
