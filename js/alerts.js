/**
 * Alpha Squared - Emergency Alert & Caregiver Notification Manager
 * 
 * Supports:
 * 1. Native Mobile / Browser Push Notifications (Web Notification API)
 * 2. Webhook / Telegram Bot API / SMS Gateway Integration for Family & Caregivers
 * 3. Web Audio Emergency Alarm Siren
 */

let audioContext = null;
let sirenInterval = null;

// Initialize Browser Push Notification Permission
function initAlertPermissions() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().then(permission => {
            console.log(`[Alerts] Push Notification permission: ${permission}`);
        });
    }
}

// Synthesize Emergency Siren Sound via Web Audio API
function playEmergencySiren() {
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }

        if (sirenInterval) return; // Already playing

        let highPitch = true;
        sirenInterval = setInterval(() => {
            if (!audioContext) return;
            const osc = audioContext.createOscillator();
            const gain = audioContext.createGain();

            osc.type = 'sawtooth';
            osc.frequency.setValueAtTime(highPitch ? 880 : 587.33, audioContext.currentTime); // A5 / D5 pitch

            gain.gain.setValueAtTime(0.3, audioContext.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.35);

            osc.connect(gain);
            gain.connect(audioContext.destination);

            osc.start();
            osc.stop(audioContext.currentTime + 0.35);

            highPitch = !highPitch;
        }, 400);
    } catch (e) {
        console.warn("[Alerts] Audio synth error:", e);
    }
}

function stopEmergencySiren() {
    if (sirenInterval) {
        clearInterval(sirenInterval);
        sirenInterval = null;
        console.log("[Alerts] Siren audio muted.");
    }
}

// Send Native Desktop / Android Mobile Push Notification
function triggerNativePushNotification(title, bodyMessage) {
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(title, {
                body: bodyMessage,
                icon: "assets/logo/logo.png",
                vibrate: [200, 100, 200, 100, 200]
            });
            console.log("[Alerts] Native browser push notification fired!");
        } catch (e) {
            console.warn("[Alerts] Push notification error:", e);
        }
    }
}

/**
 * Dispatches notification to Caregiver via Webhook / Telegram Bot API / SMS service
 * @param {Object} emergencyDetails { eventId, type, vitals }
 */
async function dispatchCaregiverAlert(emergencyDetails) {
    console.log("[Alerts] Dispatching caregiver notification...", emergencyDetails);

    // Fired native push notification to browser/mobile
    triggerNativePushNotification(
        `🚨 EMERGENCY ALERT: ${emergencyDetails.type}`,
        `Patient Eleanor Vance needs help! HR: ${emergencyDetails.vitals.heartRate || '--'} BPM, SpO2: ${emergencyDetails.vitals.spo2 || '--'}%`
    );

    // Read Caregiver Alert API config from LocalStorage
    const alertConfig = JSON.parse(localStorage.getItem("alpha_alert_api_config") || "{}");

    const webhookUrl = alertConfig.webhookUrl || "";
    const telegramToken = alertConfig.telegramToken || "";
    const telegramChatId = alertConfig.telegramChatId || "";

    // 1. Dispatch via Telegram Bot API if configured (Free & Instant SMS/Message to Caregiver Phone App)
    if (telegramToken && telegramChatId) {
        try {
            const textMsg = encodeURIComponent(
                `🚨 *ALPHA SQUARED EMERGENCY ALERT*\n\n` +
                `*Event:* ${emergencyDetails.type}\n` +
                `*Patient:* Eleanor Vance\n` +
                `*Vitals:* HR ${emergencyDetails.vitals.heartRate} BPM | SpO2 ${emergencyDetails.vitals.spo2}% | Temp ${emergencyDetails.vitals.temperature}°C\n` +
                `*Location:* https://maps.google.com/?q=${emergencyDetails.vitals.latitude || 28.6139},${emergencyDetails.vitals.longitude || 77.2090}\n` +
                `*Timestamp:* ${new Date().toLocaleString()}`
            );
            
            const tgUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage?chat_id=${telegramChatId}&text=${textMsg}&parse_mode=Markdown`;
            fetch(tgUrl).catch(err => console.error("Telegram dispatch error:", err));

            return {
                status: "Alert Sent (Telegram API)",
                message: "Instant SOS alert dispatched to Caregiver Telegram App."
            };
        } catch (err) {
            console.error("Telegram API failed:", err);
        }
    }

    // 2. Dispatch via Custom Webhook / Twilio / Email API Endpoint if configured
    if (webhookUrl) {
        try {
            await fetch(webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(emergencyDetails)
            });

            return {
                status: "Alert Sent (Webhook API)",
                message: `Successfully posted to webhook: ${webhookUrl}`
            };
        } catch (err) {
            console.error("Webhook POST failed:", err);
            return {
                status: "Alert Failed",
                message: err.message
            };
        }
    }

    // Default Fallback mode when API credentials are pending in Settings
    return {
        status: "Browser Notified",
        message: "Browser & Sound alarm triggered. (To connect Telegram/Twilio SMS API, configure settings)."
    };
}

// Request permission on script load
document.addEventListener("DOMContentLoaded", () => {
    initAlertPermissions();
});
