const { Resend } = require("resend");

// Constructed lazily (not at module load) so the server doesn't crash on
// startup if RESEND_API_KEY isn't set yet — it only throws when an email
// actually needs to be sent, which forgotPassword() already catches.
async function sendPasswordResetEmail(to, resetUrl) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "TradeMind AI <onboarding@resend.dev>",
    to,
    subject: "Reset your TradeMind AI password",
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #16a34a;">Reset your password</h2>
        <p>We received a request to reset your TradeMind AI password. Click the button below to choose a new one — this link expires in 1 hour.</p>
        <p style="margin: 32px 0;">
          <a href="${resetUrl}" style="background: #22c55e; color: #020617; padding: 14px 28px; border-radius: 12px; text-decoration: none; font-weight: bold;">
            Reset Password
          </a>
        </p>
        <p style="color: #64748b; font-size: 13px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `,
  });
}

// Reasoning text comes from the AI or a third-party news headline, so it's
// escaped before going into HTML.
function escapeHtml(str) {
  return String(str ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// msg is notifyDispatcher.buildMessage()'s output -- shared so email and
// push always describe a signal identically.
async function sendSignalEmail(to, notification, msg) {
  const resend = new Resend(process.env.RESEND_API_KEY);
  const appUrl = `${process.env.APP_BASE_URL || "https://trade-mind-ai-seven.vercel.app"}${msg.url}`;
  const color = notification.signal === "buy" ? "#16a34a" : notification.signal === "sell" ? "#dc2626" : "#64748b";
  const reasoning = (notification.reasoning || "").slice(0, 1200);

  const { error } = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || "TradeMind AI <onboarding@resend.dev>",
    to,
    subject: msg.title,
    html: `
      <div style="font-family: sans-serif; max-width: 520px; margin: 0 auto;">
        <h2 style="color: ${color}; margin-bottom: 4px;">${escapeHtml(msg.title)}</h2>
        <p style="color: #334155; font-weight: bold; white-space: pre-line; margin-top: 0;">${escapeHtml(msg.body)}</p>
        ${reasoning ? `<p style="color: #475569; white-space: pre-line;">${escapeHtml(reasoning)}</p>` : ""}
        <p style="margin: 28px 0;">
          <a href="${appUrl}" style="background: #22c55e; color: #020617; padding: 12px 24px; border-radius: 12px; text-decoration: none; font-weight: bold;">
            Open in TradeMind AI
          </a>
        </p>
        <p style="color: #94a3b8; font-size: 12px;">Not financial advice. You can turn these emails off in TradeMind AI → Settings → Alerts.</p>
      </div>
    `,
  });
  // The Resend SDK reports API errors (bad key, unverified sender domain,
  // recipient not allowed on the free test sender) in its return value
  // rather than throwing -- surface them so the Settings "Send test"
  // button can show the real reason.
  if (error) throw new Error(error.message || "Resend rejected the email");
}

module.exports = { sendPasswordResetEmail, sendSignalEmail };
