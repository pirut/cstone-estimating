import { createHmac, createHash, randomBytes, timingSafeEqual } from "crypto";
import type { ProposalSignerRecipient } from "@/lib/types";

const DEFAULT_PROPOSAL_SIGN_LINK_TTL_HOURS = 168;

function coerceString(value: unknown) {
  return String(value ?? "").trim();
}

export function normalizeProposalSignerRecipient(
  value: unknown
): ProposalSignerRecipient | null {
  if (!value || typeof value !== "object") return null;
  const recipient = value as Record<string, unknown>;
  const mode = coerceString(recipient.mode).toLowerCase() === "external"
    ? "external"
    : "internal";
  return {
    mode,
    email: coerceString(recipient.email) || undefined,
    firstName: coerceString(recipient.firstName) || undefined,
    lastName: coerceString(recipient.lastName) || undefined,
    role: coerceString(recipient.role) || undefined,
  };
}

export function generateProposalAccessToken() {
  return randomBytes(24).toString("base64url");
}

export function hashProposalAccessToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function getProposalInviteTtlHours() {
  const parsed = Number(process.env.PROPOSAL_SIGN_LINK_TTL_HOURS);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_PROPOSAL_SIGN_LINK_TTL_HOURS;
  }
  return Math.trunc(parsed);
}

export function getProposalInviteExpiry(now = Date.now()) {
  return now + getProposalInviteTtlHours() * 60 * 60 * 1000;
}

export function buildProposalSignUrl(token: string, origin?: string) {
  const baseUrl = coerceString(origin) || coerceString(process.env.APP_BASE_URL);
  if (!baseUrl) {
    throw new Error("Missing APP_BASE_URL for proposal signing links.");
  }
  return `${baseUrl.replace(/\/+$/, "")}/proposal/sign/${encodeURIComponent(token)}`;
}

export function buildPandaDocWebhookSignature(payload: string, sharedKey: string) {
  return createHmac("sha256", sharedKey).update(payload).digest("hex");
}

export function verifyPandaDocWebhookSignature(payload: string, signature: string) {
  const sharedKey = coerceString(process.env.PANDADOC_WEBHOOK_SHARED_KEY);
  if (!sharedKey) {
    throw new Error("Missing PandaDoc webhook configuration: PANDADOC_WEBHOOK_SHARED_KEY.");
  }
  const expected = buildPandaDocWebhookSignature(payload, sharedKey);
  const receivedBuffer = Buffer.from(signature, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  if (receivedBuffer.length !== expectedBuffer.length) {
    return false;
  }
  return timingSafeEqual(receivedBuffer, expectedBuffer);
}
