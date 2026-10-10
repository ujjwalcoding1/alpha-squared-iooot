/**
 * Alpha Squared IoT - MongoDB Atlas Database Initialization & Seed Script
 * 
 * Usage:
 *   node backend/database/mongo-init.js
 * 
 * Sets up collections:
 *   - 'devices' with unique index on device_id
 *   - 'sensor_readings' with compound indexes for time-series queries
 * Optionally seeds initial test device 'ALPHA-001' with correct SHA-256 token hash.
 */

try {
    require('dotenv').config();
} catch (_) {}

const { MongoClient, ServerApiVersion } = require('mongodb');
const crypto = require('crypto');

function hashToken(token) {
    return crypto.createHash('sha256').update(token.trim()).digest('hex');
}

async function initMongo() {
    const uri = process.env.MONGODB_URI || process.env.MONGO_URL;
    const dbName = process.env.MONGODB_DB_NAME || 'alpha_squared_iot';

    if (!uri) {
        console.error('Error: MONGODB_URI is not set. Please configure your connection string in .env');
        process.exit(1);
    }

    console.log(`[MongoDB Init] Connecting to database: ${dbName}...`);
    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true
        }
    });

    try {
        await client.connect();
        const db = client.db(dbName);
        console.log('[MongoDB Init] Connected successfully.');

        // 1. Devices Collection & Indexes
        const devicesCol = db.collection('devices');
        await devicesCol.createIndex({ device_id: 1 }, { unique: true });
        await devicesCol.createIndex({ status: 1 });
        console.log('[MongoDB Init] Created indexes on collection: devices');

        // 2. Sensor Readings Collection & Indexes
        const readingsCol = db.collection('sensor_readings');
        await readingsCol.createIndex({ device_id: 1, server_received_at: -1 });
        await readingsCol.createIndex({ server_received_at: -1 });
        await readingsCol.createIndex({ device_id: 1, is_simulated: 1, server_received_at: -1 });
        console.log('[MongoDB Init] Created indexes on collection: sensor_readings');

        // 3. Seed Initial Demo Device
        const demoDeviceId = 'ALPHA-001';
        const demoToken = 'alphadev_demo_secret_token_12345';
        const demoHash = hashToken(demoToken);
        const nowIso = new Date().toISOString();

        const existing = await devicesCol.findOne({ device_id: demoDeviceId });
        if (!existing) {
            await devicesCol.insertOne({
                device_id: demoDeviceId,
                device_name: 'Alpha Squared Health Monitor Node 1',
                device_type: 'ESP32',
                token_hash: demoHash,
                is_enabled: true,
                created_at: nowIso,
                updated_at: nowIso,
                last_seen_at: null,
                status: 'offline',
                metadata: {}
            });
            console.log(`[MongoDB Init] Seeded demo device '${demoDeviceId}'. Token: '${demoToken}'`);
        } else {
            console.log(`[MongoDB Init] Demo device '${demoDeviceId}' already exists.`);
        }

        console.log('[MongoDB Init] Database initialization complete!');
    } catch (err) {
        console.error('[MongoDB Init Error]:', err.message);
        process.exit(1);
    } finally {
        await client.close();
    }
}

if (require.main === module) {
    initMongo();
}

module.exports = { initMongo };

