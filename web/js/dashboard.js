/**
 * Alpha Squared - Live Dashboard & Real-Time Sync Controller
 * Manages REST API telemetry polling, status updating, chart rendering, and emergency triggers.
 */

let demoInterval = null;
let currentVitalsState = {
    heartRate: null,
    heartRateStatus: "disconnected",
    temperature: null,
    temperatureStatus: "disconnected",
    spo2: null,
    spo2Status: "not_installed",
    fallDetected: false,
    sos: false,
    latitude: null,
    longitude: null,
    gpsFixValid: false,
    gpsStatus: "no_fix",
    sim800lStatus: "unknown",
    timestamp: Date.now()
};

document.addEventListener("DOMContentLoaded", () => {
    initDashboard();
});

function initDashboard() {
    console.log("[Dashboard] Initializing health monitoring dashboard...");
    
    // Initialize charts and Leaflet map
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
                stopLiveStream();
                startDemoSimulationStream();
            } else {
                stopDemoSimulationStream();
                startLiveStream();
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
                    currentVitalsState.gpsFixValid = true;
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
        startLiveStream();
    }
}

let apiPollInterval = null;

function stopRestApiStream() {
    if (apiPollInterval) {
        clearInterval(apiPollInterval);
        apiPollInterval = null;
    }
}

function getApiBaseUrl() {
    let devCfg = {};
    try {
        devCfg = JSON.parse(localStorage.getItem("alpha_device_config") || "{}");
    } catch (_) {}

    let apiBase = (devCfg.apiBaseUrl || "").trim().replace(/\/+$/, "");
    if (!apiBase) {
        if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
            apiBase = window.location.origin;
        } else {
            apiBase = "https://alpha-squared-iooot.vercel.app";
        }
    }
    return apiBase;
}

function getDeviceId() {
    let devCfg = {};
    try {
        devCfg = JSON.parse(localStorage.getItem("alpha_device_config") || "{}");
    } catch (_) {}
    return (devCfg.deviceId || "ALPHA-001").trim();
}

function startLiveStream() {
    stopDemoSimulationStream();
    connectRestApiStream();
    fetchAndPopulateHistoryChart();
}

function stopLiveStream() {
    stopRestApiStream();
}

/**
 * Pre-populates historical biometric trend chart using stored readings from MongoDB
 */
async function fetchAndPopulateHistoryChart() {
    if (getSystemMode() === "DEMO MODE") return;

    const apiBase = getApiBaseUrl();
    const deviceId = getDeviceId();
    const historyUrl = `${apiBase}/api/iot/device/${encodeURIComponent(deviceId)}/history?range=1h&limit=15`;

    try {
        const res = await fetch(historyUrl);
        if (res.ok) {
            const data = await res.json();
            if (data && data.success && Array.isArray(data.data) && data.data.length > 0) {
                data.data.forEach(item => {
                    const timeLabel = new Date(item.time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    pushChartDataPoint(timeLabel, item.heart_rate, null, item.temperature);
                });
            }
        }
    } catch (e) {
        console.debug("[Dashboard] History prefetch standby:", e.message);
    }
}

/**
 * Polls MongoDB Atlas backend via /api/iot/device/:id/latest & /status
 */
function connectRestApiStream() {
    stopRestApiStream();

    const apiBase = getApiBaseUrl();
    const deviceId = getDeviceId();
    const latestUrl = `${apiBase}/api/iot/device/${encodeURIComponent(deviceId)}/latest`;
    const statusUrl = `${apiBase}/api/iot/device/${encodeURIComponent(deviceId)}/status`;

    console.log(`[Dashboard] Connecting to live REST stream: ${latestUrl}`);

    async function pollLatestReading() {
        if (getSystemMode() === "DEMO MODE") return;

        try {
            const res = await fetch(latestUrl, { method: "GET" });
            if (!res.ok) {
                if (res.status === 404) {
                    updateDeviceStatusUI({ online: false, message: "Device not registered" });
                } else {
                    updateDeviceStatusUI({ online: false, message: `HTTP ${res.status}` });
                }
                return;
            }
            const data = await res.json();
            if (data && data.success && data.has_data && data.reading) {
                const r = data.reading;

                currentVitalsState.heartRate = (r.heart_rate && r.heart_rate.status === 'ok' && typeof r.heart_rate.value === 'number') ? r.heart_rate.value : null;
                currentVitalsState.heartRateStatus = (r.heart_rate && r.heart_rate.status) ? r.heart_rate.status : 'disconnected';

                currentVitalsState.temperature = (r.temperature && r.temperature.status === 'ok' && typeof r.temperature.value === 'number') ? r.temperature.value : null;
                currentVitalsState.temperatureStatus = (r.temperature && r.temperature.status) ? r.temperature.status : 'disconnected';

                currentVitalsState.gpsFixValid = Boolean(r.gps && r.gps.fix_valid);
                currentVitalsState.gpsStatus = (r.gps && r.gps.status) ? r.gps.status : (currentVitalsState.gpsFixValid ? 'ok' : 'no_fix');
                currentVitalsState.latitude = (r.gps && currentVitalsState.gpsFixValid && typeof r.gps.latitude === 'number') ? r.gps.latitude : null;
                currentVitalsState.longitude = (r.gps && currentVitalsState.gpsFixValid && typeof r.gps.longitude === 'number') ? r.gps.longitude : null;

                currentVitalsState.sim800lStatus = (r.sim800l && r.sim800l.status) ? r.sim800l.status : 'unknown';

                if (r.timestamp || r.server_received_at) {
                    currentVitalsState.timestamp = new Date(r.server_received_at || r.timestamp).getTime();
                }

                updateDashboardUI(currentVitalsState);

                // Device online evaluation
                const lastSeenMs = new Date(r.server_received_at || r.timestamp).getTime();
                const isOnline = (Date.now() - lastSeenMs) < 60000;
                updateDeviceStatusUI({
                    online: isOnline,
                    lastSeen: lastSeenMs,
                    ds18b20: currentVitalsState.temperatureStatus,
                    max30102: currentVitalsState.heartRateStatus,
                    gps: currentVitalsState.gpsFixValid ? 'fix_acquired' : 'no_fix',
                    sim800l: currentVitalsState.sim800lStatus
                });
            } else if (data && data.success && !data.has_data) {
                updateDeviceStatusUI({ online: false, message: "No readings recorded yet" });
                updateDashboardEmptyState();
            }
        } catch (err) {
            console.debug("[Dashboard] REST API polling standby:", err.message);
            updateDeviceStatusUI({ online: false, message: "API Connection Error" });
        }
    }

    pollLatestReading();
    apiPollInterval = setInterval(pollLatestReading, 3000);
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

function startDemoSimulationStream() {
    stopDemoSimulationStream();
    console.log("[Dashboard] Demo simulation stream active.");

    currentVitalsState.heartRate = 75;
    currentVitalsState.heartRateStatus = "ok";
    currentVitalsState.temperature = 36.6;
    currentVitalsState.temperatureStatus = "ok";
    currentVitalsState.spo2 = 98;
    currentVitalsState.latitude = 28.6139;
    currentVitalsState.longitude = 77.2090;
    currentVitalsState.gpsFixValid = true;
    currentVitalsState.gpsStatus = "ok";
    currentVitalsState.sim800lStatus = "ready";

    demoInterval = setInterval(() => {
        // Realistic biological simulation
        if (currentVitalsState.heartRate !== null) {
            currentVitalsState.heartRate = Math.min(130, Math.max(55, currentVitalsState.heartRate + Math.floor(Math.random() * 5) - 2));
        }
        if (currentVitalsState.temperature !== null) {
            currentVitalsState.temperature = parseFloat((36.5 + (Math.random() * 0.4 - 0.2)).toFixed(1));
        }
        if (currentVitalsState.spo2 !== null) {
            currentVitalsState.spo2 = Math.min(100, Math.max(92, currentVitalsState.spo2 + Math.floor(Math.random() * 3) - 1));
        }
        currentVitalsState.timestamp = Date.now();

        updateDashboardUI(currentVitalsState);
        updateDeviceStatusUI({
            online: true,
            lastSeen: Date.now(),
            ds18b20: "ok",
            max30102: "ok",
            gps: "fix_acquired",
            sim800l: "ready"
        });
    }, 2500);
}

function stopDemoSimulationStream() {
    if (demoInterval) {
        clearInterval(demoInterval);
        demoInterval = null;
    }
}

function updateDashboardEmptyState() {
    const hrEl = document.getElementById("val-heart-rate");
    const tempEl = document.getElementById("val-temp");
    const timeEl = document.getElementById("val-last-updated");
    const hrPill = document.getElementById("pill-hr-status");
    const tempPill = document.getElementById("pill-temp-status");

    if (hrEl) hrEl.textContent = "--";
    if (tempEl) tempEl.textContent = "--";
    if (timeEl) timeEl.textContent = "No data received";

    if (hrPill) {
        hrPill.className = "vital-status-pill critical";
        hrPill.textContent = "NO READINGS";
    }
    if (tempPill) {
        tempPill.className = "vital-status-pill critical";
        tempPill.textContent = "NO READINGS";
    }

    updatePatientLocation(null, null, false);
}

function updateDashboardUI(vitals) {
    // 1. Update Numeric Cards safely without 0 BPM for missing sensors
    const hrEl = document.getElementById("val-heart-rate");
    const spo2El = document.getElementById("val-spo2");
    const tempEl = document.getElementById("val-temp");
    const timeEl = document.getElementById("val-last-updated");

    if (hrEl) {
        if (typeof vitals.heartRate === "number" && vitals.heartRate > 0 && vitals.heartRateStatus === "ok") {
            hrEl.textContent = vitals.heartRate;
        } else {
            hrEl.textContent = "--";
        }
    }

    if (spo2El) {
        if (typeof vitals.spo2 === "number" && vitals.spo2 > 0) {
            spo2El.textContent = vitals.spo2;
        } else {
            spo2El.textContent = "N/A";
        }
    }

    if (tempEl) {
        if (typeof vitals.temperature === "number" && vitals.temperatureStatus === "ok") {
            tempEl.textContent = vitals.temperature.toFixed(1);
        } else {
            tempEl.textContent = "--";
        }
    }

    if (timeEl) {
        if (vitals.timestamp) {
            timeEl.textContent = new Date(vitals.timestamp).toLocaleTimeString();
        } else {
            timeEl.textContent = "Just Now";
        }
    }

    // 2. Centralized Health Evaluation (only evaluate valid numeric readings)
    const evalInput = {
        heartRate: vitals.heartRateStatus === 'ok' ? vitals.heartRate : 75,
        spo2: vitals.spo2 || 98,
        temperature: vitals.temperatureStatus === 'ok' ? vitals.temperature : 36.6,
        fallDetected: vitals.fallDetected,
        sos: vitals.sos
    };
    const evaluation = evaluateHealthStatus(evalInput);
    
    // 3. Update Overall Patient Status Card
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

    // 4. Update Metric Status Pills
    const hrPill = document.getElementById("pill-hr-status");
    const spo2Pill = document.getElementById("pill-spo2-status");
    const tempPill = document.getElementById("pill-temp-status");

    if (hrPill) {
        if (vitals.heartRateStatus === "ok" && typeof vitals.heartRate === "number") {
            hrPill.className = `vital-status-pill ${evaluation.vitalStatuses.heartRate}`;
            hrPill.textContent = evaluation.vitalStatuses.heartRate.toUpperCase();
        } else {
            hrPill.className = "vital-status-pill critical";
            hrPill.textContent = vitals.heartRateStatus === "disconnected" ? "DISCONNECTED" : "UNAVAILABLE";
        }
    }

    if (spo2Pill) {
        if (vitals.spo2) {
            spo2Pill.className = `vital-status-pill ${evaluation.vitalStatuses.spo2}`;
            spo2Pill.textContent = evaluation.vitalStatuses.spo2.toUpperCase();
        } else {
            spo2Pill.className = "vital-status-pill";
            spo2Pill.style.background = "rgba(148, 163, 184, 0.2)";
            spo2Pill.style.color = "#94a3b8";
            spo2Pill.textContent = "NOT INSTALLED";
        }
    }

    if (tempPill) {
        if (vitals.temperatureStatus === "ok" && typeof vitals.temperature === "number") {
            tempPill.className = `vital-status-pill ${evaluation.vitalStatuses.temperature}`;
            tempPill.textContent = evaluation.vitalStatuses.temperature.toUpperCase();
        } else {
            tempPill.className = "vital-status-pill critical";
            tempPill.textContent = vitals.temperatureStatus === "disconnected" ? "DISCONNECTED" : "UNAVAILABLE";
        }
    }

    // 5. Update Location Map
    updatePatientLocation(vitals.latitude, vitals.longitude, vitals.gpsFixValid, vitals.timestamp);

    // 6. Push to Trend Charts
    if (vitals.timestamp) {
        const timeLabel = new Date(vitals.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        pushChartDataPoint(
            timeLabel,
            vitals.heartRateStatus === 'ok' ? vitals.heartRate : null,
            vitals.spo2 || null,
            vitals.temperatureStatus === 'ok' ? vitals.temperature : null
        );
    }

    // 7. Check Fall Detection Event
    if (vitals.fallDetected) {
        startFallConfirmation(vitals, (confirmedEvent) => {
            window.location.href = "emergency.html";
        });
    }
}

function updateDeviceStatusUI(deviceData) {
    const badge = document.getElementById("device-status-badge");
    const apiConnSpan = document.getElementById("status-api-connection");
    const ds18b20Span = document.getElementById("status-sensor-ds18b20");
    const max30102Span = document.getElementById("status-sensor-max30102");
    const gpsSpan = document.getElementById("status-sensor-gps");
    const sim800lSpan = document.getElementById("status-sensor-sim800l");

    const isOnline = Boolean(deviceData && deviceData.online);

    if (badge) {
        if (isOnline) {
            badge.className = "vital-status-pill normal";
            badge.textContent = "ESP32 ONLINE";
        } else {
            badge.className = "vital-status-pill critical";
            badge.textContent = deviceData.message ? `DEVICE OFFLINE (${deviceData.message})` : "DEVICE OFFLINE";
        }
    }

    if (apiConnSpan) {
        apiConnSpan.className = isOnline ? "vital-status-pill normal" : "vital-status-pill critical";
        apiConnSpan.textContent = isOnline ? "CONNECTED" : (deviceData.message || "OFFLINE");
    }

    if (ds18b20Span) {
        const status = deviceData.ds18b20 || (isOnline ? "ok" : "disconnected");
        ds18b20Span.className = status === "ok" ? "vital-status-pill normal" : "vital-status-pill critical";
        ds18b20Span.textContent = status === "ok" ? "ONLINE" : status.toUpperCase();
    }

    if (max30102Span) {
        const status = deviceData.max30102 || (isOnline ? "ok" : "disconnected");
        max30102Span.className = status === "ok" ? "vital-status-pill normal" : "vital-status-pill critical";
        max30102Span.textContent = status === "ok" ? "ONLINE" : status.toUpperCase();
    }

    if (gpsSpan) {
        const status = deviceData.gps || (currentVitalsState.gpsFixValid ? "fix_acquired" : "no_fix");
        gpsSpan.className = status === "fix_acquired" ? "vital-status-pill normal" : "vital-status-pill critical";
        gpsSpan.textContent = status === "fix_acquired" ? "FIX ACQUIRED" : "NO FIX";
    }

    if (sim800lSpan) {
        const status = (deviceData.sim800l || currentVitalsState.sim800lStatus || "unknown").toLowerCase();
        if (status === "ready" || status === "ok" || status === "submitted") {
            sim800lSpan.className = "vital-status-pill normal";
            sim800lSpan.textContent = "READY / ACTIVE";
        } else {
            sim800lSpan.className = "vital-status-pill";
            sim800lSpan.style.background = "rgba(148, 163, 184, 0.2)";
            sim800lSpan.style.color = "#94a3b8";
            sim800lSpan.textContent = status.toUpperCase();
        }
    }
}

// Global Demo Trigger Actions for Hackathon Showcase
function simulateDemoFall() {
    currentVitalsState.fallDetected = true;
    updateDashboardUI(currentVitalsState);
}

function simulateDemoCriticalVitals() {
    currentVitalsState.heartRate = 145;
    currentVitalsState.heartRateStatus = "ok";
    currentVitalsState.spo2 = 88;
    updateDashboardUI(currentVitalsState);
}
