import { NextRequest, NextResponse } from "next/server";
import { getProposalInviteComputedState, getProposalInviteEnvelopeByToken } from "@/lib/server/proposal-invites";

export const runtime = "nodejs";
export const maxDuration = 30;

function coerceString(value: unknown) {
  return String(value ?? "").trim();
}

export async function GET(
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

    return NextResponse.json({
      ...getProposalInviteComputedState(envelope),
      invite: envelope.invite,
      estimate: envelope.estimate
        ? {
            id: envelope.estimate.id,
            title: envelope.estimate.title,
            pandadocState: envelope.estimate.pandadocState ?? null,
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
