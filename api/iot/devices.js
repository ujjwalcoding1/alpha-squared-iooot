/**
 * Alpha Squared IoT - Device Management API Endpoint
 * Handles:
 * - POST   /api/iot/devices                 (Register new device, returns plain token once)
 * - GET    /api/iot/devices                 (List registered devices)
 * - GET    /api/iot/devices/:id             (Get single device details)
 * - PATCH  /api/iot/devices/:id             (Update device metadata/enabled state)
 * - DELETE /api/iot/devices/:id             (Remove device)
 * - POST   /api/iot/devices/:id/rotate-token (Rotate device secret token)
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');
const { hashToken, generateDeviceToken, verifyAdminAuth } = require('../../backend/auth');

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

        try {
            const devicesCol = await db.getDevicesCollection();
            const existing = await devicesCol.findOne({ device_id: deviceId });
            if (!existing) {
                return res.status(404).json({ success: false, error: `Device '${deviceId}' not found.` });
            }

            const newToken = generateDeviceToken(deviceId);
            const tokenHash = hashToken(newToken);
            const nowIso = new Date().toISOString();

            await devicesCol.updateOne(
                { device_id: deviceId },
                { $set: { token_hash: tokenHash, updated_at: nowIso } }
            );

            return res.status(200).json({
                success: true,
                message: `Device token rotated successfully for '${deviceId}'. Store this token securely.`,
                device_id: deviceId,
                new_device_token: newToken
            });
        } catch (err) {
            console.error('[Token Rotation Error]:', err.message);
            return res.status(500).json({ success: false, error: 'Database error while rotating token.', details: err.message });
        }
    }

    // ------------------------------------------------------------------------
    // 2. GET SINGLE DEVICE: GET /api/iot/devices/:id
    // ------------------------------------------------------------------------
    if (deviceId && req.method === 'GET') {
        try {
            const devicesCol = await db.getDevicesCollection();
            const readingsCol = await db.getReadingsCollection();

            const dev = await devicesCol.findOne(
                { device_id: deviceId },
                { projection: { token_hash: 0 } }
            );

            if (!dev) {
                return res.status(404).json({ success: false, error: `Device '${deviceId}' not found.` });
            }

            const totalReadings = await readingsCol.countDocuments({ device_id: deviceId });
            const latestReading = await readingsCol.find({ device_id: deviceId })
                .sort({ server_received_at: -1 })
                .limit(1)
                .project({ server_received_at: 1 })
                .next();

            return res.status(200).json({
                success: true,
                device: {
                    id: dev._id.toString(),
                    device_id: dev.device_id,
                    device_name: dev.device_name,
                    device_type: dev.device_type,
                    is_enabled: dev.is_enabled,
                    created_at: dev.created_at,
                    updated_at: dev.updated_at,
                    last_seen_at: dev.last_seen_at,
                    status: dev.status,
                    total_readings: totalReadings,
                    last_reading_time: latestReading ? latestReading.server_received_at : null
                }
            });
        } catch (err) {
            console.error('[Get Device Error]:', err.message);
            return res.status(500).json({ success: false, error: 'Database error fetching device.', details: err.message });
        }
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

        try {
            const updateFields = {};
            if (typeof body.device_name === 'string' && body.device_name.trim()) {
                updateFields.device_name = body.device_name.trim();
            }
            if (typeof body.device_type === 'string' && body.device_type.trim()) {
                updateFields.device_type = body.device_type.trim();
            }
            if (typeof body.is_enabled === 'boolean') {
                updateFields.is_enabled = body.is_enabled;
            }

            if (Object.keys(updateFields).length === 0) {
                return res.status(400).json({ success: false, error: 'No valid update fields provided.' });
            }

            updateFields.updated_at = new Date().toISOString();

            const devicesCol = await db.getDevicesCollection();
            const result = await devicesCol.findOneAndUpdate(
                { device_id: deviceId },
                { $set: updateFields },
                { returnDocument: 'after', projection: { token_hash: 0 } }
            );

            if (!result) {
                return res.status(404).json({ success: false, error: `Device '${deviceId}' not found.` });
            }

            return res.status(200).json({
                success: true,
                message: 'Device updated successfully.',
                device: {
                    id: result._id.toString(),
                    ...result
                }
            });
        } catch (err) {
            console.error('[Patch Device Error]:', err.message);
            return res.status(500).json({ success: false, error: 'Database error updating device.', details: err.message });
        }
    }

    // ------------------------------------------------------------------------
    // 4. DELETE DEVICE: DELETE /api/iot/devices/:id
    // ------------------------------------------------------------------------
    if (deviceId && req.method === 'DELETE') {
        const auth = verifyAdminAuth(req);
        if (!auth.authorized) {
            return res.status(auth.statusCode).json({ success: false, error: auth.error });
        }

        try {
            const devicesCol = await db.getDevicesCollection();
            const readingsCol = await db.getReadingsCollection();

            const delRes = await devicesCol.deleteOne({ device_id: deviceId });
            if (delRes.deletedCount === 0) {
                return res.status(404).json({ success: false, error: `Device '${deviceId}' not found.` });
            }

            // Cascade delete readings for this device
            await readingsCol.deleteMany({ device_id: deviceId });

            return res.status(200).json({
                success: true,
                message: `Device '${deviceId}' and associated readings deleted successfully.`
            });
        } catch (err) {
            console.error('[Delete Device Error]:', err.message);
            return res.status(500).json({ success: false, error: 'Database error deleting device.', details: err.message });
        }
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

        try {
            const devicesCol = await db.getDevicesCollection();
            const existing = await devicesCol.findOne({ device_id: devId });
            if (existing) {
                return res.status(409).json({
                    success: false,
                    error: `Device ID '${devId}' is already registered. Use a unique identifier.`
                });
            }

            const plainToken = generateDeviceToken(devId);
            const tokenHash = hashToken(plainToken);
            const nowIso = new Date().toISOString();

            const newDoc = {
                device_id: devId,
                device_name: devName,
                device_type: devType,
                token_hash: tokenHash,
                is_enabled: true,
                created_at: nowIso,
                updated_at: nowIso,
                last_seen_at: null,
                status: 'offline',
                metadata: {}
            };

            const insRes = await devicesCol.insertOne(newDoc);

            return res.status(201).json({
                success: true,
                message: 'Device registered successfully. Save the device authentication token now; it will not be displayed again.',
                device: {
                    id: insRes.insertedId.toString(),
                    device_id: devId,
                    device_name: devName,
                    device_type: devType,
                    is_enabled: true,
                    created_at: nowIso,
                    status: 'offline'
                },
                device_token: plainToken
            });

        } catch (err) {
            console.error('[Device Registration Error]:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error registering device.',
                details: err.message
            });
        }
    }

    // ------------------------------------------------------------------------
    // 6. LIST ALL DEVICES: GET /api/iot/devices
    // ------------------------------------------------------------------------
    if (!deviceId && req.method === 'GET') {
        try {
            const devicesCol = await db.getDevicesCollection();
            const readingsCol = await db.getReadingsCollection();

            const devices = await devicesCol.find({}, { projection: { token_hash: 0 } })
                .sort({ created_at: -1 })
                .toArray();

            const now = Date.now();
            const formatted = await Promise.all(devices.map(async (dev) => {
                const totalReadings = await readingsCol.countDocuments({ device_id: dev.device_id });
                const lastSeenMs = dev.last_seen_at ? new Date(dev.last_seen_at).getTime() : 0;
                const isOnline = dev.is_enabled && (now - lastSeenMs < 60000);

                return {
                    id: dev._id.toString(),
                    device_id: dev.device_id,
                    device_name: dev.device_name,
                    device_type: dev.device_type,
                    is_enabled: dev.is_enabled,
                    created_at: dev.created_at,
                    updated_at: dev.updated_at,
                    last_seen_at: dev.last_seen_at,
                    total_readings: totalReadings,
                    status: !dev.is_enabled ? 'disabled' : (isOnline ? 'online' : 'offline')
                };
            }));

            return res.status(200).json({
                success: true,
                count: formatted.length,
                devices: formatted
            });
        } catch (err) {
            console.error('[List Devices Error]:', err.message);
            return res.status(500).json({
                success: false,
                error: 'Database error listing devices.',
                details: err.message
            });
        }
    }

    return res.status(405).json({
        success: false,
        error: `Method ${req.method} not allowed on this path.`
    });
};
