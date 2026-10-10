/**
 * Alpha Squared IoT - Device Authentication & Security Engine
 * Cryptographic token generation, SHA-256 hashing, and admin verification without MongoDB.
 */

const crypto = require('crypto');
const liveStore = require('./live-store');

const DEFAULT_DEV_ADMIN_KEY = 'alpha_admin_master_secret_2026';

function hashToken(token) {
    return liveStore.hashToken(token);
}

function generateDeviceToken(deviceId = 'DEV') {
    return liveStore.generateDeviceToken(deviceId);
}

function getHeader(req, name) {
    if (!req || !req.headers) return '';
    const lower = name.toLowerCase();
    for (const key of Object.keys(req.headers)) {
        if (key.toLowerCase() === lower) {
            return req.headers[key] || '';
        }
    }
    return '';
}

/**
 * Validates administrative requests for device creation, deletion, or token rotation
 */
function verifyAdminAuth(req) {
    const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'production';
    const configuredKey = process.env.ADMIN_API_KEY ? process.env.ADMIN_API_KEY.trim() : '';

    if (isProduction && !configuredKey) {
        return {
            authorized: false,
            statusCode: 500,
            error: 'Server configuration error: ADMIN_API_KEY must be configured in production.'
        };
    }

    const adminKey = configuredKey || DEFAULT_DEV_ADMIN_KEY;

    // Check headers
    const authHeader = getHeader(req, 'authorization');
    const adminKeyHeader = getHeader(req, 'x-admin-key') || getHeader(req, 'x-api-key');

    let providedKey = '';
    if (adminKeyHeader) {
        providedKey = adminKeyHeader.trim();
    } else if (authHeader.startsWith('Bearer ')) {
        providedKey = authHeader.substring(7).trim();
    }

    if (!providedKey) {
        return {
            authorized: false,
            statusCode: 401,
            error: 'Authorization required. Missing x-admin-key or Authorization Bearer header.'
        };
    }

    // Constant-time comparison to prevent timing attacks
    const keyBuf = Buffer.from(adminKey);
    const provBuf = Buffer.from(providedKey);

    if (keyBuf.length !== provBuf.length || !crypto.timingSafeEqual(keyBuf, provBuf)) {
        return {
            authorized: false,
            statusCode: 403,
            error: 'Access denied. Invalid administrative credentials.'
        };
    }

    return { authorized: true };
}

/**
 * Authenticates telemetry data submissions from IoT hardware against device registry
 */
async function authenticateDevice(req, claimedDeviceId) {
    if (!claimedDeviceId || typeof claimedDeviceId !== 'string') {
        return {
            authenticated: false,
            statusCode: 400,
            error: 'Missing required device_id.'
        };
    }

    // Extract device token from custom header or Authorization Bearer
    const authHeader = getHeader(req, 'authorization');
    const tokenHeader = getHeader(req, 'x-device-token') || getHeader(req, 'x-token');

    let token = '';
    if (tokenHeader) {
        token = tokenHeader.trim();
    } else if (authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7).trim();
    }

    if (!token) {
        return {
            authenticated: false,
            statusCode: 401,
            error: 'Device authentication required. Provide device token via Authorization Bearer or x-device-token header.'
        };
    }

    const tokenHash = hashToken(token);
    const device = await liveStore.getDevice(claimedDeviceId);

    if (!device) {
        return {
            authenticated: false,
            statusCode: 404,
            error: `Device '${claimedDeviceId}' is not registered.`
        };
    }

    if (!device.is_enabled) {
        return {
            authenticated: false,
            statusCode: 403,
            error: `Device '${claimedDeviceId}' is disabled. Telemetry ingestion blocked.`
        };
    }

    // Secure token hash verification
    const expectedHashBuf = Buffer.from(device.token_hash);
    const actualHashBuf = Buffer.from(tokenHash);

    if (expectedHashBuf.length !== actualHashBuf.length || !crypto.timingSafeEqual(expectedHashBuf, actualHashBuf)) {
        return {
            authenticated: false,
            statusCode: 401,
            error: 'Invalid device credentials. Authentication rejected.'
        };
    }

    return {
        authenticated: true,
        device
    };
}

module.exports = {
    hashToken,
    generateDeviceToken,
    verifyAdminAuth,
    authenticateDevice,
    DEFAULT_DEV_ADMIN_KEY
};
