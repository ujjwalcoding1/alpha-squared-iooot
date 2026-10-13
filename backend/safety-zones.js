/**
 * Alpha Squad IoT - Three-Zone Patient Safety & Recommendation Engine
 * 
 * Clinical Safety Zones:
 * - GREEN  (NORMAL)   : All available vitals within optimal ranges. Reassuring status.
 * - YELLOW (WARNING)  : Vitals slightly outside optimal range. Clear dashboard alert,
 *                       safe general non-diagnostic recommendations (resting, rechecking).
 * - RED    (CRITICAL) : Critical vitals, confirmed fall, or manual SOS. Immediate emergency
 *                       dispatch (Email, Phone Call, Telegram) with GPS location sharing.
 * 
 * Medical Disclaimer: Prototype monitoring system. Telemetry measurements do not
 * replace professional medical advice or clinical diagnosis.
 */

const DEFAULT_THRESHOLDS = {
    // Normal Range (Green)
    hrNormalMin: 60,
    hrNormalMax: 100,
    tempNormalMin: 36.0,
    tempNormalMax: 37.5,

    // Warning Range (Yellow)
    hrWarnLow: 50,      // 50 - 59 BPM
    hrWarnHigh: 120,    // 101 - 120 BPM
    tempWarnLow: 35.5,  // 35.5 - 35.9 °C
    tempWarnHigh: 38.4, // 37.6 - 38.4 °C

    // Critical Range (Red)
    hrCriticalLow: 50,  // < 50 BPM
    hrCriticalHigh: 120,// > 120 BPM
    tempCriticalLow: 35.5,  // < 35.5 °C
    tempCriticalHigh: 38.5  // >= 38.5 °C
};

/**
 * Evaluates patient vitals against the Three-Zone safety model.
 * 
 * @param {Object} vitals { heartRate, temperature, spo2?, fallDetected, sos }
 * @param {Object} [customThresholds] Optional custom thresholds
 * @returns {Object} Three-zone evaluation result with recommendations
 */
function evaluateThreeZones(vitals = {}, customThresholds = {}) {
    const limits = { ...DEFAULT_THRESHOLDS, ...customThresholds };
    const reasons = [];
    const vitalEvaluations = {};

    let hrStatus = 'normal';
    let tempStatus = 'normal';
    let isRed = false;
    let isYellow = false;

    const hr = typeof vitals.heartRate === 'number' ? vitals.heartRate : (vitals.heart_rate && typeof vitals.heart_rate.value === 'number' ? vitals.heart_rate.value : null);
    const temp = typeof vitals.temperature === 'number' ? vitals.temperature : (vitals.temperature && typeof vitals.temperature.value === 'number' ? vitals.temperature.value : null);
    const fall = Boolean(vitals.fallDetected || vitals.fall_detected);
    const sos = Boolean(vitals.sos || vitals.manual_sos);

    // 1. Manual SOS panic trigger
    if (sos) {
        isRed = true;
        reasons.push('Manual SOS Panic Alarm Triggered');
    }

    // 2. Fall detection
    if (fall) {
        isRed = true;
        reasons.push('Sudden Impact / Fall Detected');
    }

    // 3. Heart Rate evaluation
    if (hr !== null && !isNaN(hr)) {
        if (hr < limits.hrCriticalLow || hr > limits.hrCriticalHigh) {
            isRed = true;
            hrStatus = 'critical';
            reasons.push(hr < limits.hrCriticalLow
                ? `Critical Bradycardia (Heart Rate: ${hr} BPM < ${limits.hrCriticalLow})`
                : `Critical Tachycardia (Heart Rate: ${hr} BPM > ${limits.hrCriticalHigh})`);
        } else if (hr < limits.hrNormalMin || hr > limits.hrNormalMax) {
            isYellow = true;
            hrStatus = 'warning';
            reasons.push(hr < limits.hrNormalMin
                ? `Borderline Low Heart Rate (${hr} BPM)`
                : `Elevated Heart Rate (${hr} BPM)`);
        }
    }
    vitalEvaluations.heartRate = {
        value: hr,
        status: hrStatus,
        zone: hrStatus === 'critical' ? 'RED' : (hrStatus === 'warning' ? 'YELLOW' : 'GREEN')
    };

    // 4. Body Temperature evaluation
    if (temp !== null && !isNaN(temp)) {
        if (temp < limits.tempCriticalLow || temp >= limits.tempCriticalHigh) {
            isRed = true;
            tempStatus = 'critical';
            reasons.push(temp < limits.tempCriticalLow
                ? `Critical Hypothermia Risk (Body Temp: ${temp.toFixed(1)}°C < ${limits.tempCriticalLow}°C)`
                : `High Fever / Hyperthermia (Body Temp: ${temp.toFixed(1)}°C >= ${limits.tempCriticalHigh}°C)`);
        } else if (temp < limits.tempNormalMin || temp > limits.tempNormalMax) {
            isYellow = true;
            tempStatus = 'warning';
            reasons.push(temp < limits.tempNormalMin
                ? `Low Body Temp (${temp.toFixed(1)}°C)`
                : `Low-Grade Fever (${temp.toFixed(1)}°C)`);
        }
    }
    vitalEvaluations.temperature = {
        value: temp,
        status: tempStatus,
        zone: tempStatus === 'critical' ? 'RED' : (tempStatus === 'warning' ? 'YELLOW' : 'GREEN')
    };

    // 5. Zone Resolution
    let zone = 'GREEN';
    let statusText = 'NORMAL';
    let color = '#10b981';
    let recommendation = 'All monitored vitals are within normal target ranges. Rest comfortably and stay hydrated.';

    // Rule: For a confirmed fall combined with a critical reading, do not delay the emergency workflow
    const isVitalCritical = hrStatus === 'critical' || tempStatus === 'critical';
    const bypassFallCountdown = fall && isVitalCritical;

    if (isRed) {
        zone = 'RED';
        statusText = 'CRITICAL';
        color = '#ef4444';
        recommendation = 'CRITICAL ALERT: Emergency conditions detected. Automated emergency dispatch active to caregivers and primary contacts. Remain seated and await assistance.';
    } else if (isYellow) {
        zone = 'YELLOW';
        statusText = 'WARNING';
        color = '#f59e0b';
        if (hrStatus === 'warning' && tempStatus === 'warning') {
            recommendation = 'Both heart rate and body temperature are borderline. Please sit down, rest calmly for 5 minutes, drink water, and recheck your readings. If feeling unwell, contact your caregiver.';
        } else if (hrStatus === 'warning') {
            recommendation = 'Heart rate is slightly outside optimal target. Please sit or lie down, rest quietly for 5 minutes, take deep breaths, and recheck. Contact your healthcare provider if symptoms persist.';
        } else {
            recommendation = 'Body temperature is slightly outside optimal range. Stay in a well-ventilated room, hydrate with water, and recheck in 15 minutes. Follow your personalized care plan.';
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
        vital_evaluations: vitalEvaluations,
        disclaimer: 'Notice: All readings are device telemetry measurements, not professional medical diagnoses. Always consult a licensed clinician for healthcare guidance.'
    };
}

module.exports = {
    DEFAULT_THRESHOLDS,
    evaluateThreeZones
};
