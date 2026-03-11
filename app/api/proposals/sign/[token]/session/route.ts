import { NextRequest, NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import { preparePandaDocForEmbeddedSigning } from "@/lib/server/pandadoc";
import {
  getProposalInviteComputedState,
  getProposalInviteEnvelopeByToken,
} from "@/lib/server/proposal-invites";

export const runtime = "nodejs";
export const maxDuration = 60;

function coerceString(value: unknown) {
  return String(value ?? "").trim();
}

export async function POST(
  _request: NextRequest,
  context: { params: { token: string } }
) {
  try {
    const token = coerceString(context.params?.token);
    if (!token) {
      return NextResponse.json({ error: "Signing token is required." }, { status: 400 });
    }

    const envelope = await getProposalInviteEnvelopeByToken(token);
    if (!envelope?.invite) {
      return NextResponse.json({ error: "Signing link not found." }, { status: 404 });
    }

    const state = getProposalInviteComputedState(envelope);
    if (state.invalid) {
      return NextResponse.json(
        { error: state.expired ? "Signing link expired." : "Signing link is not available." },
        { status: 410 }
      );
    }
    if (state.completed) {
      return NextResponse.json(
        { error: "This proposal has already been completed." },
        { status: 409 }
      );
    }

    const invite = envelope.invite;
    const sessionResult = await preparePandaDocForEmbeddedSigning({
      documentId: coerceString(invite.documentId),
      recipientEmail: coerceString(invite.recipientEmail),
      sessionLifetimeSeconds: 900,
    });

    await fetchMutation(api.app.markProposalInviteOpened, {
      inviteId: coerceString(invite.id),
      openedAt: Date.now(),
    });

    return NextResponse.json(sessionResult);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
