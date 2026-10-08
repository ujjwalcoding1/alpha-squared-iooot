/**
 * Alpha Squared - Alert Notifications & Siren Dispatch Engine
 * 
 * Secure Architecture:
 * - Credentials (Gmail, App Password, etc.) NEVER stored or handled in frontend.
 * - Emergency alerts are securely POSTed to the backend API endpoint (/api/send-email-alert).
 * - Plays local browser Web Audio synthesizer siren and triggers Native Push Notifications.
 */

let sirenAudioContext = null;
let sirenOscillator = null;
let sirenGain = null;
let sirenInterval = null;

/**
 * Initializes browser Web Notification permissions
 */
function initAlertPermissions() {
    if ("Notification" in window && Notification.permission === "default") {
        Notification.requestPermission().then(permission => {
            console.log("[Alerts] Browser Notification permission:", permission);
        });
    }
}

/**
 * Fires local browser Push Notification
 */
function triggerNativePushNotification(title, message) {
    if ("Notification" in window && Notification.permission === "granted") {
        try {
            new Notification(title, {
                body: message,
                icon: "assets/logo/logo.png"
            });
        } catch (e) {
            console.error("[Alerts] Error showing browser notification:", e);
        }
    }
}

/**
 * Generates an audible Emergency Siren using the Web Audio API
 */
function playEmergencySiren() {
    try {
        if (!sirenAudioContext) {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            sirenAudioContext = new AudioContext();
        }

        if (sirenAudioContext.state === 'suspended') {
            sirenAudioContext.resume();
        }

        if (sirenOscillator) return; // Already playing

        sirenOscillator = sirenAudioContext.createOscillator();
        sirenGain = sirenAudioContext.createGain();

        sirenOscillator.type = "sawtooth";
        sirenGain.gain.setValueAtTime(0.2, sirenAudioContext.currentTime);

        sirenOscillator.connect(sirenGain);
        sirenGain.connect(sirenAudioContext.destination);

        let highFreq = false;
        sirenOscillator.frequency.setValueAtTime(700, sirenAudioContext.currentTime);
        sirenOscillator.start();

        sirenInterval = setInterval(() => {
            if (sirenOscillator && sirenAudioContext) {
                const targetFreq = highFreq ? 700 : 960;
                sirenOscillator.frequency.exponentialRampToValueAtTime(
                    targetFreq,
                    sirenAudioContext.currentTime + 0.3
                );
                highFreq = !highFreq;
            }
        }, 400);

        console.log("[Alerts] Emergency Siren activated.");
    } catch (e) {
        console.error("[Alerts] Web Audio Siren initialization failed:", e);
    }
}

/**
 * Stops the Emergency Siren sound
 */
function stopEmergencySiren() {
    if (sirenInterval) {
        clearInterval(sirenInterval);
        sirenInterval = null;
    }
    if (sirenOscillator) {
        try {
            sirenOscillator.stop();
            sirenOscillator.disconnect();
        } catch (_) {}
        sirenOscillator = null;
    }
    console.log("[Alerts] Emergency Siren muted.");
}

/**
 * Dispatches emergency notification to Caregiver via secure backend (Gmail Email + Hooks)
 * 
 * @param {Object} emergencyDetails {
 *   eventId: string,
 *   type: string,
 *   patientName?: string,
 *   patientId?: string,
 *   vitals: Object,
 *   location: Object { available, latitude, longitude, accuracy, mapsUrl, statusText },
 *   timestamp?: string
 * }
 * @returns {Promise<Object>} { success: boolean, status: string, message: string }
 */
async function dispatchCaregiverAlert(emergencyDetails) {
    console.log("[Alerts] Dispatching caregiver emergency notification...", emergencyDetails);

    // 1. Fire native browser push notification (local, no credentials needed)
    const patientName = emergencyDetails.patientName || "Eleanor Vance";
    const hr = emergencyDetails.vitals ? emergencyDetails.vitals.heartRate : '--';
    const spo2 = emergencyDetails.vitals ? emergencyDetails.vitals.spo2 : '--';

    triggerNativePushNotification(
        `🚨 EMERGENCY ALERT: ${emergencyDetails.type}`,
        `Patient ${patientName} needs help! HR: ${hr} BPM, SpO2: ${spo2}%`
    );

    // 2. Read backend endpoint configuration
    const alertConfig = JSON.parse(localStorage.getItem("alpha_alert_api_config") || "{}");
    // Fall back to default deployed Vercel endpoint if not set
    let backendUrl = (alertConfig.backendUrl || "").trim();
    if (!backendUrl || backendUrl.startsWith("/") || backendUrl.includes("your-project")) {
        backendUrl = "https://alpha-squared-iooot.vercel.app/api/send-email-alert";
    } else if (backendUrl.startsWith("http") && !backendUrl.includes("/api/")) {
        backendUrl = backendUrl.replace(/\/+$/, "") + "/api/send-email-alert";
    }

    const payload = {
        source: "emergency_dispatch",
        eventId: emergencyDetails.eventId,
        type: emergencyDetails.type,
        patientName: patientName,
        patientId: emergencyDetails.patientId || "ESP32_ALPHA_01",
        vitals: emergencyDetails.vitals,
        location: emergencyDetails.location || {
            available: false,
            latitude: null,
            longitude: null,
            statusText: "Location not provided"
        },
        timestamp: emergencyDetails.timestamp || new Date().toLocaleString()
    };

    let backendResult = {
        success: false,
        status: "Pending",
        message: ""
    };

    // 3. Dispatch to secure backend endpoint
    try {
        console.log(`[Alerts] POSTing emergency payload to ${backendUrl}...`);
        const response = await fetch(backendUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(payload)
        });

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.success) {
            backendResult = {
                success: true,
                status: "Alert Delivered (Email to Caregivers)",
                message: data.message || "Emergency email successfully delivered to caregiver contacts."
            };
        } else {
            backendResult = {
                success: false,
                status: "Alert Failed (Server Error)",
                message: data.message || `Backend responded with HTTP status ${response.status}.`
            };
        }
    } catch (err) {
        console.warn("[Alerts] Network fetch to backend failed:", err.message);
        backendResult = {
            success: false,
            status: "Alert Failed (Network Error)",
            message: `Could not reach backend API (${err.message}). Local alarm active.`
        };
    }

    // 4. Optional custom webhook dispatch (if configured in settings)
    if (alertConfig.webhookUrl) {
        try {
            await fetch(alertConfig.webhookUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        } catch (wErr) {
            console.warn("[Alerts] Custom webhook POST failed:", wErr.message);
        }
    }

    return backendResult;
}

// Request permission on script load
document.addEventListener("DOMContentLoaded", () => {
    initAlertPermissions();
});
