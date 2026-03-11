import { NextRequest, NextResponse } from "next/server";
import { fetchMutation } from "convex/nextjs";
import { api } from "@/convex/_generated/api";
import {
  hashProposalAccessToken,
  verifyPandaDocWebhookSignature,
} from "@/lib/server/proposal-signing";

export const runtime = "nodejs";
export const maxDuration = 30;

function coerceString(value: unknown) {
  return String(value ?? "").trim();
}

function resolveEventType(payload: Record<string, unknown>) {
  return (
    coerceString(payload.event) ||
    coerceString(payload.event_type) ||
    coerceString(payload.type)
  );
}

function resolveDocumentId(payload: Record<string, unknown>) {
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  return (
    coerceString(payload.document_id) ||
    coerceString(data?.id) ||
    coerceString(payload.id)
  );
}

function resolveDocumentStatus(payload: Record<string, unknown>) {
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  return coerceString(data?.status) || coerceString(payload.status);
}

function resolveRecipient(payload: Record<string, unknown>) {
  const data =
    payload.data && typeof payload.data === "object"
      ? (payload.data as Record<string, unknown>)
      : null;
  const recipient =
    data?.recipient && typeof data.recipient === "object"
      ? (data.recipient as Record<string, unknown>)
      : null;
  return {
    email:
      coerceString(recipient?.email) ||
      coerceString(data?.recipient_email) ||
      undefined,
    role:
      coerceString(recipient?.role) ||
      coerceString(data?.recipient_role) ||
      undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const payloadText = await request.text();
    const signature =
      request.nextUrl.searchParams.get("signature") ||
      request.headers.get("x-pandadoc-signature") ||
      request.headers.get("pandadoc-signature") ||
      "";

    if (!signature || !verifyPandaDocWebhookSignature(payloadText, signature)) {
      return NextResponse.json({ error: "Invalid webhook signature." }, { status: 401 });
    }

    const payload = JSON.parse(payloadText) as Record<string, unknown>;
    const eventType = resolveEventType(payload);
    const documentId = resolveDocumentId(payload);
    if (!eventType || !documentId) {
      return NextResponse.json({ error: "Webhook payload is missing document metadata." }, { status: 400 });
    }

    const receivedAt = Date.now();
    const eventKey =
      coerceString(payload.id) ||
      hashProposalAccessToken(`${eventType}:${documentId}:${payloadText}`);
    const recordResult = await fetchMutation(api.app.recordPandaDocWebhookEvent, {
      id: globalThis.crypto?.randomUUID?.() ?? `${receivedAt}-${Math.random()}`,
      eventKey,
      eventType,
      documentId,
      payload,
      receivedAt,
    });

    if (recordResult.duplicate) {
      return NextResponse.json({ ok: true, duplicate: true });
    }

    const documentStatus = resolveDocumentStatus(payload);
    const recipient = resolveRecipient(payload);
    const normalizedStatus =
      documentStatus ||
      (eventType === "recipient_completed" ? "document.completed" : "document.sent");

    await fetchMutation(api.app.applyPandaDocWebhookState, {
      documentId,
      status: normalizedStatus,
      recipientEmail: recipient.email,
      recipientRole: recipient.role,
      occurredAt: receivedAt,
      markViewed:
        normalizedStatus === "document.viewed" ||
        normalizedStatus === "document.sent.viewed",
      markCompleted:
        eventType === "recipient_completed" || normalizedStatus === "document.completed",
    });

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
