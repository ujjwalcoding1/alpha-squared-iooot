/**
 * Alpha Squared IoT - Live Telemetry & Device Store Engine
 * Dual-mode live store:
 * 1. Upstash Redis / Vercel KV REST API (when UPSTASH_REDIS_REST_URL & TOKEN or KV_REST_API_URL & TOKEN are set)
 * 2. In-Memory Standby Store (for local unit testing and development)
 */

const crypto = require('crypto');

function hashToken(token) {
    if (!token || typeof token !== 'string') return '';
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

function generateDeviceToken(deviceId = 'DEV') {
    const randomBytes = crypto.randomBytes(24).toString('hex');
    return `alphadev_${deviceId.toLowerCase().replace(/[^a-z0-9]/g, '')}_${randomBytes}`;
}

// Configured default device token
const DEFAULT_DEVICE_ID = 'ALPHA-001';
const DEFAULT_DEVICE_NAME = 'Alpha Health Monitor 1';
const DEFAULT_DEVICE_TOKEN = process.env.DEVICE_TOKEN_ALPHA_001 || 'alphadev_alpha001_secret_token_2026';

// In-Memory Fallback Store
const devicesMap = new Map();
const latestReadingsMap = new Map();

function initDefaultDevices() {
    if (!devicesMap.has(DEFAULT_DEVICE_ID)) {
        devicesMap.set(DEFAULT_DEVICE_ID, {
            _id: DEFAULT_DEVICE_ID,
            device_id: DEFAULT_DEVICE_ID,
            device_name: DEFAULT_DEVICE_NAME,
            device_type: 'ESP32',
            is_enabled: true,
            token_hash: hashToken(DEFAULT_DEVICE_TOKEN),
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            last_seen_at: null,
            status: 'offline'
        });
    }
}

initDefaultDevices();

/**
 * Retrieves Upstash Redis / Vercel KV REST credentials
 */
function getKvConfig() {
    const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '').trim();
    const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '').trim();
    return {
        configured: Boolean(url && token),
        url,
        token
    };
}

/**
 * Executes a REST command against Upstash Redis / Vercel KV
 */
async function kvCommand(commandArray) {
    const config = getKvConfig();
    if (!config.configured) return null;

    try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 2500);

        const res = await fetch(config.url, {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${config.token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(commandArray),
            signal: controller.signal
        });
        clearTimeout(timeoutId);

        if (!res.ok) {
            console.error(`[Upstash KV Error]: HTTP ${res.status}`);
            return null;
        }

        const payload = await res.json();
        return payload.result;
    } catch (err) {
        console.error('[Upstash KV Fetch Error]:', err.message);
        return null;
    }
}

/**
 * Device Registry Operations
 */
async function getDevice(deviceId) {
    if (!deviceId) return null;
    const cleanId = deviceId.trim();

    const config = getKvConfig();
    if (config.configured) {
        const remoteJson = await kvCommand(['GET', `alpha:device:${cleanId}`]);
        if (remoteJson) {
            try { return JSON.parse(remoteJson); } catch (_) {}
        }
    }

    return devicesMap.get(cleanId) || null;
}

function getDeviceSync(deviceId) {
    if (!deviceId) return null;
    return devicesMap.get(deviceId.trim()) || null;
}

async function getAllDevices() {
    const config = getKvConfig();
    if (config.configured) {
        const keys = await kvCommand(['KEYS', 'alpha:device:*']);
        if (Array.isArray(keys) && keys.length > 0) {
            const devices = [];
            for (const key of keys) {
                const raw = await kvCommand(['GET', key]);
                if (raw) {
                    try {
                        const dev = JSON.parse(raw);
                        delete dev.token_hash;
                        devices.push(dev);
                    } catch (_) {}
                }
            }
            if (devices.length > 0) return devices;
        }
    }

    return Array.from(devicesMap.values()).map(dev => {
        const copy = { ...dev };
        delete copy.token_hash;
        return copy;
    });
}

async function registerDevice(deviceId, deviceName, deviceType = 'ESP32') {
    const cleanId = deviceId.trim();
    const existing = await getDevice(cleanId);
    if (existing) {
        return { success: false, statusCode: 409, error: `Device ID '${cleanId}' is already registered.` };
    }

    const plainToken = generateDeviceToken(cleanId);
    const nowIso = new Date().toISOString();
    const newDev = {
        _id: cleanId,
        device_id: cleanId,
        device_name: (deviceName || cleanId).trim(),
        device_type: (deviceType || 'ESP32').trim(),
        is_enabled: true,
        token_hash: hashToken(plainToken),
        created_at: nowIso,
        updated_at: nowIso,
        last_seen_at: null,
        status: 'offline'
    };

    devicesMap.set(cleanId, newDev);

    const config = getKvConfig();
    if (config.configured) {
        await kvCommand(['SET', `alpha:device:${cleanId}`, JSON.stringify(newDev)]);
    }

    return { success: true, device: newDev, plainToken };
}

async function updateDevice(deviceId, fields) {
    const dev = await getDevice(deviceId);
    if (!dev) return null;

    if (typeof fields.device_name === 'string' && fields.device_name.trim()) {
        dev.device_name = fields.device_name.trim();
    }
    if (typeof fields.device_type === 'string' && fields.device_type.trim()) {
        dev.device_type = fields.device_type.trim();
    }
    if (typeof fields.is_enabled === 'boolean') {
        dev.is_enabled = fields.is_enabled;
    }

    dev.updated_at = new Date().toISOString();
    devicesMap.set(deviceId, dev);

    const config = getKvConfig();
    if (config.configured) {
        await kvCommand(['SET', `alpha:device:${deviceId}`, JSON.stringify(dev)]);
    }

    const copy = { ...dev };
    delete copy.token_hash;
    return copy;
}

async function deleteDevice(deviceId) {
    const cleanId = deviceId.trim();
    const existedLocal = devicesMap.delete(cleanId);
    latestReadingsMap.delete(cleanId);

    const config = getKvConfig();
    if (config.configured) {
        await kvCommand(['DEL', `alpha:device:${cleanId}`]);
        await kvCommand(['DEL', `alpha:reading:${cleanId}`]);
    }

    return existedLocal;
}

async function rotateDeviceToken(deviceId) {
    const dev = await getDevice(deviceId);
    if (!dev) return null;

    const newToken = generateDeviceToken(deviceId);
    dev.token_hash = hashToken(newToken);
    dev.updated_at = new Date().toISOString();
    devicesMap.set(deviceId, dev);

    const config = getKvConfig();
    if (config.configured) {
        await kvCommand(['SET', `alpha:device:${deviceId}`, JSON.stringify(dev)]);
    }

    return newToken;
}

/**
 * Telemetry Operations
 */
async function getLatestReading(deviceId) {
    if (!deviceId) return null;
    const cleanId = deviceId.trim();

    const config = getKvConfig();
    if (config.configured) {
        const rawJson = await kvCommand(['GET', `alpha:reading:${cleanId}`]);
        if (rawJson) {
            try { return JSON.parse(rawJson); } catch (_) {}
        }
    }

    return latestReadingsMap.get(cleanId) || null;
}

async function setLatestReading(deviceId, readingDoc) {
    const cleanId = deviceId.trim();
    latestReadingsMap.set(cleanId, readingDoc);

    const dev = (await getDevice(cleanId)) || devicesMap.get(cleanId);
    if (dev) {
        dev.last_seen_at = readingDoc.server_received_at;
        dev.status = 'online';
        dev.updated_at = readingDoc.server_received_at;
        devicesMap.set(cleanId, dev);

        const config = getKvConfig();
        if (config.configured) {
            await kvCommand(['SET', `alpha:reading:${cleanId}`, JSON.stringify(readingDoc)]);
            await kvCommand(['SET', `alpha:device:${cleanId}`, JSON.stringify(dev)]);
        }
    }
}

/**
 * Health & Diagnostics
 */
async function getStoreStatus() {
    const config = getKvConfig();
    if (config.configured) {
        const pingResult = await kvCommand(['PING']);
        const isHealthy = pingResult === 'PONG';
        return {
            provider: 'upstash-redis',
            shared_storage_configured: true,
            connected: isHealthy,
            persistent: false,
            mode: 'shared-kv-store',
            message: isHealthy ? 'Upstash Redis KV connection active & verified.' : 'Upstash Redis KV connection error.',
            devicesCount: devicesMap.size,
            readingsCount: latestReadingsMap.size
        };
    }

    return {
        provider: 'none (in-memory standby)',
        shared_storage_configured: false,
        connected: false,
        persistent: false,
        mode: 'standalone-memory',
        message: 'Shared storage not configured. Configure UPSTASH_REDIS_REST_URL and TOKEN on Vercel for live cross-invocation telemetry.',
        devicesCount: devicesMap.size,
        readingsCount: latestReadingsMap.size
    };
}

/**
 * Reset store (for unit test isolation)
 */
function resetStore() {
    devicesMap.clear();
    latestReadingsMap.clear();
    initDefaultDevices();
}

module.exports = {
    hashToken,
    generateDeviceToken,
    getDevice,
    getDeviceSync,
    getAllDevices,
    registerDevice,
    updateDevice,
    deleteDevice,
    rotateDeviceToken,
    getLatestReading,
    setLatestReading,
    getStoreStatus,
    resetStore,
    DEFAULT_DEVICE_ID,
    DEFAULT_DEVICE_TOKEN
};
