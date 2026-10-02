/**
 * Alpha Squared - Health Readings & Emergency History Table Engine
 */

function loadHistoryData() {
    const tableBody = document.getElementById("history-table-body");
    const emergencyList = document.getElementById("emergency-log-body");

    // Fetch history from Firebase or LocalStorage fallback
    let emergencyEvents = [];
    
    if (typeof db !== 'undefined' && db) {
        db.ref('healthMonitoring/emergencies').on('value', (snapshot) => {
            const data = snapshot.val();
            if (data) {
                emergencyEvents = Object.values(data);
                renderEmergencyHistory(emergencyEvents);
            }
        });
    } else {
        const localData = localStorage.getItem("alpha_emergency_history");
        if (localData) {
            try {
                emergencyEvents = JSON.parse(localData);
            } catch (e) {
                console.error("Error parsing emergency history:", e);
            }
        }
        
        // Inject demo sample emergencies if empty
        if (emergencyEvents.length === 0) {
            emergencyEvents = [
                {
                    eventId: "EMG_1001",
                    type: "Manual SOS Triggered",
                    timestamp: new Date(Date.now() - 3600000).toLocaleString(),
                    heartRate: 110,
                    spo2: 95,
                    temperature: 37.1,
                    status: "Resolved",
                    alertStatus: "Alert Sent"
                },
                {
                    eventId: "EMG_1002",
                    type: "Fall Detected",
                    timestamp: new Date(Date.now() - 7200000).toLocaleString(),
                    heartRate: 124,
                    spo2: 93,
                    temperature: 36.9,
                    status: "Acknowledged",
                    alertStatus: "Alert Sent"
                }
            ];
        }
        renderEmergencyHistory(emergencyEvents);
    }
}

function renderEmergencyHistory(events) {
    const container = document.getElementById("emergency-log-body");
    if (!container) return;

    if (events.length === 0) {
        container.innerHTML = `<tr><td colspan="7" style="text-align:center; padding:1.5rem; color:#64748b;">No emergency events recorded.</td></tr>`;
        return;
    }

    container.innerHTML = events.map(evt => `
        <tr>
            <td style="font-family:monospace; font-weight:700;">${evt.eventId || 'EMG_N/A'}</td>
            <td><span class="vital-status-pill critical">${evt.type}</span></td>
            <td>${evt.timestamp}</td>
            <td>${evt.heartRate} BPM / ${evt.spo2}% / ${evt.temperature} °C</td>
            <td>${evt.latitude ? evt.latitude.toFixed(4) + ', ' + evt.longitude.toFixed(4) : 'Demo Coords'}</td>
            <td><span class="vital-status-pill ${evt.status === 'Active' ? 'critical' : 'normal'}">${evt.status}</span></td>
            <td><span class="mode-badge ${evt.alertStatus === 'Alert Sent' ? 'live' : 'demo'}">${evt.alertStatus}</span></td>
        </tr>
    `).join("");
}

document.addEventListener("DOMContentLoaded", () => {
    if (window.location.pathname.includes("history.html")) {
        loadHistoryData();
    }
});
