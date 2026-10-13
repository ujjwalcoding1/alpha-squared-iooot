/**
 * Alpha Squared IoT - Health & Connectivity Verification Endpoint
 * GET /api/iot/health
 * Public endpoint: returns system status, database health, and telemetry stats without leaking secrets.
 */

const { applyCors } = require('../../backend/cors');
const db = require('../../backend/db');

module.exports = async function handler(req, res) {
    if (applyCors(req, res)) return;

    if (req.method !== 'GET') {
        return res.status(405).json({
            success: false,
            error: 'Method not allowed. Use GET.'
        });
    }

    try {
        // Enforce a hard 4000ms bounded timeout so serverless invocations never exceed Vercel limits
        let timer = null;
        const timeoutPromise = new Promise((resolve) => {
            timer = setTimeout(() => {
                resolve({
                    provider: 'mongodb-atlas',
                    connected: false,
                    database: db.getDatabaseName(),
                    message: 'Health check timed out waiting for database response. Verify MongoDB Atlas Network Access (allow 0.0.0.0/0).',
                    devicesCount: 0,
                    readingsCount: 0
                });
            }, 4000);
        });

        const dbStatus = await Promise.race([
            db.getDbStatus({ timeoutMs: 3500 }),
            timeoutPromise
        ]);
        if (timer) clearTimeout(timer);

        return res.status(200).json({
            status: dbStatus.connected ? 'operational' : 'degraded',
            service: 'Alpha Squared IoT Health Monitoring API',
            version: '2.1.0',
            server_time: new Date().toISOString(),
            database: {
                provider: dbStatus.provider,
                connected: dbStatus.connected,
                database: dbStatus.database || null,
                message: dbStatus.message,
                registered_devices: dbStatus.devicesCount || 0,
                total_readings: dbStatus.readingsCount || 0
            },
            features: {
                device_authentication: 'active',
                range_validation: 'active',
                gps_mapping: 'active',
                emergency_dispatch: 'active'
            }
        });
    } catch (err) {
        console.error('[Health Endpoint Error]:', err.message);
        return res.status(200).json({
            status: 'degraded',
            service: 'Alpha Squared IoT Health Monitoring API',
            version: '2.1.0',
            server_time: new Date().toISOString(),
            database: {
                provider: 'mongodb-atlas',
                connected: false,
                database: null,
                message: 'Health check encountered an internal error: ' + (err.message || 'unknown error'),
                registered_devices: 0,
                total_readings: 0
            },
            features: {
                device_authentication: 'active',
                range_validation: 'active',
                gps_mapping: 'active',
                emergency_dispatch: 'active'
            }
        });
    }
};
