/**
 * Alpha Squared - Live Dashboard & Real-Time Sync Controller
 */

let demoInterval = null;
let currentVitalsState = {
    heartRate: 75,
    spo2: 98,
    temperature: 36.6,
    fallDetected: false,
    sos: false,
    latitude: 28.6139,
    longitude: 77.2090,
    timestamp: Date.now()
};

document.addEventListener("DOMContentLoaded", () => {
    initDashboard();
});

function initDashboard() {
    console.log("[Dashboard] Initializing health monitoring dashboard...");
    
    // Initialize charts and map
    initVitalsCharts();
    initLeafletMap("map-container");

    // Mode Toggle Switch Event Listener
    const modeToggleBtn = document.getElementById("btn-toggle-demo");
    if (modeToggleBtn) {
        modeToggleBtn.addEventListener("click", () => {
            const currentMode = getSystemMode();
            const newDemoState = (currentMode === "LIVE DEVICE");
            setDemoModeState(newDemoState);
            updateModeBadgeUI();
            if (newDemoState) {
                startDemoSimulationStream();
            } else {
                stopDemoSimulationStream();
                connectFirebaseRealtimeStream();
            }
        });
    }

    // SOS Button Listener
    const sosBtn = document.getElementById("btn-trigger-sos");
    if (sosBtn) {
        sosBtn.addEventListener("click", () => {
            const confirmSOS = confirm("🚨 ARE YOU SURE YOU WANT TO TRIGGER AN EMERGENCY SOS ALARM?");
            if (confirmSOS) {
                currentVitalsState.sos = true;
                const event = triggerEmergencyEvent("Manual SOS Triggered", currentVitalsState);
                window.location.href = "emergency.html";
            }
        });
    }

    // Fall Cancel Modal Listener
    const cancelFallBtn = document.getElementById("btn-cancel-fall");
    if (cancelFallBtn) {
        cancelFallBtn.addEventListener("click", () => {
            cancelFallConfirmation();
            currentVitalsState.fallDetected = false;
            updateDashboardUI(currentVitalsState);
        });
    }

    // Start Realtime Stream or Demo Stream based on system mode
    updateModeBadgeUI();
    if (getSystemMode() === "DEMO MODE") {
        startDemoSimulationStream();
    } else {
        connectFirebaseRealtimeStream();
    }
}

function updateModeBadgeUI() {
    const badge = document.getElementById("system-mode-badge");
    const modeText = document.getElementById("system-mode-text");
    const currentMode = getSystemMode();

    if (badge && modeText) {
        modeText.textContent = currentMode;
        if (currentMode === "DEMO MODE") {
            badge.className = "mode-badge demo";
        } else {
            badge.className = "mode-badge live";
        }
    }
}

function connectFirebaseRealtimeStream() {
    const database = getDatabase();
    if (!database) {
        console.warn("[Dashboard] Firebase unavailable. Auto-enabling DEMO SIMULATION MODE.");
        setDemoModeState(true);
        updateModeBadgeUI();
        startDemoSimulationStream();
        return;
    }

    // Listen to Firebase Realtime currentVitals path
    database.ref("healthMonitoring/currentVitals").on("value", (snapshot) => {
        const data = snapshot.val();
        if (data) {
            currentVitalsState = data;
            updateDashboardUI(data);
        }
    }, (error) => {
        console.error("[Dashboard] Firebase listener error:", error);
    });

    // Listen to Device Online Status
    database.ref("healthMonitoring/device").on("value", (snapshot) => {
        const deviceData = snapshot.val();
        updateDeviceStatusUI(deviceData);
    });
}

function startDemoSimulationStream() {
    stopDemoSimulationStream();
    console.log("[Dashboard] Demo data simulation stream active.");

    demoInterval = setInterval(() => {
        // Generate realistic biological fluctuation
        currentVitalsState.heartRate = Math.min(130, Math.max(55, currentVitalsState.heartRate + Math.floor(Math.random() * 5) - 2));
        currentVitalsState.spo2 = Math.min(100, Math.max(92, currentVitalsState.spo2 + Math.floor(Math.random() * 3) - 1));
        currentVitalsState.temperature = parseFloat((36.5 + (Math.random() * 0.4 - 0.2)).toFixed(1));
        currentVitalsState.timestamp = Date.now();

        updateDashboardUI(currentVitalsState);
        updateDeviceStatusUI({ online: true, lastSeen: Date.now() });
    }, 2500);
}

function stopDemoSimulationStream() {
    if (demoInterval) {
        clearInterval(demoInterval);
        demoInterval = null;
    }
}

function updateDashboardUI(vitals) {
    // 1. Update Numeric Cards
    const hrEl = document.getElementById("val-heart-rate");
    const spo2El = document.getElementById("val-spo2");
    const tempEl = document.getElementById("val-temp");
    const timeEl = document.getElementById("val-last-updated");

    if (hrEl) hrEl.textContent = vitals.heartRate || "--";
    if (spo2El) spo2El.textContent = vitals.spo2 || "--";
    if (tempEl) tempEl.textContent = vitals.temperature ? vitals.temperature.toFixed(1) : "--";
    if (timeEl) timeEl.textContent = new Date().toLocaleTimeString();

    // 2. Centralized Health Evaluation
    const evaluation = evaluateHealthStatus(vitals);
    
    // 3. Update Overall Status Card UI
    const statusCard = document.getElementById("overall-status-card");
    const statusText = document.getElementById("overall-status-text");
    const statusIcon = document.getElementById("overall-status-icon");
    const statusReasons = document.getElementById("overall-status-reasons");

    if (statusCard && statusText) {
        statusCard.className = `status-card ${evaluation.status}`;
        statusText.textContent = evaluation.status;
        
        if (evaluation.status === "SAFE") {
            if (statusIcon) statusIcon.textContent = "✅";
            if (statusReasons) statusReasons.textContent = "All biometrics within normal health thresholds.";
        } else if (evaluation.status === "WARNING") {
            if (statusIcon) statusIcon.textContent = "⚠️";
            if (statusReasons) statusReasons.textContent = evaluation.reasons.join(" | ");
        } else if (evaluation.status === "EMERGENCY") {
            if (statusIcon) statusIcon.textContent = "🚨";
            if (statusReasons) statusReasons.textContent = evaluation.reasons.join(" | ");
        }
    }

    // 4. Update Card Status Pills
    const hrPill = document.getElementById("pill-hr-status");
    const spo2Pill = document.getElementById("pill-spo2-status");
    const tempPill = document.getElementById("pill-temp-status");

    if (hrPill) {
        hrPill.className = `vital-status-pill ${evaluation.vitalStatuses.heartRate}`;
        hrPill.textContent = evaluation.vitalStatuses.heartRate.toUpperCase();
    }
    if (spo2Pill) {
        spo2Pill.className = `vital-status-pill ${evaluation.vitalStatuses.spo2}`;
        spo2Pill.textContent = evaluation.vitalStatuses.spo2.toUpperCase();
    }
    if (tempPill) {
        tempPill.className = `vital-status-pill ${evaluation.vitalStatuses.temperature}`;
        tempPill.textContent = evaluation.vitalStatuses.temperature.toUpperCase();
    }

    // 5. Update Location Map
    updatePatientLocation(vitals.latitude, vitals.longitude);

    // 6. Push to Trend Charts
    const timeLabel = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    pushChartDataPoint(timeLabel, vitals.heartRate, vitals.spo2, vitals.temperature);

    // 7. Check Fall Detection Event
    if (vitals.fallDetected) {
        startFallConfirmation(vitals, (confirmedEvent) => {
            window.location.href = "emergency.html";
        });
    }
}

function updateDeviceStatusUI(deviceData) {
    const badge = document.getElementById("device-status-badge");
    if (!badge) return;

    if (deviceData && deviceData.online) {
        badge.className = "vital-status-pill normal";
        badge.textContent = "ESP32 ONLINE";
    } else {
        badge.className = "vital-status-pill critical";
        badge.textContent = "DEVICE OFFLINE";
    }
}

// Global Demo Trigger Actions for Hackathon Showcase
function simulateDemoFall() {
    currentVitalsState.fallDetected = true;
    updateDashboardUI(currentVitalsState);
}

function simulateDemoCriticalVitals() {
    currentVitalsState.heartRate = 145;
    currentVitalsState.spo2 = 88;
    updateDashboardUI(currentVitalsState);
}
