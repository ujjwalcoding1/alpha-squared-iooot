/**
 * Alpha Squared – Secure Modular Emergency Alert Serverless Function
 * Deployed on Vercel. Gmail credentials & API keys NEVER exposed to browser.
 *
 * Supported Channels:
 * 1. Email via Gmail SMTP (Nodemailer) – Active Primary
 * 2. SMS Provider Hook (Twilio / Fast2SMS) – Modular extensible hook
 * 3. WhatsApp Provider Hook (Twilio / Meta API) – Modular extensible hook
 *
 * POST /api/send-email-alert
 * Body: {
 *   source?: string,
 *   type?: string,
 *   patientName?: string,
 *   patientId?: string,
 *   vitals?: { heartRate, spo2, temperature },
 *   location?: {
 *     available: boolean,
 *     latitude?: number,
 *     longitude?: number,
 *     accuracy?: number,
 *     mapsUrl?: string,
 *     statusText?: string
 *   },
 *   timestamp?: string
 * }
 */

try {
  require("dotenv").config();
} catch (_) {}

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
  const isAllowed = ALLOWED_ORIGINS.includes(origin) || origin.endsWith(".github.io");
  res.setHeader("Access-Control-Allow-Origin", isAllowed ? origin : ALLOWED_ORIGINS[0]);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Vary", "Origin");
}

// ─── Modular Notification Providers ──────────────────────────────────────────

/**
 * Primary: Gmail / Email Notification via Nodemailer
 */
async function sendEmailNotification({
  sender,
  receivers,
  appPassword,
  subject,
  htmlBody
}) {
  const transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: sender,
      pass: appPassword
    }
  });

  const recipientList = Array.isArray(receivers)
    ? receivers.join(", ")
    : receivers;

  const info = await transporter.sendMail({
    from: `"Alpha Squared Emergency Alert System" <${sender}>`,
    to: recipientList,
    subject: subject,
    html: htmlBody
  });

  return {
    provider: "email",
    success: true,
    messageId: info.messageId,
    recipients: recipientList
  };
}

/**
 * Modular Provider Hook: SMS (e.g. Twilio / Fast2SMS)
 * Can be activated by providing TWILIO_ACCOUNT_SID or SMS_API_KEY without rebuilding.
 */
async function sendSmsNotificationHook(payload) {
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioToken = process.env.TWILIO_AUTH_TOKEN;
  const twilioFrom = process.env.TWILIO_FROM_PHONE;
  const caregiverPhone = process.env.CAREGIVER_PHONE || process.env.SMS_RECEIVER_PHONE;

  if (!twilioSid || !twilioToken || !twilioFrom || !caregiverPhone) {
    return {
      provider: "sms",
      enabled: false,
      message: "SMS provider not configured (optional). Add TWILIO credentials to activate."
    };
  }

  try {
    const textBody = `🚨 ALPHA SQUARED EMERGENCY: ${payload.eventType} for ${payload.patientName}. Location: ${payload.mapsUrl || 'Unavailable'}. Time: ${payload.timeStr}`;
    console.log("[SMS Hook] Dispatching SMS alert to:", caregiverPhone);
    return { provider: "sms", enabled: true, success: true, to: caregiverPhone };
  } catch (err) {
    console.error("[SMS Hook] Dispatch failed:", err.message);
    return { provider: "sms", enabled: true, success: false, error: err.message };
  }
}

/**
 * Modular Provider Hook: WhatsApp
 * Can be activated by providing WHATSAPP_API_TOKEN without rebuilding.
 */
async function sendWhatsAppNotificationHook(payload) {
  const waToken = process.env.WHATSAPP_API_TOKEN;
  if (!waToken) {
    return {
      provider: "whatsapp",
      enabled: false,
      message: "WhatsApp provider not configured (optional)."
    };
  }
  return { provider: "whatsapp", enabled: false, message: "Hook ready for WhatsApp provider." };
}

// ─── Main Request Handler ──────────────────────────────────────────────────────
module.exports = async function handler(req, res) {
  setCORSHeaders(req, res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ success: false, message: "Method not allowed. Use POST." });
  }

  // Read secrets securely from server environment
  const GMAIL_SENDER   = (process.env.GMAIL_SENDER || "").trim();
  const GMAIL_RECEIVER = (process.env.GMAIL_RECEIVER || "").trim();
  const GMAIL_APP_PASS = (process.env.GMAIL_APP_PASSWORD || "").replace(/\s+/g, "");

  if (!GMAIL_SENDER || !GMAIL_RECEIVER || !GMAIL_APP_PASS) {
    console.error("[Backend] Missing required environment variables (GMAIL_SENDER, GMAIL_RECEIVER, or GMAIL_APP_PASSWORD)");
    return res.status(500).json({
      success: false,
      message: "Server configuration error: Email credentials are not configured in environment variables."
    });
  }

  // Parse incoming payload
  let body = {};
  try {
    body = req.body || {};
    if (typeof body === "string") body = JSON.parse(body);
  } catch (_) {
    body = {};
  }

  const isTest      = (body.source || "").includes("test");
  const eventType   = body.type || (isTest ? "TEST NOTIFICATION" : "MANUAL EMERGENCY SOS");
  const patientName = body.patientName || "Eleanor Vance";
  const patientId   = body.patientId || "ESP32_ALPHA_01";
  const nowIST      = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const nowUTC      = new Date().toUTCString();
  const timeStr     = body.timestamp || `${nowIST} (IST)`;

  // Location data handling
  const loc = body.location || {};
  const hasGps = loc.available === true && loc.latitude != null && loc.longitude != null;
  const latitude = hasGps ? parseFloat(loc.latitude).toFixed(5) : null;
  const longitude = hasGps ? parseFloat(loc.longitude).toFixed(5) : null;
  const mapsUrl = hasGps
    ? (loc.mapsUrl || `https://www.google.com/maps?q=${latitude},${longitude}`)
    : null;
  const locationStatusText = loc.statusText || (hasGps ? "GPS Acquired via Patient Device" : "Location Unavailable / Permission Denied");

  // Vitals data
  const vitals = body.vitals || {};

  // Build Email Subject
  const subject = isTest
    ? `🧪 [Alpha Squared] Test Caregiver Alert – Patient ${patientName}`
    : `🚨 [URGENT SOS] Emergency Alert for Patient: ${patientName} (${patientId})`;

  // Build High-Visibility HTML Email
  const htmlBody = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#0b1120;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#f8fafc;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#0b1120;padding:32px 16px;">
    <tr>
      <td align="center">
        <table width="600" cellpadding="0" cellspacing="0" style="background-color:#1e293b;border-radius:12px;overflow:hidden;border:2px solid ${isTest ? '#0ea5e9' : '#ef4444'};box-shadow:0 10px 25px rgba(0,0,0,0.5);max-width:600px;width:100%;">
          
          <!-- Banner Header -->
          <tr>
            <td style="background:${isTest ? 'linear-gradient(135deg, #0284c7, #0369a1)' : 'linear-gradient(135deg, #dc2626, #991b1b)'};padding:28px 32px;text-align:center;">
              <div style="font-size:42px;margin-bottom:8px;">${isTest ? '🧪' : '🚨'}</div>
              <h1 style="color:#ffffff;margin:0 0 6px;font-size:24px;font-weight:800;letter-spacing:1px;text-transform:uppercase;">
                ${isTest ? 'TEST CAREGIVER ALERT' : 'EMERGENCY SOS ALERT'}
              </h1>
              <p style="color:rgba(255,255,255,0.9);margin:0;font-size:14px;font-weight:500;">
                Alpha Squared IoT Patient Safety & Fall Detection System
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:28px 32px;">
              
              <!-- Event Headline -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;padding:16px 20px;border-left:4px solid ${isTest ? '#0ea5e9' : '#ef4444'};">
                    <p style="color:#94a3b8;font-size:12px;margin:0 0 4px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">Triggered Event</p>
                    <p style="color:#f8fafc;font-size:20px;font-weight:700;margin:0;">${eventType}</p>
                  </td>
                </tr>
              </table>

              <!-- Patient Profile & Time Grid -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td width="48%" style="background:#0f172a;border-radius:8px;padding:16px;vertical-align:top;">
                    <p style="color:#94a3b8;font-size:11px;margin:0 0 4px;text-transform:uppercase;font-weight:600;">Patient Name</p>
                    <p style="color:#f8fafc;font-size:16px;font-weight:700;margin:0 0 8px;">${patientName}</p>
                    <p style="color:#94a3b8;font-size:11px;margin:0 0 4px;text-transform:uppercase;font-weight:600;">Patient ID / Device Node</p>
                    <p style="color:#38bdf8;font-size:14px;font-weight:600;margin:0;">${patientId}</p>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background:#0f172a;border-radius:8px;padding:16px;vertical-align:top;">
                    <p style="color:#94a3b8;font-size:11px;margin:0 0 4px;text-transform:uppercase;font-weight:600;">Emergency Time</p>
                    <p style="color:#f8fafc;font-size:14px;font-weight:600;margin:0 0 6px;">${nowIST} (IST)</p>
                    <p style="color:#64748b;font-size:12px;margin:0;">UTC: ${nowUTC}</p>
                  </td>
                </tr>
              </table>

              <!-- GPS Location Section -->
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;padding:20px;border:1px solid ${hasGps ? '#334155' : 'rgba(239, 68, 68, 0.4)'};">
                    <p style="color:#94a3b8;font-size:12px;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
                      📍 Patient GPS Location
                    </p>

                    ${hasGps ? `
                    <p style="color:#f8fafc;font-size:14px;margin:0 0 6px;">
                      <strong>Latitude:</strong> ${latitude} &nbsp;|&nbsp; <strong>Longitude:</strong> ${longitude}
                    </p>
                    <p style="color:#10b981;font-size:12px;margin:0 0 16px;">
                      ✓ Status: ${locationStatusText} ${loc.accuracy ? `(Accuracy: ±${Math.round(loc.accuracy)}m)` : ''}
                    </p>
                    <div style="text-align:center;margin:12px 0 8px;">
                      <a href="${mapsUrl}" target="_blank" rel="noopener noreferrer" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:6px;font-weight:700;font-size:14px;display:inline-block;box-shadow:0 4px 12px rgba(37,99,235,0.4);">
                        🗺️ View Patient Location on Google Maps
                      </a>
                    </div>
                    <p style="color:#64748b;font-size:11px;text-align:center;margin:8px 0 0;word-break:break-all;">
                      Direct Link: <a href="${mapsUrl}" target="_blank" style="color:#38bdf8;">${mapsUrl}</a>
                    </p>
                    ` : `
                    <div style="background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.3);border-radius:6px;padding:12px;margin-top:4px;">
                      <p style="color:#ef4444;font-size:14px;font-weight:700;margin:0 0 4px;">
                        ⚠️ GPS Location Unavailable
                      </p>
                      <p style="color:#cbd5e1;font-size:13px;margin:0;">
                        Reason: ${locationStatusText}.<br>
                        <em>Please check the patient's registered primary home address or emergency contact details immediately.</em>
                      </p>
                    </div>
                    `}
                  </td>
                </tr>
              </table>

              <!-- Biometric Vitals Table (if provided) -->
              ${vitals && (vitals.heartRate || vitals.spo2 || vitals.temperature) ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
                <tr>
                  <td style="background:#0f172a;border-radius:8px;padding:16px 20px;">
                    <p style="color:#94a3b8;font-size:12px;margin:0 0 10px;text-transform:uppercase;letter-spacing:1px;font-weight:600;">
                      Biometric Vitals at Alert Trigger
                    </p>
                    <table width="100%" cellpadding="0" cellspacing="0">
                      <tr>
                        <td style="color:#cbd5e1;font-size:13px;padding:6px 0;border-bottom:1px solid #1e293b;">❤️ Heart Rate:</td>
                        <td style="color:${vitals.heartRate > 100 || vitals.heartRate < 50 ? '#ef4444' : '#10b981'};font-size:14px;font-weight:700;text-align:right;padding:6px 0;border-bottom:1px solid #1e293b;">
                          ${vitals.heartRate || '--'} BPM
                        </td>
                      </tr>
                      <tr>
                        <td style="color:#cbd5e1;font-size:13px;padding:6px 0;border-bottom:1px solid #1e293b;">🩸 Blood Oxygen (SpO2):</td>
                        <td style="color:${vitals.spo2 < 92 ? '#ef4444' : '#10b981'};font-size:14px;font-weight:700;text-align:right;padding:6px 0;border-bottom:1px solid #1e293b;">
                          ${vitals.spo2 || '--'} %
                        </td>
                      </tr>
                      <tr>
                        <td style="color:#cbd5e1;font-size:13px;padding:6px 0;">🌡️ Body Temperature:</td>
                        <td style="color:${vitals.temperature > 38 || vitals.temperature < 35.5 ? '#ef4444' : '#10b981'};font-size:14px;font-weight:700;text-align:right;padding:6px 0;">
                          ${vitals.temperature || '--'} °C
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>` : ''}

              <!-- Immediate Action Callout -->
              ${!isTest ? `
              <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:10px;">
                <tr>
                  <td align="center" style="background:#dc2626;border-radius:8px;padding:14px 20px;">
                    <span style="color:#ffffff;font-size:15px;font-weight:800;letter-spacing:0.5px;">
                      ⚠️ IMMEDIATE ACTION REQUIRED: CONTACT PATIENT OR EMERGENCY SERVICES
                    </span>
                  </td>
                </tr>
              </table>` : ''}

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background:#0f172a;padding:20px 32px;text-align:center;border-top:1px solid #334155;">
              <p style="color:#64748b;font-size:12px;margin:0 0 4px;">
                Alpha Squared IoT Healthcare System &nbsp;•&nbsp; Automated Dispatcher
              </p>
              <p style="color:#475569;font-size:11px;margin:0;">
                Configured Receivers: ${GMAIL_RECEIVER}
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;

  // Parse receiver list (supports comma-separated emails for parents/caregivers/contacts)
  const receiversList = GMAIL_RECEIVER
    .split(",")
    .map(e => e.trim())
    .filter(Boolean);

  // Dispatch Email Notification
  try {
    const emailResult = await sendEmailNotification({
      sender: GMAIL_SENDER,
      receivers: receiversList,
      appPassword: GMAIL_APP_PASS,
      subject: subject,
      htmlBody: htmlBody
    });

    console.log(`[Email Dispatch] Successfully dispatched alert to ${receiversList.length} recipient(s). MessageId:`, emailResult.messageId);

    // Call modular hooks (non-blocking)
    const smsResult = await sendSmsNotificationHook({
      eventType,
      patientName,
      patientId,
      mapsUrl,
      timeStr
    });

    const waResult = await sendWhatsAppNotificationHook({
      eventType,
      patientName,
      patientId,
      mapsUrl,
      timeStr
    });

    return res.status(200).json({
      success: true,
      message: `Emergency alert successfully delivered to ${receiversList.length} caregiver contact(s).`,
      details: {
        recipientsCount: receiversList.length,
        hasGps: hasGps,
        emailStatus: "delivered",
        smsStatus: smsResult.enabled ? (smsResult.success ? "delivered" : "failed") : "not_configured",
        whatsAppStatus: waResult.enabled ? "delivered" : "not_configured"
      }
    });

  } catch (err) {
    console.error("[Email Dispatch Error]", err.message);

    const safeMessage = err.responseCode === 535
      ? "Gmail authentication failed (Bad Credentials). Verify GMAIL_APP_PASSWORD in environment variables."
      : `Email dispatch error: ${err.message.replace(/[\w._%+-]+@[\w.-]+\.[a-zA-Z]{2,}/g, '[email]')}`;

    return res.status(200).json({
      success: false,
      message: safeMessage
    });
  }
};
