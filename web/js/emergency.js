/**
 * Alpha Squared - Emergency Handling & Fall Debounce Engine
 */

let lastEmergencyTime = 0;
const DEBOUNCE_INTERVAL_MS = 30000; // 30 seconds duplicate event protection
let fallCountdownTimer = null;
let fallSecondsLeft = 10;

/**
 * Triggers an Emergency Event with duplicate-event protection
 * @param {string} emergencyType 'Manual SOS Triggered' | 'Fall Detected' | 'Critical Vitals Alarm'
 * @param {Object} currentVitals
 */
function triggerEmergencyEvent(emergencyType, currentVitals) {
    const now = Date.now();

    // Basic duplicate-event protection/debouncing
    if (now - lastEmergencyTime < DEBOUNCE_INTERVAL_MS) {
        console.warn(`[Emergency] Duplicate event '${emergencyType}' debounced (< 30s since last trigger).`);
        return null;
    }

    lastEmergencyTime = now;

    const eventId = "EMG_" + now;
    const alertResult = dispatchCaregiverAlert({ eventId, type: emergencyType, vitals: currentVitals });

    const emergencyEvent = {
        eventId: eventId,
        type: emergencyType,
        timestamp: new Date().toLocaleString(),
        rawTimestamp: now,
        heartRate: currentVitals.heartRate || 0,
        spo2: currentVitals.spo2 || 0,
        temperature: currentVitals.temperature || 0,
        latitude: currentVitals.latitude || DEFAULT_COORDS.lat,
        longitude: currentVitals.longitude || DEFAULT_COORDS.lng,
        status: "Active",
        acknowledged: false,
        alertStatus: alertResult.status,
        alertDetails: alertResult.message
    };

    // Save event to Firebase DB if connected
    if (typeof db !== 'undefined' && db) {
        db.ref('healthMonitoring/emergencies/' + eventId).set(emergencyEvent);
    } else {
        // Fallback save to LocalStorage demo history
        const history = JSON.parse(localStorage.getItem("alpha_emergency_history") || "[]");
        history.unshift(emergencyEvent);
        localStorage.setItem("alpha_emergency_history", JSON.stringify(history));
    }

    // Play audible siren
    playEmergencySiren();

    console.log("[Emergency] Emergency Event Registered:", emergencyEvent);
    return emergencyEvent;
}

/**
 * Start Fall Confirmation Countdown Modal
 * Gives 10 seconds for user to cancel false alarms.
 */
function startFallConfirmation(currentVitals, onConfirmedCallback) {
    const modal = document.getElementById("fall-modal");
    const timerDisplay = document.getElementById("fall-countdown");
    if (!modal || !timerDisplay) return;

    fallSecondsLeft = 10;
    timerDisplay.textContent = fallSecondsLeft;
    modal.classList.add("active");

    if (fallCountdownTimer) clearInterval(fallCountdownTimer);

    fallCountdownTimer = setInterval(() => {
        fallSecondsLeft--;
        timerDisplay.textContent = fallSecondsLeft;

        if (fallSecondsLeft <= 0) {
            clearInterval(fallCountdownTimer);
            fallCountdownTimer = null;
            modal.classList.remove("active");
            
            // Auto trigger emergency
            const event = triggerEmergencyEvent("Fall Detected", currentVitals);
            if (onConfirmedCallback) onConfirmedCallback(event);
        }
    }, 1000);
}

function cancelFallConfirmation() {
    if (fallCountdownTimer) {
        clearInterval(fallCountdownTimer);
        fallCountdownTimer = null;
    }
    const modal = document.getElementById("fall-modal");
    if (modal) modal.classList.remove("active");
    console.log("[Emergency] Fall alarm cancelled by user (False Alarm).");
}
