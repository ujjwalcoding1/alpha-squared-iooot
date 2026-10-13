/**
 * Alpha Squared – Secure Email Alert Serverless Function (MongoDB Integrated)
 * Deployed on Vercel. Gmail credentials NEVER exposed to browser.
 *
 * POST /api/send-email-alert
 * Body: {
 *   source?: string,
 *   type?: string,
 *   eventId?: string,
 *   patientName?: string,
 *   patientId?: string,
 *   vitals?: { heartRate, temperature, spo2 },
 *   location?: { latitude, longitude, fix_valid, mapsUrl, source },
 *   contacts?: { primary, secondary },
 *   callStatus?: string
 * }
 */

const nodemailer = require("nodemailer");
const db = require("../backend/db");

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

module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed. Use POST." });
  }

  // ── Read secrets from environment ──
  const GMAIL_SENDER   = process.env.GMAIL_SENDER;
  const GMAIL_RECEIVER = process.env.GMAIL_RECEIVER;
  const GMAIL_APP_PASS = process.env.GMAIL_APP_PASSWORD;

  if (!GMAIL_SENDER || !GMAIL_RECEIVER || !GMAIL_APP_PASS) {
    console.error("[Email] Missing environment variables: GMAIL_SENDER, GMAIL_RECEIVER, or GMAIL_APP_PASSWORD");
    return res.status(500).json({
      success: false,
      message: "Server configuration error. Email credentials are not configured in environment variables."
    });
  }

  // ── Parse body ────────────────────────────────────────────────
  let body = {};
  try { body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {}); } catch (_) {}

  const nowIST    = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const isTest    = (body.source || "").includes("test") || Boolean(body.isTest);
  const eventType = body.type || (isTest ? "TEST ALERT" : "EMERGENCY ALERT");
  const eventId   = body.eventId || `EVT_${Date.now()}`;
  const patientName = body.patientName || "Eleanor Vance (Node: ALPHA-001)";

  // Parse location honestly without fabrication
  const loc = body.location || {};
  const hasGps = (loc.fix_valid !== false) &&
                 (typeof loc.latitude === "number" && !isNaN(loc.latitude)) &&
                 (typeof loc.longitude === "number" && !isNaN(loc.longitude));
  const mapsUrl = hasGps ? `https://www.google.com/maps?q=${loc.latitude},${loc.longitude}` : null;
  const locSource = loc.source || (hasGps ? "Hardware GPS Module (NEO-6M)" : "GPS Unavailable");

  // Secondary email recipient if configured
  const secondaryEmail = process.env.SECONDARY_EMERGENCY_EMAIL || (body.contacts && body.contacts.secondary && body.contacts.secondary.email);
  const recipients = [GMAIL_RECEIVER];
  if (secondaryEmail && secondaryEmail.includes("@") && secondaryEmail !== GMAIL_RECEIVER) {
    recipients.push(secondaryEmail);
  }

  // ── Build email content ────────────────────────────────────────────────
  const subject = isTest
    ? "🧪 [Alpha Squad] Test Emergency Notification"
    : `🚨 [Alpha Squad] EMERGENCY ALERT – ${eventType} (Patient ALPHA-001)`;

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
              ${isTest ? 'TEST NOTIFICATION' : 'EMERGENCY ALERT: CRITICAL ATTENTION REQUIRED'}
            </h1>
            <p style="color:rgba(255,255,255,0.85);margin:0;font-size:14px;">Alpha Squad IoT Smart Health Monitoring System</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">
            
            <!-- Event Box -->
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:20px;border-left:4px solid ${isTest ? '#0ea5e9' : '#ef4444'};">
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;">Emergency Trigger Reason</p>
                  <p style="color:#f1f5f9;font-size:18px;font-weight:700;margin:0 0 6px;">${eventType}</p>
                  <p style="color:#94a3b8;font-size:13px;margin:0;">Patient: <strong style="color:#fff;">${patientName}</strong></p>
                </td>
              </tr>
            </table>

            <!-- Vitals Grid -->
            ${body.vitals ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:18px;">
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 12px;text-transform:uppercase;letter-spacing:1px;">Recorded Telemetry Vitals</p>
                  <table width="100%">
                    <tr>
                      <td style="color:#f1f5f9;font-size:14px;padding:6px 0;">🌡️ Body Temperature:</td>
                      <td style="color:#38bdf8;font-size:14px;font-weight:700;text-align:right;">${body.vitals.temperature !== undefined && body.vitals.temperature !== null ? `${body.vitals.temperature} °C` : 'Sensor Unavailable'}</td>
                    </tr>
                    <tr>
                      <td style="color:#f1f5f9;font-size:14px;padding:6px 0;">❤️ Heart Rate:</td>
                      <td style="color:#ef4444;font-size:14px;font-weight:700;text-align:right;">${body.vitals.heartRate !== undefined && body.vitals.heartRate !== null ? `${body.vitals.heartRate} BPM` : 'Sensor Unavailable'}</td>
                    </tr>
                    ${body.vitals.spo2 ? `
                    <tr>
                      <td style="color:#f1f5f9;font-size:14px;padding:6px 0;">🩸 SpO2 Oxygen:</td>
                      <td style="color:#f59e0b;font-size:14px;font-weight:700;text-align:right;">${body.vitals.spo2} %</td>
                    </tr>` : ''}
                  </table>
                </td>
              </tr>
            </table>` : ''}

            <!-- GPS Location Card -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:18px;border-left:4px solid ${hasGps ? '#10b981' : '#f59e0b'};">
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;">📍 Patient GPS Location</p>
                  ${hasGps ? `
                  <p style="color:#f1f5f9;font-size:15px;font-weight:700;margin:0 0 4px;">
                    Lat: ${loc.latitude.toFixed(5)}, Lng: ${loc.longitude.toFixed(5)}
                  </p>
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 14px;">Source: ${locSource}</p>
                  <a href="${mapsUrl}" target="_blank" style="display:inline-block;background:#10b981;color:#fff;text-decoration:none;padding:10px 20px;border-radius:6px;font-weight:700;font-size:13px;">
                    🗺️ Open Location in Google Maps &rarr;
                  </a>
                  ` : `
                  <p style="color:#f59e0b;font-size:14px;font-weight:600;margin:0 0 4px;">
                    ⚠️ GPS Satellite Fix Unavailable at time of alarm.
                  </p>
                  <p style="color:#94a3b8;font-size:12px;margin:0;">
                    Coordinates were not acquired by hardware receiver. Please verify with patient verbally or refer to last known location.
                  </p>
                  `}
                </td>
              </tr>
            </table>

            <!-- Telephony & Contact Info -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:16px;">
                  <p style="color:#94a3b8;font-size:12px;margin:0 0 6px;text-transform:uppercase;letter-spacing:1px;">📞 Emergency Calling Dispatch</p>
                  <p style="color:#f1f5f9;font-size:13px;margin:0;">
                    Primary Contact: <strong>${process.env.PRIMARY_EMERGENCY_PHONE || '+919876543210'}</strong>
                  </p>
                  ${process.env.SECONDARY_EMERGENCY_PHONE ? `
                  <p style="color:#94a3b8;font-size:13px;margin:4px 0 0;">
                    Secondary Backup: <strong>${process.env.SECONDARY_EMERGENCY_PHONE}</strong>
                  </p>` : ''}
                  <p style="color:#38bdf8;font-size:12px;margin:8px 0 0;">
                    Automated Voice Call Workflow: <strong>${body.callStatus || 'Dispatched via Cloud/SIM800L'}</strong>
                  </p>
                </td>
              </tr>
            </table>

            <!-- Timestamp -->
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;">
              <tr>
                <td style="background:#0f172a;border-radius:8px;padding:14px 16px;">
                  <p style="color:#94a3b8;font-size:12px;margin:0;">
                    Timestamp (IST): <strong style="color:#f1f5f9;">${nowIST}</strong> &nbsp;•&nbsp; Event ID: <code>${eventId}</code>
                  </p>
                </td>
              </tr>
            </table>

            ${!isTest ? `
            <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;">
              <tr>
                <td align="center">
                  <div style="background:#ef4444;border-radius:8px;padding:14px 28px;display:inline-block;">
                    <span style="color:#fff;font-size:15px;font-weight:700;">⚠️ IMMEDIATE CAREGIVER RESPONSE REQUESTED</span>
                  </div>
                </td>
              </tr>
            </table>` : ''}

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="background:#0f172a;padding:16px 32px;text-align:center;border-top:1px solid #334155;">
            <p style="color:#475569;font-size:11px;margin:0;line-height:1.4;">
              Alpha Squad IoT Medical Monitoring System &nbsp;•&nbsp; Automated Notification<br>
              <i>Notice: Telemetry data is informational and does not replace professional clinical diagnosis.</i>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  // ── Create Nodemailer transporter ──
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: GMAIL_SENDER,
      pass: GMAIL_APP_PASS
    }
  });

  // ── Send email ──
  try {
    const info = await transporter.sendMail({
      from:    `"Alpha Squad Alert System" <${GMAIL_SENDER}>`,
      to:      recipients.join(", "),
      subject: subject,
      html:    htmlBody
    });

    console.log("[Email] Message sent successfully. MessageId:", info.messageId, "Recipients:", recipients);

    // Persist email notification log to MongoDB Atlas
    try {
      const { db: mongoDb } = await db.connectToDatabase();
      await mongoDb.collection('notification_logs').insertOne({
        event_id: eventId,
        channel: 'email',
        recipients,
        subject,
        has_gps: hasGps,
        gps: hasGps ? { latitude: loc.latitude, longitude: loc.longitude } : null,
        vitals: body.vitals || null,
        sent_at: new Date().toISOString(),
        message_id: info.messageId,
        status: 'delivered'
      });
    } catch (_) {}

    return res.status(200).json({
      success: true,
      message: "Emergency alert email delivered successfully.",
      recipients: recipients,
      has_gps: hasGps,
      maps_url: mapsUrl
    });

  } catch (err) {
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
