import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { fetchMutation, fetchQuery } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { normalizeEstimateVersionHistory } from "@/lib/estimate-versioning";
import { getEstimateSigningRecipient } from "@/lib/home-page-utils";
import { sendProposalSigningEmail } from "@/lib/server/proposal-email";
import {
  buildProposalSignUrl,
  generateProposalAccessToken,
  getProposalInviteExpiry,
  hashProposalAccessToken,
} from "@/lib/server/proposal-signing";

export const runtime = "nodejs";
export const maxDuration = 30;

function coerceString(value: unknown) {
  return String(value ?? "").trim();
}

function getLatestDocumentFromEstimate(estimate: any) {
  const directDocumentId = coerceString(estimate?.pandadocDocumentId);
  if (directDocumentId) {
    return {
      documentId: directDocumentId,
      recipientEmail: coerceString(estimate?.pandadocState?.recipientEmail) || undefined,
      recipientRole: coerceString(estimate?.pandadocState?.recipientRole) || undefined,
      status: coerceString(estimate?.pandadocState?.status) || undefined,
    };
  }
  const history = normalizeEstimateVersionHistory(estimate?.versionHistory);
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const pandadoc = history[index]?.pandadoc;
    const documentId = coerceString(pandadoc?.documentId);
    if (!documentId) continue;
    return {
      documentId,
      recipientEmail: coerceString(pandadoc?.recipientEmail) || undefined,
      recipientRole: coerceString(pandadoc?.recipientRole) || undefined,
      status: coerceString(pandadoc?.status) || undefined,
    };
  }
  return null;
}

export async function POST(
  request: NextRequest,
  context: { params: { estimateId: string } }
) {
  try {
    const { userId } = await auth();
    if (process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY && !userId) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const estimateId = coerceString(context.params?.estimateId);
    if (!estimateId) {
      return NextResponse.json({ error: "Estimate id is required." }, { status: 400 });
    }

    const body = (await request.json().catch(() => null)) as
      | { sendEmail?: boolean }
      | null;
    const sendEmail = body?.sendEmail === true;
    const estimate = await fetchQuery(api.app.estimateById, { estimateId });
    if (!estimate) {
      return NextResponse.json({ error: "Estimate not found." }, { status: 404 });
    }

    const linkedDocument = getLatestDocumentFromEstimate(estimate);
    if (!linkedDocument?.documentId) {
      return NextResponse.json(
        { error: "Generate PandaDoc before creating a signing link." },
        { status: 400 }
      );
    }

    const signingRecipient = getEstimateSigningRecipient(estimate.payload);
    if (!signingRecipient?.email) {
      return NextResponse.json(
        { error: "Set a signer before creating a signing link." },
        { status: 400 }
      );
    }

    if (sendEmail && signingRecipient.mode !== "external") {
      return NextResponse.json(
        { error: "Email delivery is only available for external recipients." },
        { status: 400 }
      );
    }

    const token = generateProposalAccessToken();
    const tokenHash = hashProposalAccessToken(token);
    const inviteId = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    const expiresAt = getProposalInviteExpiry();
    const signUrl = buildProposalSignUrl(token, request.nextUrl.origin);

    const invite = await fetchMutation(api.app.createProposalInvite, {
      id: inviteId,
      estimateId,
      teamId: coerceString(estimate.teamId),
      documentId: linkedDocument.documentId,
      recipientEmail: signingRecipient.email,
      recipientFirstName: signingRecipient.firstName,
      recipientLastName: signingRecipient.lastName,
      recipientRole: signingRecipient.role ?? linkedDocument.recipientRole,
      accessMode: signingRecipient.mode,
      deliveryChannel: sendEmail ? "email" : "app_link",
      tokenHash,
      expiresAt,
      status: sendEmail ? "pending_email" : "created",
      createdByUserId: userId ?? undefined,
    });

    let emailResult:
      | { status: "sent" }
      | { status: "failed"; error: string }
      | undefined;

    if (sendEmail) {
      try {
        const recipientName = [signingRecipient.firstName, signingRecipient.lastName]
          .filter(Boolean)
          .join(" ")
          .trim();
        await sendProposalSigningEmail({
          to: signingRecipient.email,
          proposalName: coerceString(estimate.title) || "Cornerstone Proposal",
          signUrl,
          recipientName: recipientName || undefined,
          expiresAt,
        });
        await fetchMutation(api.app.markProposalInviteDelivery, {
          inviteId,
          status: "emailed",
          emailedAt: Date.now(),
        });
        emailResult = { status: "sent" };
      } catch (error) {
        const message = error instanceof Error ? error.message : "Failed to send email.";
        await fetchMutation(api.app.markProposalInviteDelivery, {
          inviteId,
          status: "email_failed",
        });
        emailResult = {
          status: "failed",
          error: message,
        };
      }
    }

    return NextResponse.json({
      invite,
      signUrl,
      email: emailResult,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
