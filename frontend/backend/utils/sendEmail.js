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

module.exports = { sendPasswordResetEmail };
