/**
 * Alpha Squared - Emergency Alert & Caregiver Notification Manager
 */

let audioContext = null;
let sirenInterval = null;

// Synthesize Emergency Siren Sound via Web Audio API (No external sound file dependency required)
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

/**
 * Dispatches notification to Caregiver and returns notification status string.
 * Status can be: 'Alert Sent' | 'Alert Failed' | 'Not Configured'
 */
function dispatchCaregiverAlert(emergencyDetails) {
    console.log("[Alerts] Processing emergency notification...", emergencyDetails);

    const webhookConfigured = false; // Set to true when backend integration is live

    if (!webhookConfigured) {
        return {
            status: "Not Configured",
            message: "Caregiver Email/SMS notification provider is in placeholder mode (backend/alerts/email-alert.js)."
        };
    }

    return {
        status: "Alert Sent",
        message: "Emergency SMS/Email successfully transmitted to Primary Caregiver."
    };
}
