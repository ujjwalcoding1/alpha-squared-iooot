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

    // SOS Button Listener with Loading, Success & Error states
    const sosBtn = document.getElementById("btn-trigger-sos");
    const sosFeedback = document.getElementById("sos-status-feedback");

    if (sosBtn) {
        sosBtn.addEventListener("click", async () => {
            const confirmSOS = confirm("🚨 ARE YOU SURE YOU WANT TO TRIGGER AN EMERGENCY SOS ALARM?\n\nThis will acquire your GPS coordinates and notify your registered caregivers immediately.");
            if (!confirmSOS) return;

            // 1. Loading State
            sosBtn.disabled = true;
            sosBtn.classList.add("loading");
            sosBtn.innerHTML = `<span>⏳</span><span style="font-size:1.1rem; letter-spacing:1px;">SENDING...</span>`;
            if (sosFeedback) {
                sosFeedback.style.color = "var(--accent-cyan)";
                sosFeedback.textContent = "📍 Acquiring GPS & notifying caregivers...";
            }

            try {
                // 2. Capture live GPS position
                const locResult = await getCurrentPatientLocation({ timeout: 5000 });
                if (sosFeedback) {
                    if (locResult.available) {
                        sosFeedback.textContent = "✓ GPS acquired. Dispatching emergency alert email...";
                    } else {
                        sosFeedback.textContent = "⚠️ GPS unavailable. Dispatching alert email without coordinates...";
                    }
                }

                // 3. Update local state and trigger emergency event
                currentVitalsState.sos = true;
                if (locResult.available) {
                    currentVitalsState.latitude = locResult.latitude;
                    currentVitalsState.longitude = locResult.longitude;
                }

                const event = await triggerEmergencyEvent("Manual SOS Triggered", currentVitalsState, locResult);

                // 4. Success vs Error State
                if (event && event.alertSuccess) {
                    sosBtn.innerHTML = `<span>✅</span><span style="font-size:1.1rem;">SENT!</span>`;
                    sosBtn.style.background = "linear-gradient(135deg, #10b981, #059669)";
                    sosBtn.style.boxShadow = "0 0 35px rgba(16, 185, 129, 0.7)";
                    if (sosFeedback) {
                        sosFeedback.style.color = "#10b981";
                        sosFeedback.textContent = "✅ Emergency email dispatched to caregivers! Opening emergency screen...";
                    }
                } else {
                    sosBtn.innerHTML = `<span>⚠️</span><span style="font-size:1rem;">ALARM ON</span>`;
                    sosBtn.style.background = "linear-gradient(135deg, #f59e0b, #d97706)";
                    if (sosFeedback) {
                        sosFeedback.style.color = "#f59e0b";
                        const errReason = (event && event.alertDetails) ? event.alertDetails : "Check server connection";
                        sosFeedback.textContent = `⚠️ Email status: ${errReason}. Local siren active!`;
                    }
                }

                // 5. Transfer to emergency screen after 1.5s delay so user sees confirmation
                setTimeout(() => {
                    window.location.href = "emergency.html";
                }, 1500);

            } catch (sosError) {
                console.error("[Dashboard] SOS trigger failed:", sosError);
                sosBtn.disabled = false;
                sosBtn.classList.remove("loading");
                sosBtn.innerHTML = `<span>🚨</span><span>SOS</span>`;
                if (sosFeedback) {
                    sosFeedback.style.color = "#ef4444";
                    sosFeedback.textContent = `❌ SOS error: ${sosError.message}. Local siren active.`;
                }
                playEmergencySiren();
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
