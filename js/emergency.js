/**
 * Alpha Squared - Emergency Handling & Fall Debounce Engine
 */

let lastEmergencyTime = 0;
const DEBOUNCE_INTERVAL_MS = 15000; // 15 seconds duplicate event protection
let fallCountdownTimer = null;
let fallSecondsLeft = 10;

/**
 * Triggers an Emergency Event with GPS acquisition, duplicate-event protection & backend dispatch
 * 
 * @param {string} emergencyType 'Manual SOS Triggered' | 'Fall Detected' | 'Critical Vitals Alarm'
 * @param {Object} currentVitals Current telemetry vitals
 * @param {Object|null} locationData Optional pre-fetched location; if null, will fetch live GPS
 * @returns {Promise<Object>} The registered emergency event
 */
async function triggerEmergencyEvent(emergencyType, currentVitals = {}, locationData = null) {
    const now = Date.now();

    // Duplicate-event protection / debouncing
    if (now - lastEmergencyTime < DEBOUNCE_INTERVAL_MS) {
        console.warn(`[Emergency] Duplicate event '${emergencyType}' debounced (< 15s since last trigger).`);
        const history = JSON.parse(localStorage.getItem("alpha_emergency_history") || "[]");
        return history[0] || null;
    }

    lastEmergencyTime = now;
    const eventId = "EMG_" + now;

    // 1. Ensure GPS Location is captured
    let finalLocation = locationData;
    if (!finalLocation || typeof finalLocation.available === 'undefined') {
        try {
            console.log("[Emergency] Fetching live GPS location for emergency dispatch...");
            finalLocation = await getCurrentPatientLocation({ timeout: 5000 });
        } catch (locErr) {
            console.warn("[Emergency] Error acquiring GPS location:", locErr);
            finalLocation = {
                available: false,
                latitude: null,
                longitude: null,
                statusText: "GPS lookup failed",
                error: locErr.message
            };
        }
    }

    // 2. Dispatch to backend API (Gmail + Extensible hooks)
    const patientName = currentVitals.patientName || "Eleanor Vance";
    const patientId = currentVitals.patientId || "ESP32_ALPHA_01";
    const timestampStr = new Date().toLocaleString();

    let alertResult = { success: false, status: "Dispatching...", message: "" };
    try {
        alertResult = await dispatchCaregiverAlert({
            eventId: eventId,
            type: emergencyType,
            patientName: patientName,
            patientId: patientId,
            vitals: currentVitals,
            location: finalLocation,
            timestamp: timestampStr
        });
    } catch (dispErr) {
        console.error("[Emergency] Alert dispatch error:", dispErr);
        alertResult = {
            success: false,
            status: "Alert Dispatch Failed",
            message: dispErr.message
        };
    }

    // 3. Construct persistent Emergency Record
    const emergencyEvent = {
        eventId: eventId,
        type: emergencyType,
        patientName: patientName,
        patientId: patientId,
        timestamp: timestampStr,
        rawTimestamp: now,
        heartRate: currentVitals.heartRate || 0,
        spo2: currentVitals.spo2 || 0,
        temperature: currentVitals.temperature || 0,
        latitude: (finalLocation && finalLocation.latitude) ? finalLocation.latitude : DEFAULT_COORDS.lat,
        longitude: (finalLocation && finalLocation.longitude) ? finalLocation.longitude : DEFAULT_COORDS.lng,
        locationAvailable: finalLocation ? finalLocation.available : false,
        locationStatusText: finalLocation ? finalLocation.statusText : "Unknown",
        mapsUrl: finalLocation ? finalLocation.mapsUrl : null,
        status: "Active",
        acknowledged: false,
        alertStatus: alertResult.status,
        alertDetails: alertResult.message,
        alertSuccess: alertResult.success
    };

    // 4. Save event to Firebase DB if connected
    if (typeof db !== 'undefined' && db) {
        try {
            db.ref('healthMonitoring/emergencies/' + eventId).set(emergencyEvent);
        } catch (fbErr) {
            console.warn("[Emergency] Firebase save error:", fbErr);
        }
    }

    // Always save to LocalStorage history
    try {
        const history = JSON.parse(localStorage.getItem("alpha_emergency_history") || "[]");
        history.unshift(emergencyEvent);
        // Keep last 30 events
        if (history.length > 30) history.pop();
        localStorage.setItem("alpha_emergency_history", JSON.stringify(history));
    } catch (lsErr) {
        console.warn("[Emergency] LocalStorage save error:", lsErr);
    }

    // 5. Play audible emergency siren
    playEmergencySiren();

    console.log("[Emergency] Emergency Event Registered successfully:", emergencyEvent);
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

    fallCountdownTimer = setInterval(async () => {
        fallSecondsLeft--;
        timerDisplay.textContent = fallSecondsLeft;

        if (fallSecondsLeft <= 0) {
            clearInterval(fallCountdownTimer);
            fallCountdownTimer = null;
            modal.classList.remove("active");
            
            // Auto trigger emergency
            console.log("[Emergency] Fall countdown expired. Auto-dispatching emergency event...");
            const event = await triggerEmergencyEvent("Fall Detected", currentVitals);
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
