/**
 * Alpha Squared IoT - MongoDB Atlas Database Connector & Connection Pool
 * Optimized for Vercel Serverless Functions with connection caching.
 */

const { MongoClient, ServerApiVersion } = require('mongodb');

let cachedClient = null;
let cachedDb = null;
let indexesCreated = false;

function getMongoUri() {
    return process.env.MONGODB_URI || process.env.MONGO_URL || '';
}

function getDatabaseName() {
    if (process.env.MONGODB_DB_NAME && process.env.MONGODB_DB_NAME.trim()) {
        return process.env.MONGODB_DB_NAME.trim();
    }
    const uri = getMongoUri();
    if (uri) {
        try {
            const url = new URL(uri.replace('mongodb+srv://', 'http://').replace('mongodb://', 'http://'));
            const dbFromPath = url.pathname ? url.pathname.replace(/^\//, '').split('?')[0].trim() : '';
            if (dbFromPath) {
                return dbFromPath;
            }
        } catch (_) {}
    }
    return 'alpha_squad';
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
 * Creates required indexes for devices and sensor_readings collections
 */
async function ensureIndexes(db) {
    const devicesCol = db.collection('devices');
    const readingsCol = db.collection('sensor_readings');

    await devicesCol.createIndex({ device_id: 1 }, { unique: true });
    await devicesCol.createIndex({ is_enabled: 1 });
    await devicesCol.createIndex({ last_seen_at: -1 });

    await readingsCol.createIndex({ device_id: 1, server_received_at: -1 });
    await readingsCol.createIndex({ server_received_at: -1 });
    await readingsCol.createIndex({ device_id: 1, is_simulated: 1, server_received_at: -1 });

    // Seed default ALPHA-001 device if not already present
    const crypto = require('crypto');
    const demoHash = crypto.createHash('sha256').update('alphadev_demo_secret_token_12345').digest('hex');
    const nowIso = new Date().toISOString();
    await devicesCol.updateOne(
        { device_id: 'ALPHA-001' },
        {
            $setOnInsert: {
                device_id: 'ALPHA-001',
                device_name: 'Alpha Squad Health Monitor Node 1',
                device_type: 'ESP32',
                token_hash: demoHash,
                is_enabled: true,
                created_at: nowIso,
                updated_at: nowIso,
                last_seen_at: null,
                status: 'offline',
                metadata: {}
            }
        },
        { upsert: true }
    );

    // Emergency Events & Calls Collections
    const eventsCol = db.collection('emergency_events');
    const callsCol = db.collection('emergency_calls');
    const contactsCol = db.collection('patient_contacts');
    const patientEventsCol = db.collection('patient_events');

    await eventsCol.createIndex({ event_id: 1 }, { unique: true });
    await eventsCol.createIndex({ created_at: -1 });
    await eventsCol.createIndex({ acknowledged: 1 });
    await eventsCol.createIndex({ zone: 1 });

    await callsCol.createIndex({ event_id: 1 });
    await callsCol.createIndex({ initiated_at: -1 });

    await contactsCol.createIndex({ contact_type: 1 }, { unique: true });
    await patientEventsCol.createIndex({ timestamp: -1 });

    // Seed default primary and secondary emergency contacts
    await contactsCol.updateOne(
        { contact_type: 'primary' },
        {
            $setOnInsert: {
                contact_type: 'primary',
                name: 'Dr. Marcus Vance (Primary Caregiver)',
                relation: 'Physician / Family',
                phone: process.env.PRIMARY_EMERGENCY_PHONE || '+919876543210',
                email: process.env.GMAIL_RECEIVER || 'caregiver-or-doctor-email@gmail.com',
                call_enabled: true,
                email_enabled: true,
                telegram_enabled: true,
                updated_at: nowIso
            }
        },
        { upsert: true }
    );

    await contactsCol.updateOne(
        { contact_type: 'secondary' },
        {
            $setOnInsert: {
                contact_type: 'secondary',
                name: 'Sarah Vance (Secondary Contact)',
                relation: 'Daughter',
                phone: process.env.SECONDARY_EMERGENCY_PHONE || '+919876543211',
                email: 'secondary-caregiver@gmail.com',
                call_enabled: true,
                email_enabled: true,
                telegram_enabled: false,
                updated_at: nowIso
            }
        },
        { upsert: true }
    );
}

/**
 * Returns the 'devices' collection
 */
async function getDevicesCollection() {
    const { db } = await connectToDatabase();
    return db.collection('devices');
}

/**
 * Returns the 'sensor_readings' collection
 */
async function getReadingsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('sensor_readings');
}

/**
 * Returns the 'emergency_events' collection
 */
async function getEmergencyEventsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('emergency_events');
}

/**
 * Returns the 'emergency_calls' collection
 */
async function getEmergencyCallsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('emergency_calls');
}

/**
 * Returns the 'patient_contacts' collection
 */
async function getPatientContactsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('patient_contacts');
}

/**
 * Returns the 'patient_events' collection (warnings and zone transitions)
 */
async function getPatientEventsCollection() {
    const { db } = await connectToDatabase();
    return db.collection('patient_events');
}

/**
 * Safe status inspection for health check endpoint
 */
async function getDbStatus() {
    const uri = getMongoUri();
    if (!uri) {
        return {
            provider: 'mongodb-atlas',
            connected: false,
            database: null,
            message: 'MONGODB_URI is not configured in environment variables.',
            devicesCount: 0,
            readingsCount: 0
        };
    }

    try {
        const { db } = await connectToDatabase();
        await db.command({ ping: 1 });

        const devicesCount = await db.collection('devices').countDocuments();
        const readingsCount = await db.collection('sensor_readings').countDocuments();

        return {
            provider: 'mongodb-atlas',
            connected: true,
            database: getDatabaseName(),
            message: 'MongoDB Atlas connection active and verified.',
            devicesCount,
            readingsCount
        };
    } catch (err) {
        return {
            provider: 'mongodb-atlas',
            connected: false,
            database: getDatabaseName(),
            message: `Connection error: ${err.message}`,
            devicesCount: 0,
            readingsCount: 0
        };
    }
}

module.exports = {
    connectToDatabase,
    getDbStatus,
    getDevicesCollection,
    getReadingsCollection,
    getEmergencyEventsCollection,
    getEmergencyCallsCollection,
    getPatientContactsCollection,
    getPatientEventsCollection,
    getMongoUri,
    getDatabaseName
};
