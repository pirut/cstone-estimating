import type {
  PandaDocBindingTargetType,
  PandaDocTemplateBinding,
} from "@/lib/types";

export type PandaDocRecipientInput = {
  email?: string;
  firstName?: string;
  lastName?: string;
  role?: string;
};

export function toBoolean(value: unknown, fallback: boolean) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "on"].includes(normalized)) return true;
    if (["0", "false", "no", "off"].includes(normalized)) return false;
  }
  return fallback;
}

export function toPositiveInteger(value: unknown, fallback: number) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const rounded = Math.trunc(parsed);
  return rounded > 0 ? rounded : fallback;
}

export function normalizePandaDocRecipient(
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

function normalizePandaDocTargetType(value: unknown): PandaDocBindingTargetType {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "field" ? "field" : "token";
}

export function normalizePandaDocBindings(
  value: unknown,
  options?: {
    dedupe?: boolean;
  }
): PandaDocTemplateBinding[] {
  if (!Array.isArray(value)) return [];
  const dedupe = options?.dedupe === true;
  const normalized: PandaDocTemplateBinding[] = [];
  const seen = dedupe ? new Set<string>() : null;

  value.forEach((entry, index) => {
    if (!entry || typeof entry !== "object") return;
    const binding = entry as Record<string, unknown>;
    const sourceKey = String(binding.sourceKey ?? "").trim();
    const targetName = String(binding.targetName ?? "").trim();
    if (!sourceKey || !targetName) return;

    const targetType = normalizePandaDocTargetType(binding.targetType);
    const role = String(binding.role ?? "").trim() || undefined;
    const targetFieldType =
      String(binding.targetFieldType ?? "").trim() || undefined;

    if (seen) {
      const dedupeKey = `${sourceKey}|${targetType}|${targetName}|${role ?? ""}`;
      if (seen.has(dedupeKey)) return;
      seen.add(dedupeKey);
    }

    normalized.push({
      id:
        String(binding.id ?? `binding-${index + 1}`).trim() ||
        `binding-${index + 1}`,
      sourceKey,
      targetType,
      targetName,
      targetFieldType,
      role,
    });
  });

  return normalized;
}
