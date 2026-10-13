/**
 * Alpha Squared IoT - Telemetry Input Validation & Range Enforcement
 * Ensures incoming ESP32 sensor readings meet physical and physiological safety constraints.
 * Strictly preserves missing blood pressure and GPS values as null/not_installed without fabricating data.
 */

/**
 * Validates ISO-8601 timestamp string
 */
function validateIsoTimestamp(ts) {
    if (!ts || typeof ts !== 'string') {
        return { valid: false, error: 'Timestamp must be an ISO-8601 string.' };
    }
    const d = new Date(ts);
    if (isNaN(d.getTime())) {
        return { valid: false, error: 'Timestamp is not a valid date.' };
    }
    // Reject timestamps > 24 hours in the future or > 30 days in the past
    const now = Date.now();
    const tsMs = d.getTime();
    if (tsMs > now + 86400000) {
        return { valid: false, error: 'Timestamp is in the future (> 24h skew).' };
    }
    if (tsMs < now - (30 * 86400000)) {
        return { valid: false, error: 'Timestamp is older than 30 days.' };
    }
    return { valid: true, date: d };
}

/**
 * Validates an incoming telemetry payload from ESP32 or simulated nodes.
 * @param {object} body Raw request body
 * @returns {object} { valid: boolean, error?: string, data?: object }
 */
function validateTelemetryPayload(body) {
    if (!body || typeof body !== 'object') {
        return { valid: false, error: 'Request body must be a valid JSON object.' };
    }

    // 1. Device ID validation
    const deviceId = (body.device_id || '').trim();
    if (!deviceId) {
        return { valid: false, error: 'Field "device_id" is required and cannot be empty.' };
    }
    if (deviceId.length < 3 || deviceId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(deviceId)) {
        return { valid: false, error: 'Field "device_id" must be 3-64 characters (alphanumeric, dashes, underscores).' };
    }

    // 2. Timestamp (use device timestamp if provided, or fallback to server reception timestamp)
    let tsCheck;
    if (!body.timestamp) {
        tsCheck = { valid: true, date: new Date() };
    } else {
        tsCheck = validateIsoTimestamp(body.timestamp);
        if (!tsCheck.valid) {
            return { valid: false, error: tsCheck.error };
        }
    }

    const clean = {
        device_id: deviceId,
        device_timestamp: tsCheck.date.toISOString(),
        temperature: { value: null, unit: 'C', sensor_status: 'disconnected' },
        heart_rate: { value: null, unit: 'bpm', sensor_status: 'disconnected' },
        blood_pressure: { systolic: null, diastolic: null, unit: 'mmHg', sensor_status: 'not_installed' },
        gps: { latitude: null, longitude: null, fix_valid: false, sensor_status: 'no_fix' },
        sim800l: { status: 'unknown', last_sms_status: null, last_sms_at: null, last_call_status: 'idle', last_sos_time: null },
        spo2: null,
        battery_level: null,
        signal_strength: null,
        is_simulated: body.is_simulated === true
    };

    // 3. Temperature validation
    if (typeof body.temperature === 'number') {
        const val = body.temperature;
        if (val < -20 || val > 65) {
            return { valid: false, error: `Temperature value (${val}°C) is outside reasonable environmental/body bounds (-20 to 65°C).` };
        }
        clean.temperature.value = parseFloat(val.toFixed(2));
        clean.temperature.unit = 'C';
        clean.temperature.sensor_status = 'ok';
    } else if (body.temperature && typeof body.temperature === 'object') {
        const t = body.temperature;
        const status = (t.sensor_status || (typeof t.value === 'number' ? 'ok' : 'disconnected')).toLowerCase();
        clean.temperature.sensor_status = status;

        if (status === 'ok') {
            if (t.value === null || t.value === undefined || typeof t.value !== 'number' || isNaN(t.value)) {
                return { valid: false, error: 'Temperature sensor_status is "ok" but "value" is missing or non-numeric.' };
            }
            if (t.value < -20 || t.value > 65) {
                return { valid: false, error: `Temperature value (${t.value}°C) is outside reasonable environmental/body bounds (-20 to 65°C).` };
            }
            if (t.unit && t.unit.toUpperCase() !== 'C') {
                return { valid: false, error: 'Temperature unit must be Celsius ("C").' };
            }
            clean.temperature.value = parseFloat(t.value.toFixed(2));
            clean.temperature.unit = 'C';
        } else {
            clean.temperature.value = null;
        }
    }

    // 4. Heart Rate validation
    if (typeof body.heart_rate === 'number') {
        const val = body.heart_rate;
        if (val < 20 || val > 250) {
            return { valid: false, error: `Heart rate value (${val} BPM) is outside physiological bounds (20 to 250 BPM).` };
        }
        clean.heart_rate.value = parseFloat(val.toFixed(1));
        clean.heart_rate.unit = 'bpm';
        clean.heart_rate.sensor_status = 'ok';
    } else if (body.heart_rate && typeof body.heart_rate === 'object') {
        const hr = body.heart_rate;
        const status = (hr.sensor_status || (typeof hr.value === 'number' ? 'ok' : 'disconnected')).toLowerCase();
        clean.heart_rate.sensor_status = status;

        if (status === 'ok') {
            if (hr.value === null || hr.value === undefined || typeof hr.value !== 'number' || isNaN(hr.value)) {
                return { valid: false, error: 'Heart rate sensor_status is "ok" but "value" is missing or non-numeric.' };
            }
            if (hr.value < 20 || hr.value > 250) {
                return { valid: false, error: `Heart rate value (${hr.value} BPM) is outside physiological bounds (20 to 250 BPM).` };
            }
            if (hr.unit && hr.unit.toLowerCase() !== 'bpm') {
                return { valid: false, error: 'Heart rate unit must be "bpm".' };
            }
            clean.heart_rate.value = parseFloat(hr.value.toFixed(1));
            clean.heart_rate.unit = 'bpm';
        } else {
            clean.heart_rate.value = null;
        }
    }

    // 5. SpO2 Blood Oxygen validation
    if (typeof body.spo2 === 'number' && !isNaN(body.spo2)) {
        if (body.spo2 >= 50 && body.spo2 <= 100) {
            clean.spo2 = { value: Math.round(body.spo2), unit: '%', sensor_status: 'ok' };
        }
    } else if (body.spo2 && typeof body.spo2 === 'object') {
        const s = body.spo2;
        if (typeof s.value === 'number' && s.value >= 50 && s.value <= 100) {
            clean.spo2 = { value: Math.round(s.value), unit: '%', sensor_status: s.sensor_status || 'ok' };
        }
    }

    // 6. Blood Pressure validation (optional hardware module)
    if (body.blood_pressure && typeof body.blood_pressure === 'object') {
        const bp = body.blood_pressure;
        const status = (bp.sensor_status || 'ok').toLowerCase();
        clean.blood_pressure.sensor_status = status;

        if (status === 'ok') {
            if (typeof bp.systolic !== 'number' || typeof bp.diastolic !== 'number') {
                return { valid: false, error: 'Blood pressure requires numeric "systolic" and "diastolic" readings.' };
            }
            if (bp.systolic < 50 || bp.systolic > 260) {
                return { valid: false, error: `Systolic BP (${bp.systolic} mmHg) is out of range (50 to 260).` };
            }
            if (bp.diastolic < 30 || bp.diastolic > 160) {
                return { valid: false, error: `Diastolic BP (${bp.diastolic} mmHg) is out of range (30 to 160).` };
            }
            if (bp.diastolic >= bp.systolic) {
                return { valid: false, error: 'Diastolic BP cannot be equal to or greater than systolic BP.' };
            }
            clean.blood_pressure.systolic = parseFloat(bp.systolic.toFixed(1));
            clean.blood_pressure.diastolic = parseFloat(bp.diastolic.toFixed(1));
            clean.blood_pressure.unit = 'mmHg';
        } else {
            clean.blood_pressure.systolic = null;
            clean.blood_pressure.diastolic = null;
        }
    }

    // 7. GPS validation
    if (typeof body.latitude === 'number' && typeof body.longitude === 'number' && !isNaN(body.latitude) && !isNaN(body.longitude)) {
        if (body.latitude >= -90 && body.latitude <= 90 && body.longitude >= -180 && body.longitude <= 180) {
            clean.gps.latitude = parseFloat(body.latitude.toFixed(7));
            clean.gps.longitude = parseFloat(body.longitude.toFixed(7));
            clean.gps.fix_valid = true;
            clean.gps.sensor_status = 'ok';
        }
    } else if (body.gps && typeof body.gps === 'object') {
        const g = body.gps;
        const status = (g.sensor_status || (g.fix_valid ? 'ok' : 'no_fix')).toLowerCase();

        if (typeof g.latitude === 'number' && !isNaN(g.latitude) && typeof g.longitude === 'number' && !isNaN(g.longitude)) {
            if (g.latitude < -90 || g.latitude > 90) {
                return { valid: false, error: 'GPS latitude must be between -90 and 90.' };
            }
            if (g.longitude < -180 || g.longitude > 180) {
                return { valid: false, error: 'GPS longitude must be between -180 and 180.' };
            }
            clean.gps.fix_valid = true;
            clean.gps.sensor_status = status === 'no_fix' ? 'ok' : status;
            clean.gps.latitude = parseFloat(g.latitude.toFixed(7));
            clean.gps.longitude = parseFloat(g.longitude.toFixed(7));
        } else {
            clean.gps.fix_valid = false;
            clean.gps.sensor_status = status;
            clean.gps.latitude = null;
            clean.gps.longitude = null;
        }
    }

    // 8. SIM800L Cellular GSM Status
    if (body.sim800l && typeof body.sim800l === 'object') {
        const s = body.sim800l;
        clean.sim800l.status = (s.status || 'unknown').toLowerCase();
        if (typeof s.last_sms_status === 'string') {
            clean.sim800l.last_sms_status = s.last_sms_status.substring(0, 64);
        }
        if (typeof s.last_sms_at === 'string') {
            clean.sim800l.last_sms_at = s.last_sms_at;
        }
        if (typeof s.last_call_status === 'string') {
            clean.sim800l.last_call_status = s.last_call_status.substring(0, 64);
        }
        if (typeof s.last_sos_time === 'string') {
            clean.sim800l.last_sos_time = s.last_sos_time.substring(0, 64);
        }
    }

    // 9. Battery & Signal metadata
    if (typeof body.battery_level === 'number' && !isNaN(body.battery_level)) {
        if (body.battery_level >= 0 && body.battery_level <= 100) {
            clean.battery_level = parseFloat(body.battery_level.toFixed(1));
        }
    }
    if (typeof body.signal_strength === 'number' && !isNaN(body.signal_strength)) {
        if (body.signal_strength >= -130 && body.signal_strength <= 10) {
            clean.signal_strength = Math.round(body.signal_strength);
        }
    }

    return { valid: true, data: clean };
}

module.exports = {
    validateTelemetryPayload,
    validateIsoTimestamp
};
