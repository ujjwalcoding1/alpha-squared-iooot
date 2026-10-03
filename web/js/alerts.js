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
 * Dispatches emergency notification to Caregiver via secure backend (Gmail Email)
 * @param {Object} emergencyDetails { eventId, type, vitals }
 */
async function dispatchCaregiverAlert(emergencyDetails) {
    console.log("[Alerts] Dispatching caregiver notification...", emergencyDetails);

    // Fire native browser push notification (local, no credentials needed)
    triggerNativePushNotification(
        `🚨 EMERGENCY ALERT: ${emergencyDetails.type}`,
        `Patient Eleanor Vance needs help! HR: ${emergencyDetails.vitals.heartRate || '--'} BPM, SpO2: ${emergencyDetails.vitals.spo2 || '--'}%`
    );

    // Read API config from LocalStorage (only backendUrl is stored — no credentials)
    const alertConfig = JSON.parse(localStorage.getItem("alpha_alert_api_config") || "{}");
    const backendUrl  = alertConfig.backendUrl  || "";
    const webhookUrl  = alertConfig.webhookUrl  || "";

    // 1. Dispatch via secure Vercel backend → Gmail (Nodemailer)
    //    SECURITY: Gmail credentials (sender, receiver, app password) NEVER leave the server.
    if (backendUrl) {
        try {
            const backendRes = await fetch(backendUrl, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify({
                    source:  "emergency_dispatch",
                    eventId: emergencyDetails.eventId,
                    type:    emergencyDetails.type,
                    vitals:  emergencyDetails.vitals
                })
            });
            const backendData = await backendRes.json().catch(() => ({}));

            if (backendData.success) {
                return {
                    status:  "Alert Sent (Email via Secure Backend)",
                    message: "Emergency alert email dispatched to caregiver inbox."
                };
            } else {
                console.error("[Alerts] Backend email dispatch error:", backendData.message);
                return {
                    status:  "Alert Failed (Backend Error)",
                    message: backendData.message || "Backend returned an error."
                };
            }
        } catch (err) {
            console.error("[Alerts] Backend fetch failed:", err);
        }
    }

    // 2. Dispatch via Custom Webhook (future integration)
    if (webhookUrl) {
        try {
            await fetch(webhookUrl, {
                method:  "POST",
                headers: { "Content-Type": "application/json" },
                body:    JSON.stringify(emergencyDetails)
            });
            return {
                status:  "Alert Sent (Webhook API)",
                message: `Successfully posted to webhook: ${webhookUrl}`
            };
        } catch (err) {
            console.error("[Alerts] Webhook POST failed:", err);
            return {
                status:  "Alert Failed",
                message: err.message
            };
        }
    }

    // Default fallback — browser notification only
    return {
        status:  "Browser Notified",
        message: "Browser & sound alarm triggered. (Configure Email Backend URL in Settings to send real alerts.)"
    };
}

// Request notification permission on script load
document.addEventListener("DOMContentLoaded", () => {
    initAlertPermissions();
});
