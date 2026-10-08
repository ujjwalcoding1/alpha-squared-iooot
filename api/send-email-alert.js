/**
 * Alpha Squared – Secure Email Alert Serverless Function
 * Deployed on Vercel. Gmail credentials NEVER exposed to browser.
 *
 * POST /api/send-email-alert
 * Body (optional JSON): { subject?: string, message?: string, source?: string }
 * Returns: { success: boolean, message: string }
 */

const nodemailer = require("nodemailer");

// ─── CORS helper ──────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://ujjwalcoding1.github.io",
  "http://127.0.0.1:5500",
  "http://localhost:5500",
  "http://localhost:3000"
];

function setCORSHeaders(req, res) {
  const origin = req.headers["origin"] || "";
  const isAllowed = !origin || ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".github.io") || origin.includes("localhost") || origin.includes("127.0.0.1");
  res.setHeader("Access-Control-Allow-Origin", isAllowed && origin ? origin : "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Max-Age", "86400");
  res.setHeader("Vary", "Origin");
}

// ─── Main Handler ──────────────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);

  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  // Only accept POST
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed. Use POST." });
  }

  // ── Read secrets from environment (NEVER from request body / client) ──
  const GMAIL_SENDER   = process.env.GMAIL_SENDER;
  const GMAIL_RECEIVER = process.env.GMAIL_RECEIVER;
  const GMAIL_APP_PASS = process.env.GMAIL_APP_PASSWORD;

  if (!GMAIL_SENDER || !GMAIL_RECEIVER || !GMAIL_APP_PASS) {
    console.error("[Email] Missing environment variables: GMAIL_SENDER, GMAIL_RECEIVER, or GMAIL_APP_PASSWORD");
    return res.status(500).json({
      success: false,
      message: "Server configuration error. Email credentials are not configured."
    });
  }

  // ── Parse optional body ────────────────────────────────────────────────
  let body = {};
  try { body = req.body || {}; } catch (_) {}

  const now       = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const isTest    = (body.source || "").includes("test");
  const eventType = body.type || (isTest ? "TEST ALERT" : "EMERGENCY ALERT");

  // ── Build email content ────────────────────────────────────────────────
  const subject = isTest
    ? "🧪 [Alpha Squared] Test Emergency Notification"
    : `🚨 [Alpha Squared] EMERGENCY ALERT – ${eventType}`;

  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f172a;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#0f172a;padding:32px 16px;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#1e293b;border-radius:12px;overflow:hidden;border:2px solid ${isTest ? '#0ea5e9' : '#ef4444'};">

        <!-- Header -->
        <tr>
          <td style="background:${isTest ? '#0369a1' : '#991b1b'};padding:24px 32px;text-align:center;">
            <div style="font-size:36px;">${isTest ? '🧪' : '🚨'}</div>
            <h1 style="color:#fff;margin:8px 0 4px;font-size:22px;letter-spacing:1px;">
              ${isTest ? 'TEST NOTIFICATION' : 'EMERGENCY ALERT'}
            </h1>
            <p style="color:rgba(255,255,255,0.8);margin:0;font-size:14px;">Alpha Squared Medical Monitoring System</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:20px;border-left:4px solid ${isTest ? '#0ea5e9' : '#ef4444'};">
                  <p style="color:#94a3b8;font-size:13px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;">Event Type</p>
                  <p style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0;">${eventType}</p>
                </td>
              </tr>
            </table>

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td width="48%" style="background:#0f172a;border-radius:8px;padding:16px;vertical-align:top;">
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;text-transform:uppercase;">Status</p>
                  <p style="color:${isTest ? '#38bdf8' : '#ef4444'};font-size:16px;font-weight:700;margin:0;">
                    ${isTest ? '✅ TEST' : '🔴 ACTIVE'}
                  </p>
                </td>
                <td width="4%"></td>
                <td width="48%" style="background:#0f172a;border-radius:8px;padding:16px;vertical-align:top;">
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;text-transform:uppercase;">Source</p>
                  <p style="color:#f1f5f9;font-size:14px;font-weight:600;margin:0;">Emergency Dashboard</p>
                </td>
              </tr>
            </table>

            ${body.vitals ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:16px;">
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;">Patient Vitals at Alarm</p>
                  <table width="100%">
                    <tr>
                      <td style="color:#f1f5f9;font-size:13px;padding:4px 0;">❤️ Heart Rate:</td>
                      <td style="color:#ef4444;font-size:13px;font-weight:700;text-align:right;">${body.vitals.heartRate || '--'} BPM</td>
                    </tr>
                    <tr>
                      <td style="color:#f1f5f9;font-size:13px;padding:4px 0;">🩸 SpO2:</td>
                      <td style="color:#f59e0b;font-size:13px;font-weight:700;text-align:right;">${body.vitals.spo2 || '--'} %</td>
                    </tr>
                    <tr>
                      <td style="color:#f1f5f9;font-size:13px;padding:4px 0;">🌡️ Temperature:</td>
                      <td style="color:#10b981;font-size:13px;font-weight:700;text-align:right;">${body.vitals.temperature || '--'} °C</td>
                    </tr>
                  </table>
                </td>
              </tr>
            </table>` : ''}

            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:16px;">
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;text-transform:uppercase;">Timestamp (IST)</p>
                  <p style="color:#f1f5f9;font-size:14px;margin:0;">${now}</p>
                </td>
              </tr>
            </table>

            ${!isTest ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
              <tr>
                <td align="center">
                  <div style="background:#ef4444;border-radius:8px;padding:14px 28px;display:inline-block;">
                    <span style="color:#fff;font-size:16px;font-weight:700;">⚠️ IMMEDIATE ACTION REQUIRED</span>
                  </div>
                </td>
              </tr>
            </table>` : ''}
          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0f172a;padding:16px 32px;text-align:center;border-top:1px solid #334155;">
            <p style="color:#475569;font-size:12px;margin:0;">
              Alpha Squared IoT Medical Monitoring System &nbsp;•&nbsp; Automated Alert
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // ── Create Nodemailer transporter ──────────────────────────────────────
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_SENDER,
      pass: GMAIL_APP_PASS   // App Password from env var — NEVER from client
    }
  });

  // ── Send email ─────────────────────────────────────────────────────────
  try {
    const info = await transporter.sendMail({
      from:    `"Alpha Squared Alert System" <${GMAIL_SENDER}>`,
      to:      GMAIL_RECEIVER,
      subject: subject,
      html:    htmlBody
    });

    console.log("[Email] Message sent successfully. MessageId:", info.messageId);
    return res.status(200).json({
      success: true,
      message: "Emergency alert email delivered successfully."
    });

  } catch (err) {
    // Log full error server-side but NEVER expose credentials in response
    console.error("[Email] Nodemailer send error:", err.message);

    const safeMessage = err.responseCode === 535
      ? "Gmail authentication failed. Check GMAIL_APP_PASSWORD environment variable."
      : `Email delivery failed: ${err.message.replace(/[\w._%+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[email]')}`;

    return res.status(200).json({
      success: false,
      message: safeMessage
    });
  }
};

