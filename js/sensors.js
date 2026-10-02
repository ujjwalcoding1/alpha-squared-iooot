/**
 * Alpha Squared - Centralized Health Status Evaluation Engine
 * 
 * Rules & Clinical Thresholds (User configurable via Settings page):
 * - SAFE (NORMAL): All vitals within optimal range, no fall, no SOS.
 * - WARNING: One or more vitals slightly abnormal.
 * - EMERGENCY: Critical vitals (e.g., HR < 50 or > 120, SpO2 < 91%, Temp > 38.5), OR Fall Detected, OR Manual SOS.
 */

const DEFAULT_THRESHOLDS = {
    hrMin: 50,
    hrMax: 120,
    hrWarnLow: 60,
    hrWarnHigh: 100,
    
    spo2Critical: 91,
    spo2Warning: 94,
    
    tempMin: 35.5,
    tempMax: 38.5,
    tempWarnLow: 36.0,
    tempWarnHigh: 37.6
};

// Load thresholds from Settings or fallback to Defaults
function getHealthThresholds() {
    const saved = localStorage.getItem("alpha_health_thresholds");
    if (saved) {
        try {
            return JSON.parse(saved);
        } catch (e) {
            console.error("Error parsing health thresholds:", e);
        }
    }
    return DEFAULT_THRESHOLDS;
}

function saveHealthThresholds(newThresholds) {
    localStorage.setItem("alpha_health_thresholds", JSON.stringify(newThresholds));
}

/**
 * Main Centralized Health Evaluation Function
 * @param {Object} vitals { heartRate, spo2, temperature, fallDetected, sos }
 * @returns {Object} { status: 'SAFE'|'WARNING'|'EMERGENCY', details: Array, vitalStatuses: Object }
 */
function evaluateHealthStatus(vitals) {
    const limits = getHealthThresholds();
    const details = [];
    
    const vitalStatuses = {
        heartRate: "normal",
        spo2: "normal",
        temperature: "normal"
    };

    let isEmergency = false;
    let isWarning = false;

    // 1. Emergency Overrides: Manual SOS or Fall Detection
    if (vitals.sos) {
        isEmergency = true;
        details.push("Manual SOS Panic Button Triggered");
    }

    if (vitals.fallDetected) {
        isEmergency = true;
        details.push("Sudden Impact / Fall Detected");
    }

    // 2. Heart Rate Assessment
    if (vitals.heartRate < limits.hrMin || vitals.heartRate > limits.hrMax) {
        isEmergency = true;
        vitalStatuses.heartRate = "critical";
        details.push(`Critical Heart Rate (${vitals.heartRate} BPM)`);
    } else if (vitals.heartRate < limits.hrWarnLow || vitals.heartRate > limits.hrWarnHigh) {
        isWarning = true;
        vitalStatuses.heartRate = "warning";
        details.push(`Abnormal Heart Rate (${vitals.heartRate} BPM)`);
    }

    // 3. SpO2 Assessment
    if (vitals.spo2 < limits.spo2Critical) {
        isEmergency = true;
        vitalStatuses.spo2 = "critical";
        details.push(`Critical Oxygen Level (${vitals.spo2}%)`);
    } else if (vitals.spo2 <= limits.spo2Warning) {
        isWarning = true;
        vitalStatuses.spo2 = "warning";
        details.push(`Low Oxygen Saturation (${vitals.spo2}%)`);
    }

    // 4. Temperature Assessment
    if (vitals.temperature < limits.tempMin || vitals.temperature > limits.tempMax) {
        isEmergency = true;
        vitalStatuses.temperature = "critical";
        details.push(`Critical Body Temp (${vitals.temperature} °C)`);
    } else if (vitals.temperature < limits.tempWarnLow || vitals.temperature > limits.tempWarnHigh) {
        isWarning = true;
        vitalStatuses.temperature = "warning";
        details.push(`Borderline Body Temp (${vitals.temperature} °C)`);
    }

    // Overall Status Resolution
    let finalStatus = "SAFE";
    if (isEmergency) {
        finalStatus = "EMERGENCY";
    } else if (isWarning) {
        finalStatus = "WARNING";
    }

    return {
        status: finalStatus,
        reasons: details,
        vitalStatuses: vitalStatuses
    };
}
