import { fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { hashProposalAccessToken } from "@/lib/server/proposal-signing";

function coerceString(value: unknown) {
  return String(value ?? "").trim();
}

export async function getProposalInviteEnvelopeByToken(token: string) {
  const normalizedToken = coerceString(token);
  if (!normalizedToken) return null;
  return await fetchQuery(api.app.proposalInviteByTokenHash, {
    tokenHash: hashProposalAccessToken(normalizedToken),
  });
}

export function getProposalInviteComputedState(envelope: any) {
  const invite = envelope?.invite;
  const estimate = envelope?.estimate;
  const expiresAt =
    typeof invite?.expiresAt === "number" && Number.isFinite(invite.expiresAt)
      ? invite.expiresAt
      : 0;
  const expired = expiresAt > 0 && expiresAt <= Date.now();
  const inviteStatus = coerceString(invite?.status).toLowerCase();
  const invalid =
    !invite ||
    expired ||
    inviteStatus === "superseded" ||
    inviteStatus === "revoked";
  const completed =
    inviteStatus === "completed" ||
    coerceString(estimate?.pandadocState?.status).toLowerCase() ===
      "document.completed";

  return {
    expired,
    invalid,
    completed,
  };
}
