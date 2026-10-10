/**
 * Alpha Squared IoT - Device Management API Endpoint (Live Monitoring Mode)
 * Handles:
 * - POST   /api/iot/devices                 (Register new device, returns plain token once)
 * - GET    /api/iot/devices                 (List registered devices)
 * - GET    /api/iot/devices/:id             (Get single device details)
 * - PATCH  /api/iot/devices/:id             (Update device metadata/enabled state)
 * - DELETE /api/iot/devices/:id             (Remove device)
 * - POST   /api/iot/devices/:id/rotate-token (Rotate device secret token)
 */

const { applyCors } = require('../../backend/cors');
const liveStore = require('../../backend/live-store');
const { verifyAdminAuth } = require('../../backend/auth');

function parseDeviceUrl(req) {
    const url = new URL(req.url, 'http://localhost');
    const pathParts = url.pathname.split('/').filter(Boolean);

    let deviceId = req.query ? req.query.id : null;
    let action = req.query ? req.query.action : null;

    const devIdx = pathParts.indexOf('devices');
    if (devIdx !== -1 && pathParts.length > devIdx + 1) {
        deviceId = pathParts[devIdx + 1];
        if (pathParts.length > devIdx + 2) {
            action = pathParts[devIdx + 2];
        }
    }

    return { deviceId, action };
}

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    const { deviceId, action } = parseDeviceUrl(req);

    // ------------------------------------------------------------------------
    // 1. ROTATE TOKEN: POST /api/iot/devices/:id/rotate-token
    // ------------------------------------------------------------------------
    if (deviceId && action === 'rotate-token' && req.method === 'POST') {
        const auth = verifyAdminAuth(req);
        if (!auth.authorized) {
            return res.status(auth.statusCode).json({ success: false, error: auth.error });
        }

        const newToken = await liveStore.rotateDeviceToken(deviceId);
        if (!newToken) {
            return res.status(404).json({ success: false, error: `Device '${deviceId}' not found.` });
        }

        return res.status(200).json({
            success: true,
            message: `Device token rotated successfully for '${deviceId}'. Store this token securely.`,
            device_id: deviceId,
            new_device_token: newToken
        });
    }

    // ------------------------------------------------------------------------
    // 2. GET SINGLE DEVICE: GET /api/iot/devices/:id
    // ------------------------------------------------------------------------
    if (deviceId && req.method === 'GET') {
        const dev = await liveStore.getDevice(deviceId);
        if (!dev) {
            return res.status(404).json({ success: false, error: `Device '${deviceId}' not found.` });
        }

        const latestReading = await liveStore.getLatestReading(deviceId);
        const copy = { ...dev };
        delete copy.token_hash;

        return res.status(200).json({
            success: true,
            device: {
                id: dev._id || dev.device_id,
                device_id: dev.device_id,
                device_name: dev.device_name,
                device_type: dev.device_type,
                is_enabled: dev.is_enabled,
                created_at: dev.created_at,
                updated_at: dev.updated_at,
                last_seen_at: dev.last_seen_at,
                status: dev.status,
                total_readings: latestReading ? 1 : 0,
                last_reading_time: latestReading ? latestReading.server_received_at : null
            }
        });
    }

    // ------------------------------------------------------------------------
    // 3. UPDATE DEVICE: PATCH /api/iot/devices/:id
    // ------------------------------------------------------------------------
    if (deviceId && req.method === 'PATCH') {
        const auth = verifyAdminAuth(req);
        if (!auth.authorized) {
            return res.status(auth.statusCode).json({ success: false, error: auth.error });
        }

        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (_) {}
        }

        const updated = await liveStore.updateDevice(deviceId, body);
        if (!updated) {
            return res.status(404).json({ success: false, error: `Device '${deviceId}' not found or no update fields provided.` });
        }

        return res.status(200).json({
            success: true,
            message: 'Device updated successfully.',
            device: updated
        });
    }

    // ------------------------------------------------------------------------
    // 4. DELETE DEVICE: DELETE /api/iot/devices/:id
    // ------------------------------------------------------------------------
    if (deviceId && req.method === 'DELETE') {
        const auth = verifyAdminAuth(req);
        if (!auth.authorized) {
            return res.status(auth.statusCode).json({ success: false, error: auth.error });
        }

        const deleted = await liveStore.deleteDevice(deviceId);
        if (!deleted) {
            return res.status(404).json({ success: false, error: `Device '${deviceId}' not found.` });
        }

        return res.status(200).json({
            success: true,
            message: `Device '${deviceId}' deleted successfully.`
        });
    }

    // ------------------------------------------------------------------------
    // 5. REGISTER NEW DEVICE: POST /api/iot/devices
    // ------------------------------------------------------------------------
    if (!deviceId && req.method === 'POST') {
        const auth = verifyAdminAuth(req);
        if (!auth.authorized) {
            return res.status(auth.statusCode).json({ success: false, error: auth.error });
        }

        let body = req.body || {};
        if (typeof body === 'string') {
            try { body = JSON.parse(body); } catch (_) {}
        }

        const devId = (body.device_id || '').trim();
        const devName = (body.device_name || '').trim();
        const devType = (body.device_type || 'ESP32').trim();

        if (!devId || devId.length < 3 || devId.length > 64 || !/^[A-Za-z0-9_-]+$/.test(devId)) {
            return res.status(400).json({
                success: false,
                error: 'Field "device_id" is required (3-64 alphanumeric characters, dashes or underscores).'
            });
        }

        if (!devName) {
            return res.status(400).json({
                success: false,
                error: 'Field "device_name" is required.'
            });
        }

        const regResult = await liveStore.registerDevice(devId, devName, devType);
        if (!regResult.success) {
            return res.status(regResult.statusCode).json({ success: false, error: regResult.error });
        }

        return res.status(201).json({
            success: true,
            message: `Device '${devId}' registered successfully. Store device token securely.`,
            device_id: devId,
            device_token: regResult.plainToken
        });
    }

    // ------------------------------------------------------------------------
    // 6. LIST DEVICES: GET /api/iot/devices
    // ------------------------------------------------------------------------
    if (!deviceId && req.method === 'GET') {
        const list = await liveStore.getAllDevices();
        return res.status(200).json({
            success: true,
            count: list.length,
            devices: list
        });
    }

    return res.status(405).json({
        success: false,
        error: 'Method not allowed.'
    });
};
