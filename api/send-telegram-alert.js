/**
 * Alpha Squared – Secure Telegram Alert Serverless Function
 * Deployed on Vercel. Token is NEVER exposed to the browser.
 *
 * POST /api/send-telegram-alert
 * Body (optional JSON): { message?: string }
 * Returns: { success: boolean, message: string }
 */

// ─── CORS helper ──────────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = [
  "https://ujjwalcoding1.github.io",  // Production GitHub Pages origin
  "http://127.0.0.1:5500",            // VS Code Live Server (local dev)
  "http://localhost:5500",
  "http://localhost:3000"
];

function setCORSHeaders(req, res) {
  const origin = req.headers["origin"] || "";
  const allowed = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  res.setHeader("Access-Control-Allow-Origin", allowed);
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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
  const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
  const CHAT_ID   = process.env.TELEGRAM_CAREGIVER_CHAT_ID;

  if (!BOT_TOKEN || !CHAT_ID) {
    console.error("[Telegram] Missing environment variables: TELEGRAM_BOT_TOKEN or TELEGRAM_CAREGIVER_CHAT_ID");
    return res.status(500).json({
      success: false,
      message: "Server configuration error. Telegram credentials are not configured."
    });
  }

  // ── Build the message ──────────────────────────────────────────────────
  const now = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
  const text =
    `🚨 *TEST EMERGENCY ALERT*\n\n` +
    `This is a test notification from the Alpha Squared emergency monitoring system.\n\n` +
    `*Status:* TEST\n` +
    `*Source:* Emergency Dashboard\n` +
    `*Timestamp:* ${now} IST`;

  // ── Call Telegram Bot API ──────────────────────────────────────────────
  const telegramUrl = `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`;

  let telegramResponse;
  try {
    telegramResponse = await fetch(telegramUrl, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({
        chat_id:    CHAT_ID,
        text:       text,
        parse_mode: "Markdown"
      })
    });
  } catch (networkError) {
    console.error("[Telegram] Network error reaching Telegram API:", networkError.message);
    return res.status(502).json({
      success: false,
      message: "Network error: could not reach Telegram API. Please try again."
    });
  }

  // ── Parse Telegram response ────────────────────────────────────────────
  let telegramData;
  try {
    telegramData = await telegramResponse.json();
  } catch {
    return res.status(502).json({
      success: false,
      message: "Invalid response from Telegram API."
    });
  }

  if (!telegramResponse.ok || !telegramData.ok) {
    // Safe error — never include token in response
    const errDescription = telegramData.description || "Unknown Telegram API error.";
    console.error("[Telegram] API error:", errDescription);
    return res.status(200).json({
      success: false,
      message: `Telegram API error: ${errDescription}`
    });
  }

  // ── Success ────────────────────────────────────────────────────────────
  console.log("[Telegram] Message delivered. message_id:", telegramData.result?.message_id);
  return res.status(200).json({
    success: true,
    message: "Test alert delivered to caregiver Telegram successfully."
  });
};
