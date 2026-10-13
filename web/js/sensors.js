/**
 * Alpha Squad IoT - Three-Zone Patient Safety & Recommendation Engine
 * 
 * Safety Zones:
 * - GREEN  (NORMAL)   : Monitored vitals within optimal ranges (HR 60-100 BPM, Temp 36.0-37.5°C). Reassuring status.
 * - YELLOW (WARNING)  : Vitals slightly outside target (HR 50-59 or 101-120 BPM, Temp 35.5-35.9 or 37.6-38.4°C).
 *                       Safe general guidance (resting, rechecking).
 * - RED    (CRITICAL) : Critical readings (HR < 50 or > 120, Temp < 35.5 or >= 38.5°C), confirmed fall, or SOS.
 *                       Emergency alert workflow dispatched with live GPS location link.
 * 
 * Notice: Telemetry data is informational and does not constitute clinical medical diagnosis.
 */

const DEFAULT_THRESHOLDS = {
    // Normal Range (Green)
    hrNormalMin: 60,
    hrNormalMax: 100,
    tempNormalMin: 36.0,
    tempNormalMax: 37.5,

    // Warning Range (Yellow)
    hrWarnLow: 50,
    hrWarnHigh: 120,
    tempWarnLow: 35.5,
    tempWarnHigh: 38.4,

    // Critical Range (Red)
    hrCriticalLow: 50,
    hrCriticalHigh: 120,
    tempCriticalLow: 35.5,
    tempCriticalHigh: 38.5,

    // Legacy threshold aliases for compatibility
    hrMin: 50,
    hrMax: 120,
    tempMin: 35.5,
    tempMax: 38.5
};

// Load thresholds from Settings or fallback to Defaults
function getHealthThresholds() {
    const saved = localStorage.getItem("alpha_health_thresholds");
    if (saved) {
        try {
            return { ...DEFAULT_THRESHOLDS, ...JSON.parse(saved) };
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
 * Evaluates patient telemetry using the Three-Zone safety model.
 * 
 * @param {Object} vitals { heartRate, temperature, spo2?, fallDetected, sos }
 * @returns {Object} Three-zone evaluation result with recommendations
 */
function evaluateThreeZones(vitals = {}) {
    const limits = getHealthThresholds();
    const reasons = [];
    const vitalStatuses = {
        heartRate: "normal",
        temperature: "normal"
    };

    let isRed = false;
    let isYellow = false;

    const hr = typeof vitals.heartRate === "number" ? vitals.heartRate : null;
    const temp = typeof vitals.temperature === "number" ? vitals.temperature : null;
    const fall = Boolean(vitals.fallDetected || vitals.fall_detected);
    const sos = Boolean(vitals.sos || vitals.manual_sos);

    // 1. Manual SOS panic trigger
    if (sos) {
        isRed = true;
        reasons.push("Manual SOS Panic Button Triggered");
    }

    // 2. Sudden fall detected
    if (fall) {
        isRed = true;
        reasons.push("Sudden Impact / Fall Detected");
    }

    // 3. Heart Rate evaluation
    if (hr !== null && !isNaN(hr)) {
        if (hr < limits.hrCriticalLow || hr > limits.hrCriticalHigh) {
            isRed = true;
            vitalStatuses.heartRate = "critical";
            reasons.push(hr < limits.hrCriticalLow
                ? `Critical Bradycardia (${hr} BPM < ${limits.hrCriticalLow})`
                : `Critical Tachycardia (${hr} BPM > ${limits.hrCriticalHigh})`);
        } else if (hr < limits.hrNormalMin || hr > limits.hrNormalMax) {
            isYellow = true;
            vitalStatuses.heartRate = "warning";
            reasons.push(hr < limits.hrNormalMin
                ? `Borderline Low Heart Rate (${hr} BPM)`
                : `Elevated Heart Rate (${hr} BPM)`);
        }
    }

    // 4. Body Temperature evaluation
    if (temp !== null && !isNaN(temp)) {
        if (temp < limits.tempCriticalLow || temp >= limits.tempCriticalHigh) {
            isRed = true;
            vitalStatuses.temperature = "critical";
            reasons.push(temp < limits.tempCriticalLow
                ? `Critical Hypothermia Risk (${temp.toFixed(1)}°C < ${limits.tempCriticalLow}°C)`
                : `High Fever / Hyperthermia (${temp.toFixed(1)}°C >= ${limits.tempCriticalHigh}°C)`);
        } else if (temp < limits.tempNormalMin || temp > limits.tempNormalMax) {
            isYellow = true;
            vitalStatuses.temperature = "warning";
            reasons.push(temp < limits.tempNormalMin
                ? `Low Body Temp (${temp.toFixed(1)}°C)`
                : `Low-Grade Fever (${temp.toFixed(1)}°C)`);
        }
    }

    // 5. Zone Resolution & Safe Recommendations
    let zone = "GREEN";
    let statusText = "NORMAL";
    let color = "#10b981";
    let recommendation = "All monitored vitals are within normal target ranges. Rest comfortably and stay hydrated.";

    // Rule: For a confirmed fall combined with a critical reading, do not delay the emergency workflow
    const isVitalCritical = vitalStatuses.heartRate === "critical" || vitalStatuses.temperature === "critical";
    const bypassFallCountdown = fall && isVitalCritical;

    if (isRed) {
        zone = "RED";
        statusText = "CRITICAL";
        color = "#ef4444";
        recommendation = "CRITICAL ALERT: Emergency conditions detected. Emergency notification dispatched to caregivers and primary contacts. Remain seated and await assistance.";
    } else if (isYellow) {
        zone = "YELLOW";
        statusText = "WARNING";
        color = "#f59e0b";
        if (vitalStatuses.heartRate === "warning" && vitalStatuses.temperature === "warning") {
            recommendation = "Both heart rate and body temperature are borderline. Please sit down, rest quietly for 5 minutes, drink water, and recheck your readings. If feeling unwell, contact your caregiver.";
        } else if (vitalStatuses.heartRate === "warning") {
            recommendation = "Heart rate is slightly outside optimal range. Please sit or lie down, rest quietly for 5 minutes, breathe deeply, and recheck. Contact your healthcare provider if symptoms persist.";
        } else {
            recommendation = "Body temperature is slightly outside optimal target. Stay in a well-ventilated room, hydrate with water, and recheck in 15 minutes. Follow your personal care plan.";
        }
    }

    return {
        zone,
        status: statusText,
        color,
        reasons,
        recommendation,
        is_emergency: isRed,
        is_warning: isYellow,
        is_normal: !isRed && !isYellow,
        requires_immediate_dispatch: isRed,
        bypass_fall_countdown: bypassFallCountdown,
        vital_evaluations: {
            heartRate: { value: hr, status: vitalStatuses.heartRate, zone: vitalStatuses.heartRate.toUpperCase() },
            temperature: { value: temp, status: vitalStatuses.temperature, zone: vitalStatuses.temperature.toUpperCase() }
        },
        vitalStatuses,
        disclaimer: "Notice: All readings are device telemetry measurements, not professional medical diagnoses. Always consult a licensed clinician for healthcare guidance."
    };
}

/**
 * Backward compatibility wrapper for existing code expecting evaluateHealthStatus()
 */
function evaluateHealthStatus(vitals) {
    const result = evaluateThreeZones(vitals);
    return {
        status: result.zone === "RED" ? "EMERGENCY" : (result.zone === "YELLOW" ? "WARNING" : "SAFE"),
        zone: result.zone,
        reasons: result.reasons,
        recommendation: result.recommendation,
        vitalStatuses: result.vitalStatuses,
        bypass_fall_countdown: result.bypass_fall_countdown
    };
}
