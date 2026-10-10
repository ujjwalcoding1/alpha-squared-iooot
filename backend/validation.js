/**
 * Alpha Squared IoT - Telemetry Payload Schema & Range Validation Engine
 * Enforces hardware integrity: no fabricated readings, valid units, physiological boundaries.
 */

function validateIsoTimestamp(timestampStr) {
    if (!timestampStr) return { valid: false, error: 'Timestamp is required.' };
    const date = new Date(timestampStr);
    if (isNaN(date.getTime())) {
        return { valid: false, error: 'Invalid timestamp format. Must be a valid ISO 8601 string or date.' };
    }

    const now = Date.now();
    const timeMs = date.getTime();
    // Allow max 1 hour clock drift in future, max 7 days in past
    if (timeMs > now + 3600000) {
        return { valid: false, error: 'Timestamp cannot be in the future (exceeds clock drift limit).' };
    }
    if (timeMs < now - 7 * 86400000) {
        return { valid: false, error: 'Timestamp is too old (exceeds 7-day ingestion window).' };
    }

    return { valid: true, date };
}

function validateTelemetryPayload(body) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return { valid: false, error: 'Invalid JSON payload. Object expected.' };
    }

    // 1. Device ID
    if (!body.device_id || typeof body.device_id !== 'string') {
        return { valid: false, error: 'Field "device_id" is required and must be a string.' };
    }
    const deviceId = body.device_id.trim();
    if (deviceId.length < 3 || deviceId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(deviceId)) {
        return { valid: false, error: 'Field "device_id" must be 3-64 characters (alphanumeric, underscores, hyphens).' };
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
        gps: { latitude: null, longitude: null, fix_valid: false },
        battery_level: null,
        signal_strength: null,
        is_simulated: body.is_simulated === true
    };

    // 3. Temperature validation
    if (body.temperature && typeof body.temperature === 'object') {
        const t = body.temperature;
        const status = (t.sensor_status || 'ok').toLowerCase();
        clean.temperature.sensor_status = status;

        if (status === 'ok') {
            if (t.value === null || t.value === undefined || typeof t.value !== 'number' || isNaN(t.value)) {
                return { valid: false, error: 'Temperature sensor_status is "ok" but "value" is missing or non-numeric.' };
            }
            if (t.value < -20 || t.value > 65) {
                return { valid: false, error: `Temperature value (${t.value}°C) is outside reasonable environmental/body bounds (-20 to 65°C).` };
            }
            if (t.unit && t.unit !== 'C') {
                return { valid: false, error: 'Temperature unit must be "C".' };
            }
            clean.temperature.value = parseFloat(t.value.toFixed(2));
            clean.temperature.unit = 'C';
        } else {
            clean.temperature.value = null;
        }
    }

    // 4. Heart Rate validation
    if (body.heart_rate && typeof body.heart_rate === 'object') {
        const hr = body.heart_rate;
        const status = (hr.sensor_status || 'ok').toLowerCase();
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

    // 5. Blood Pressure validation (optional hardware module)
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

    // 6. GPS validation
    if (body.gps && typeof body.gps === 'object') {
        const g = body.gps;
        clean.gps.fix_valid = Boolean(g.fix_valid);

        if (clean.gps.fix_valid) {
            if (typeof g.latitude !== 'number' || typeof g.longitude !== 'number') {
                return { valid: false, error: 'GPS fix_valid is true but numeric latitude and longitude are missing.' };
            }
            if (g.latitude < -90 || g.latitude > 90) {
                return { valid: false, error: 'GPS latitude must be between -90 and 90.' };
            }
            if (g.longitude < -180 || g.longitude > 180) {
                return { valid: false, error: 'GPS longitude must be between -180 and 180.' };
            }
            clean.gps.latitude = parseFloat(g.latitude.toFixed(7));
            clean.gps.longitude = parseFloat(g.longitude.toFixed(7));
        }
    }

    // 7. Battery & Signal metadata
    if (typeof body.battery_level === 'number' && !isNaN(body.battery_level)) {
        if (body.battery_level >= 0 && body.battery_level <= 100) {
            clean.battery_level = parseFloat(body.battery_level.toFixed(1));
        }
    }
    if (typeof body.signal_strength === 'number' && !isNaN(body.signal_strength)) {
        // RSSI range typically -120 dBm to 0 dBm
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

