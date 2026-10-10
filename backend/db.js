/**
 * Alpha Squared IoT - MongoDB Database Connection & Abstraction Layer
 * Connects to MongoDB Atlas using the official 'mongodb' Node.js driver.
 * Implements serverless connection caching optimized for Vercel functions.
 */

try {
    require('dotenv').config();
} catch (_) {}

const { MongoClient, ServerApiVersion } = require('mongodb');

let cachedClient = null;
let cachedDb = null;
let indexesCreated = false;

function getMongoUri() {
    return (process.env.MONGODB_URI || process.env.MONGO_URL || '').trim();
}

function getDatabaseName() {
    return (process.env.MONGODB_DB_NAME || 'alpha_squared_iot').trim();
}

/**
 * Connect to MongoDB Atlas with connection caching for serverless environments.
 * If credentials are not configured, throws an explicit configuration error.
 */
async function connectToDatabase() {
    const uri = getMongoUri();
    if (!uri) {
        throw new Error('MONGODB_URI environment variable is not configured.');
    }

    if (cachedClient && cachedDb) {
        try {
            // Verify connection is alive
            await cachedDb.command({ ping: 1 });
            return { client: cachedClient, db: cachedDb };
        } catch (_) {
            cachedClient = null;
            cachedDb = null;
        }
    }

    const client = new MongoClient(uri, {
        serverApi: {
            version: ServerApiVersion.v1,
            strict: true,
            deprecationErrors: true,
        },
        connectTimeoutMS: 8000,
        socketTimeoutMS: 15000,
        maxPoolSize: 10
    });

    await client.connect();
    const db = client.db(getDatabaseName());

    cachedClient = client;
    cachedDb = db;

    // Ensure database indexes on initial connection
    if (!indexesCreated) {
        try {
            await ensureIndexes(db);
            indexesCreated = true;
        } catch (idxErr) {
            console.warn('[MongoDB] Index creation warning:', idxErr.message);
        }
    }

    return { client: cachedClient, db: cachedDb };
}

/**
 * Ensures optimal indexes exist for device lookups and time-series telemetry queries
 */
async function ensureIndexes(db) {
    const devicesCol = db.collection('devices');
    const readingsCol = db.collection('sensor_readings');

    // Devices unique index on device_id
    await devicesCol.createIndex({ device_id: 1 }, { unique: true });
    await devicesCol.createIndex({ status: 1 });

    // Sensor readings high-performance compound indexes
    await readingsCol.createIndex({ device_id: 1, server_received_at: -1 });
    await readingsCol.createIndex({ server_received_at: -1 });
    await readingsCol.createIndex({ device_id: 1, is_simulated: 1, server_received_at: -1 });
}

/**
 * Retrieves database connectivity health without exposing secrets
 */
async function getDbStatus() {
    const uri = getMongoUri();
    if (!uri) {
        return {
            provider: 'mongodb-atlas',
            connected: false,
            message: 'MONGODB_URI is not configured in environment variables.',
            devicesCount: 0,
            readingsCount: 0
        };
    }

    try {
        const { db } = await connectToDatabase();
        await db.command({ ping: 1 });
        const devCount = await db.collection('devices').countDocuments();
        const readCount = await db.collection('sensor_readings').countDocuments();

        return {
            provider: 'mongodb-atlas',
            connected: true,
            database: getDatabaseName(),
            message: 'MongoDB Atlas connection active and verified.',
            devicesCount: devCount,
            readingsCount: readCount
        };
    } catch (err) {
        return {
            provider: 'mongodb-atlas',
            connected: false,
            message: `MongoDB Atlas connection error: ${err.message}`,
            devicesCount: 0,
            readingsCount: 0
        };
    }
}

/**
 * Get access to the 'devices' collection
 */
async function getDevicesCollection() {
    const { db } = await connectToDatabase();
    return db.collection('devices');
}

/**
 * Get access to the 'sensor_readings' collection
 */
async function getReadingsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('sensor_readings');
}

module.exports = {
    connectToDatabase,
    getDbStatus,
    getDevicesCollection,
    getReadingsCollection,
    getMongoUri,
    getDatabaseName
};
