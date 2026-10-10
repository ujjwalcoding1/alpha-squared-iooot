/**
 * Alpha Squared - Health Readings & Emergency History Table Engine
 * Loads emergency event logs and live ESP32 telemetry.
 */

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

async function loadHistoryData() {
    const emergencyList = document.getElementById("emergency-log-body");
    if (!emergencyList) return;

    emergencyList.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:#94a3b8;">Loading telemetry & emergency logs...</td></tr>`;

    let emergencyEvents = [];

    // 1. Check LocalStorage emergency records
    const localData = localStorage.getItem("alpha_emergency_history");
    if (localData) {
        try {
            emergencyEvents = JSON.parse(localData);
        } catch (e) {
            console.error("[History] Error parsing local emergency history:", e);
        }
    }

    // 2. Query backend for latest live sensor telemetry
    const apiBase = getApiBaseUrl();
    const deviceId = getDeviceId();
    const historyUrl = `${apiBase}/api/iot/device/${encodeURIComponent(deviceId)}/history?range=all&limit=50&include_simulated=true`;

    try {
        const res = await fetch(historyUrl);
        if (res.ok) {
            const result = await res.json();
            if (result && result.success && Array.isArray(result.data) && result.data.length > 0) {
                const telemetryEvents = result.data.reverse().map((doc, idx) => ({
                    eventId: `TEL_${doc.id ? String(doc.id).substring(0, 8) : idx + 100}`,
                    type: doc.is_simulated ? "Simulated Telemetry" : "ESP32 Sensor Packet",
                    timestamp: new Date(doc.time).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" }),
                    heartRate: (doc.heart_rate_status === 'ok' && typeof doc.heart_rate === 'number') ? doc.heart_rate : '--',
                    spo2: 'N/A',
                    temperature: (doc.temperature_status === 'ok' && typeof doc.temperature === 'number') ? doc.temperature : '--',
                    latitude: doc.gps ? doc.gps.latitude : null,
                    longitude: doc.gps ? doc.gps.longitude : null,
                    status: "Live",
                    alertStatus: doc.is_simulated ? "Simulated" : "Live Reading"
                }));

                emergencyEvents = [...emergencyEvents, ...telemetryEvents];
            }
        }
    } catch (err) {
        console.debug("[History] API fetch standby:", err.message);
    }

    renderEmergencyHistory(emergencyEvents);
}

function renderEmergencyHistory(events) {
    const container = document.getElementById("emergency-log-body");
    if (!container) return;

    if (!events || events.length === 0) {
        container.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:#64748b;">No live telemetry or emergency records received yet. Connect ESP32 node to submit readings.</td></tr>`;
        return;
    }

    container.innerHTML = events.map(evt => {
        const isEmergency = (evt.type || "").toLowerCase().includes("sos") || (evt.type || "").toLowerCase().includes("fall") || (evt.type || "").toLowerCase().includes("critical");
        const hrStr = typeof evt.heartRate === 'number' ? `${evt.heartRate} BPM` : (evt.heartRate || '--');
        const tempStr = typeof evt.temperature === 'number' ? `${evt.temperature} °C` : (evt.temperature || '--');
        const gpsStr = (typeof evt.latitude === 'number' && typeof evt.longitude === 'number') 
            ? `${evt.latitude.toFixed(4)}, ${evt.longitude.toFixed(4)}` 
            : 'GPS Unavailable';

        const statusBadge = isEmergency 
            ? `<span style="background:rgba(239,68,68,0.2); color:#ef4444; padding:0.2rem 0.6rem; border-radius:12px; font-weight:600; font-size:0.8rem;">🚨 EMERGENCY</span>`
            : `<span style="background:rgba(16,185,129,0.2); color:#10b981; padding:0.2rem 0.6rem; border-radius:12px; font-weight:600; font-size:0.8rem;">✓ LOGGED</span>`;

        return `
            <tr style="${isEmergency ? 'background:rgba(239,68,68,0.05);' : ''}">
                <td style="font-family:monospace; font-weight:600; color:${isEmergency ? '#ef4444' : '#38bdf8'};">${evt.eventId || 'EVT'}</td>
                <td style="font-weight:600;">${evt.type || 'Alert'}</td>
                <td style="white-space:nowrap; color:#cbd5e1;">${evt.timestamp || '--'}</td>
                <td><strong style="color:${typeof evt.heartRate === 'number' ? '#38bdf8' : '#64748b'};">${hrStr}</strong></td>
                <td><strong style="color:${typeof evt.temperature === 'number' ? '#f59e0b' : '#64748b'};">${tempStr}</strong></td>
                <td style="font-size:0.85rem; color:#94a3b8;">${gpsStr}</td>
                <td>${statusBadge}</td>
            </tr>
        `;
    }).join("");
}

document.addEventListener("DOMContentLoaded", () => {
    loadHistoryData();
});
