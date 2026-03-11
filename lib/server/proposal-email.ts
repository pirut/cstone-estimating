type SendProposalEmailArgs = {
  to: string;
  proposalName: string;
  signUrl: string;
  recipientName?: string;
  expiresAt?: number;
};

function coerceString(value: unknown) {
  return String(value ?? "").trim();
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatExpiry(expiresAt?: number) {
  if (!expiresAt || !Number.isFinite(expiresAt)) return "";
  return new Date(expiresAt).toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

export async function sendProposalSigningEmail(args: SendProposalEmailArgs) {
  const apiKey = coerceString(process.env.RESEND_API_KEY);
  const fromEmail = coerceString(process.env.RESEND_FROM_EMAIL);
  if (!apiKey || !fromEmail) {
    throw new Error("Missing email configuration: RESEND_API_KEY and RESEND_FROM_EMAIL are required.");
  }

  const recipientName = coerceString(args.recipientName);
  const proposalName = coerceString(args.proposalName) || "Cornerstone Proposal";
  const expiryLabel = formatExpiry(args.expiresAt);
  const greeting = recipientName ? `Hi ${escapeHtml(recipientName)},` : "Hello,";
  const html = `
    <div style="background:#f4f1ea;padding:32px 16px;font-family:Work Sans,Helvetica,Arial,sans-serif;color:#1f2933;">
      <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #d8d3c7;border-radius:18px;overflow:hidden;">
        <div style="padding:28px 32px;background:linear-gradient(135deg,#17202a 0%,#394553 100%);color:#f8f5ef;">
          <div style="font-size:12px;letter-spacing:0.18em;text-transform:uppercase;opacity:0.8;">Cornerstone Proposal</div>
          <h1 style="margin:14px 0 0;font-size:28px;line-height:1.2;font-weight:500;">${escapeHtml(proposalName)}</h1>
        </div>
        <div style="padding:32px;">
          <p style="margin:0 0 16px;font-size:16px;line-height:1.6;">${greeting}</p>
          <p style="margin:0 0 20px;font-size:16px;line-height:1.6;">Your proposal is ready for review and signature.</p>
          <p style="margin:0 0 28px;">
            <a href="${escapeHtml(args.signUrl)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#ba5a2a;color:#ffffff;text-decoration:none;font-weight:600;">Review and Sign Proposal</a>
          </p>
          <p style="margin:0 0 12px;font-size:14px;line-height:1.6;color:#52606d;">If the button does not work, open this link directly:</p>
          <p style="margin:0 0 18px;font-size:14px;line-height:1.6;word-break:break-all;">
            <a href="${escapeHtml(args.signUrl)}" style="color:#ba5a2a;text-decoration:underline;">${escapeHtml(args.signUrl)}</a>
          </p>
          ${expiryLabel ? `<p style="margin:0;font-size:13px;line-height:1.6;color:#7b8794;">This signing link expires on ${escapeHtml(expiryLabel)}.</p>` : ""}
        </div>
      </div>
    </div>
  `;

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: fromEmail,
      to: [args.to],
      subject: `${proposalName} is ready for signature`,
      html,
    }),
    cache: "no-store",
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      (data &&
        typeof data === "object" &&
        typeof (data as { message?: string }).message === "string" &&
        (data as { message?: string }).message) ||
      `Resend request failed (${response.status}).`;
    throw new Error(message);
  }

  return data;
}
