/**
 * Alpha Squared - Alert Notifications & Siren Dispatch Engine
 * 
 * Secure Architecture:
 * - Credentials (Gmail, Twilio, etc.) NEVER stored or handled in frontend.
 * - Emergency alerts are securely POSTed to the backend API endpoint (/api/emergency/dispatch).
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
 * Dispatches emergency notification to Caregiver via secure backend (Email + Twilio Voice Call + Webhooks)
 * 
 * @param {Object} emergencyDetails {
 *   eventId: string,
 *   type: string,
 *   patientName?: string,
 *   patientId?: string,
 *   vitals: Object,
 *   location: Object { available, latitude, longitude, accuracy, mapsUrl, statusText },
 *   timestamp?: string,
 *   isTest?: boolean,
 *   explicitTestCall?: boolean
 * }
 * @returns {Promise<Object>} { success: boolean, status: string, message: string, delivery?: Object }
 */
async function dispatchCaregiverAlert(emergencyDetails) {
    console.log("[Alerts] Dispatching caregiver emergency notification...", emergencyDetails);

    // 1. Fire native browser push notification
    const patientName = emergencyDetails.patientName || "Eleanor Vance";
    const hr = emergencyDetails.vitals ? (emergencyDetails.vitals.heartRate || (emergencyDetails.vitals.heart_rate && emergencyDetails.vitals.heart_rate.value)) : '--';
    const temp = emergencyDetails.vitals ? (emergencyDetails.vitals.temperature || (emergencyDetails.vitals.temperature && emergencyDetails.vitals.temperature.value)) : '--';

    triggerNativePushNotification(
        `🚨 EMERGENCY ALERT: ${emergencyDetails.type}`,
        `Patient ${patientName} needs help! HR: ${hr} BPM, Temp: ${temp} °C`
    );

    // 2. Read backend endpoint configuration
    const alertConfig = JSON.parse(localStorage.getItem("alpha_alert_api_config") || "{}");
    let apiBase = (alertConfig.apiBaseUrl || alertConfig.backendUrl || "").trim();
    if (!apiBase || apiBase.includes("your-project") || !apiBase.startsWith("http")) {
        apiBase = "https://alpha-squared-iooot.vercel.app";
    } else {
        apiBase = apiBase.replace(/\/+$/, "").replace(/\/api\/(send-email-alert|emergency\/dispatch)$/, "");
    }

    const dispatchUrl = `${apiBase}/api/emergency/dispatch`;
    const fallbackEmailUrl = `${apiBase}/api/send-email-alert`;

    const payload = {
        source: emergencyDetails.isTest ? "test_alert" : "emergency_dispatch",
        eventId: emergencyDetails.eventId,
        type: emergencyDetails.type,
        patientName: patientName,
        patientId: emergencyDetails.patientId || "ALPHA-001",
        vitals: emergencyDetails.vitals,
        location: emergencyDetails.location || {
            available: false,
            latitude: null,
            longitude: null,
            statusText: "Location not provided"
        },
        timestamp: emergencyDetails.timestamp || new Date().toLocaleString(),
        isTest: Boolean(emergencyDetails.isTest),
        explicitTestCall: Boolean(emergencyDetails.explicitTestCall)
    };

    let backendResult = {
        success: false,
        status: "Pending",
        message: "",
        delivery: null
    };

    // 3. Dispatch to unified emergency endpoint
    try {
        console.log(`[Alerts] POSTing to ${dispatchUrl}...`);
        let response = await fetch(dispatchUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });

        // Fallback to legacy email endpoint if dispatch is not found
        if (!response.ok && response.status === 404) {
            console.log(`[Alerts] Fallback to legacy endpoint ${fallbackEmailUrl}...`);
            response = await fetch(fallbackEmailUrl, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
            });
        }

        const data = await response.json().catch(() => ({}));

        if (response.ok && data.success) {
            const callStatus = data.delivery && data.delivery.phone_call ? data.delivery.phone_call.status : "Standby";
            const emailStatus = data.delivery && data.delivery.email ? data.delivery.email.status : "Delivered";

            backendResult = {
                success: true,
                status: `Alert Delivered (Email: ${emailStatus}, Call: ${callStatus})`,
                message: data.message || "Emergency alert successfully dispatched to caregivers.",
                delivery: data.delivery,
                callStatus: callStatus
            };
        } else {
            backendResult = {
                success: false,
                status: "Alert Failed",
                message: data.message || `Backend responded with HTTP status ${response.status}.`
            };
        }
    } catch (err) {
        console.warn("[Alerts] Network fetch to backend failed:", err.message);
        backendResult = {
            success: false,
            status: "Alert Standby (Network Error)",
            message: `Could not reach backend API (${err.message}). Local sirens & alarms active.`
        };
    }

    // 4. Optional custom webhook dispatch
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
