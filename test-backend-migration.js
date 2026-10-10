/**
 * Alpha Squared IoT Backend - Comprehensive MongoDB Migration Verification Test Suite
 * Tests all endpoints, authentication, range validation, non-fabrication of missing sensors,
 * error handling, and device management.
 */

const assert = require('assert');
const crypto = require('crypto');
const db = require('./backend/db');
const auth = require('./backend/auth');
const validation = require('./backend/validation');
const healthHandler = require('./api/iot/health');
const dataHandler = require('./api/iot/data');
const devicesHandler = require('./api/iot/devices');
const readingHandler = require('./api/iot/device-reading');

// Simple Mock Response helper
function createMockRes() {
    return {
        statusCode: 200,
        headers: {},
        body: null,
        status(code) {
            this.statusCode = code;
            return this;
        },
        json(data) {
            this.body = data;
            return this;
        },
        setHeader(k, v) {
            this.headers[k] = v;
        },
        end() {
            return this;
        }
    };
}

// In-Memory MongoDB Collections Mock for Testing
function createMongoMockDb() {
    const devices = new Map();
    const readings = [];

    const devicesCol = {
        async findOne(filter, options) {
            for (const dev of devices.values()) {
                let match = true;
                for (const [k, v] of Object.entries(filter)) {
                    if (dev[k] !== v) match = false;
                }
                if (match) {
                    const cloned = { ...dev };
                    if (options && options.projection && options.projection.token_hash === 0) {
                        delete cloned.token_hash;
                    }
                    return cloned;
                }
            }
            return null;
        },
        async insertOne(doc) {
            const id = 'dev_' + Math.random().toString(36).substring(2, 9);
            const saved = { _id: id, ...doc };
            devices.set(doc.device_id, saved);
            return { insertedId: id };
        },
        async updateOne(filter, update) {
            const dev = devices.get(filter.device_id);
            if (dev && update.$set) {
                Object.assign(dev, update.$set);
                return { modifiedCount: 1 };
            }
            return { modifiedCount: 0 };
        },
        async findOneAndUpdate(filter, update, options) {
            const dev = devices.get(filter.device_id);
            if (dev && update.$set) {
                Object.assign(dev, update.$set);
                const ret = { ...dev };
                if (options && options.projection && options.projection.token_hash === 0) {
                    delete ret.token_hash;
                }
                return ret;
            }
            return null;
        },
        async deleteOne(filter) {
            const existed = devices.delete(filter.device_id);
            return { deletedCount: existed ? 1 : 0 };
        },
        find(filter, options) {
            const list = Array.from(devices.values()).map(d => {
                const c = { ...d };
                if (options && options.projection && options.projection.token_hash === 0) {
                    delete c.token_hash;
                }
                return c;
            });
            return {
                sort() { return this; },
                async toArray() { return list; }
            };
        },
        async countDocuments() {
            return devices.size;
        }
    };

    const readingsCol = {
        async insertOne(doc) {
            const id = 'rd_' + Math.random().toString(36).substring(2, 9);
            const saved = { _id: id, ...doc };
            readings.push(saved);
            return { insertedId: id };
        },
        async countDocuments(filter) {
            if (!filter || !filter.device_id) return readings.length;
            return readings.filter(r => r.device_id === filter.device_id).length;
        },
        find(filter) {
            let filtered = readings.filter(r => {
                if (filter.device_id && r.device_id !== filter.device_id) return false;
                if (filter.is_simulated !== undefined && r.is_simulated !== filter.is_simulated) return false;
                if (filter['gps.latitude'] && r.gps.latitude === null) return false;
                return true;
            });
            return {
                sort(sortCriteria) {
                    if (sortCriteria && sortCriteria.server_received_at === -1) {
                        filtered.sort((a, b) => new Date(b.server_received_at) - new Date(a.server_received_at));
                    } else if (sortCriteria && sortCriteria.server_received_at === 1) {
                        filtered.sort((a, b) => new Date(a.server_received_at) - new Date(b.server_received_at));
                    }
                    return this;
                },
                limit(n) {
                    filtered = filtered.slice(0, n);
                    return this;
                },
                project() { return this; },
                async next() {
                    return filtered[0] || null;
                },
                async toArray() {
                    return filtered;
                }
            };
        },
        async deleteMany(filter) {
            const before = readings.length;
            const remaining = readings.filter(r => r.device_id !== filter.device_id);
            readings.length = 0;
            readings.push(...remaining);
            return { deletedCount: before - readings.length };
        }
    };

    return { devices, readings, devicesCol, readingsCol };
}

async function runTests() {
    console.log('================================================================');
    console.log('ALPHA SQUARED IoT - MONGODB MIGRATION VERIFICATION SUITE');
    console.log('================================================================\n');

    let passed = 0;
    let failed = 0;

    function record(name, condition) {
        if (condition) {
            console.log(`  [PASS] ${name}`);
            passed++;
        } else {
            console.error(`  [FAIL] ${name}`);
            failed++;
        }
    }

    // ------------------------------------------------------------------------
    // TEST 1: Unconfigured MongoDB Health Check (Safe degradation)
    // ------------------------------------------------------------------------
    console.log('Test 1: Health Check without MONGODB_URI configured');
    const origUri = process.env.MONGODB_URI;
    delete process.env.MONGODB_URI;
    delete process.env.MONGO_URL;

    const healthRes1 = createMockRes();
    await healthHandler({ method: 'GET', url: '/api/iot/health', headers: {} }, healthRes1);
    record('Health endpoint returns HTTP 200 when unconfigured', healthRes1.statusCode === 200);
    record('Health reports status: degraded', healthRes1.body.status === 'degraded');
    record('Health reports provider: mongodb-atlas', healthRes1.body.database.provider === 'mongodb-atlas');
    record('Health reports connected: false', healthRes1.body.database.connected === false);

    // ------------------------------------------------------------------------
    // TEST 2: Ingestion when MongoDB is unconfigured fails safely (no silent fallback)
    // ------------------------------------------------------------------------
    console.log('\nTest 2: Telemetry Ingestion without MONGODB_URI configured');
    const dataResFail = createMockRes();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: { 'x-device-token': 'some_token' },
        body: { device_id: 'ALPHA-001', timestamp: new Date().toISOString() }
    }, dataResFail);
    record('Ingestion fails with HTTP 500 when database is not configured', dataResFail.statusCode === 500);
    record('Response contains explicit database authentication error', typeof dataResFail.body.error === 'string');

    // ------------------------------------------------------------------------
    // SETUP MOCK DATABASE FOR IN-DEPTH HANDLER TESTS
    // ------------------------------------------------------------------------
    console.log('\nSetting up MongoDB Mock Adapter for Endpoint Integration Tests...');
    const mockDb = createMongoMockDb();
    
    // Seed test device ALPHA-001
    const testDeviceId = 'ALPHA-001';
    const testToken = 'alphadev_alpha001_secret_998877';
    const testHash = auth.hashToken(testToken);
    await mockDb.devicesCol.insertOne({
        device_id: testDeviceId,
        device_name: 'Alpha Node Alpha-001',
        device_type: 'ESP32',
        token_hash: testHash,
        is_enabled: true,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_seen_at: null,
        status: 'offline',
        metadata: {}
    });

    // Seed disabled device ALPHA-DIS
    const disDeviceId = 'ALPHA-DIS';
    const disToken = 'alphadev_dis_secret_123';
    await mockDb.devicesCol.insertOne({
        device_id: disDeviceId,
        device_name: 'Disabled Device',
        device_type: 'ESP32',
        token_hash: auth.hashToken(disToken),
        is_enabled: false,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        last_seen_at: null,
        status: 'disabled',
        metadata: {}
    });

    // Mock db getters
    db.getDevicesCollection = async () => mockDb.devicesCol;
    db.getReadingsCollection = async () => mockDb.readingsCol;
    db.getDbStatus = async () => ({
        provider: 'mongodb-atlas',
        connected: true,
        database: 'alpha_squared_iot',
        message: 'MongoDB Atlas connection active and verified.',
        devicesCount: await mockDb.devicesCol.countDocuments(),
        readingsCount: await mockDb.readingsCol.countDocuments()
    });

    // ------------------------------------------------------------------------
    // TEST 3: Health check with Mocked Active MongoDB
    // ------------------------------------------------------------------------
    console.log('\nTest 3: Health Check with Active MongoDB');
    const healthRes2 = createMockRes();
    await healthHandler({ method: 'GET', url: '/api/iot/health', headers: {} }, healthRes2);
    record('Active health check returns HTTP 200', healthRes2.statusCode === 200);
    record('Active health check reports status: operational', healthRes2.body.status === 'operational');
    record('Active health check database connected: true', healthRes2.body.database.connected === true);
    record('Active health check reports registered devices count: 2', healthRes2.body.database.registered_devices === 2);

    // ------------------------------------------------------------------------
    // TEST 4: Authentication & Security Edge Cases on POST /api/iot/data
    // ------------------------------------------------------------------------
    console.log('\nTest 4: Ingestion Authentication Checks');
    
    // 4.1 Missing Token
    const resNoToken = createMockRes();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: {},
        body: { device_id: testDeviceId, timestamp: new Date().toISOString() }
    }, resNoToken);
    record('Missing token rejected with 401', resNoToken.statusCode === 401);

    // 4.2 Invalid Token
    const resBadToken = createMockRes();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: { 'x-device-token': 'wrong_invalid_token' },
        body: { device_id: testDeviceId, timestamp: new Date().toISOString() }
    }, resBadToken);
    record('Invalid token rejected with 401', resBadToken.statusCode === 401);

    // 4.3 Unregistered Device
    const resUnreg = createMockRes();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: { 'x-device-token': 'some_token' },
        body: { device_id: 'UNKNOWN-DEVICE', timestamp: new Date().toISOString() }
    }, resUnreg);
    record('Unregistered device rejected with 404', resUnreg.statusCode === 404);

    // 4.4 Disabled Device
    const resDisabled = createMockRes();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: { 'x-device-token': disToken },
        body: { device_id: disDeviceId, timestamp: new Date().toISOString() }
    }, resDisabled);
    record('Disabled device rejected with 403', resDisabled.statusCode === 403);

    // ------------------------------------------------------------------------
    // TEST 5: Telemetry Validation & Non-Fabrication of Missing Sensors
    // ------------------------------------------------------------------------
    console.log('\nTest 5: Telemetry Range Validation and Non-Fabrication');

    // 5.1 Out of range heart rate (> 220)
    const resHighHR = createMockRes();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: { 'x-device-token': testToken },
        body: {
            device_id: testDeviceId,
            timestamp: new Date().toISOString(),
            heart_rate: { value: 350, unit: 'bpm' }
        }
    }, resHighHR);
    record('Excessive heart rate (> 220) rejected with 400', resHighHR.statusCode === 400);

    // 5.2 Out of range temperature (> 65°C)
    const resLowTemp = createMockRes();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: { 'x-device-token': testToken },
        body: {
            device_id: testDeviceId,
            timestamp: new Date().toISOString(),
            temperature: { value: 75.0, unit: 'C' }
        }
    }, resLowTemp);
    record('Extreme out-of-range temperature rejected with 400', resLowTemp.statusCode === 400);

    // 5.3 Valid Ingestion with Missing Optional Sensors (BP & GPS omitted)
    const resValid1 = createMockRes();
    const readingTime = new Date().toISOString();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: { 'x-device-token': testToken },
        body: {
            device_id: testDeviceId,
            timestamp: readingTime,
            temperature: { value: 36.8, unit: 'C' },
            heart_rate: { value: 74, unit: 'bpm' },
            battery_level: 92,
            signal_strength: -65
        }
    }, resValid1);
    record('Valid telemetry accepted with 201 Created', resValid1.statusCode === 201);
    record('Response confirms storage_mode: mongodb-atlas', resValid1.body.storage_mode === 'mongodb-atlas');
    record('Response provides reading_id', typeof resValid1.body.reading_id === 'string');

    // Verify stored reading document in mock MongoDB
    const storedReading = mockDb.readings[0];
    record('Stored reading has matching device_id', storedReading.device_id === testDeviceId);
    record('Stored temperature value is 36.8', storedReading.temperature.value === 36.8);
    record('Stored heart rate value is 74', storedReading.heart_rate.value === 74);
    record('Missing blood pressure systolic is strictly null (NEVER fabricated)', storedReading.blood_pressure.systolic === null);
    record('Missing blood pressure diastolic is strictly null (NEVER fabricated)', storedReading.blood_pressure.diastolic === null);
    record('Blood pressure status marked as "not_installed"', storedReading.blood_pressure.sensor_status === 'not_installed');
    record('Missing GPS latitude is strictly null', storedReading.gps.latitude === null);
    record('Missing GPS fix_valid is strictly false', storedReading.gps.fix_valid === false);

    // Verify device status updated to 'online' in MongoDB
    const updatedDev = mockDb.devices.get(testDeviceId);
    record('Device status automatically updated to "online"', updatedDev.status === 'online');
    record('Device last_seen_at timestamp updated', typeof updatedDev.last_seen_at === 'string');

    // 5.4 Valid Telemetry with GPS & BP present (wait 50ms so timestamp is strictly newer)
    await new Promise(r => setTimeout(r, 50));
    const resValid2 = createMockRes();
    await dataHandler({
        method: 'POST',
        url: '/api/iot/data',
        headers: { 'Authorization': `Bearer ${testToken}` },
        body: {
            device_id: testDeviceId,
            timestamp: new Date().toISOString(),
            temperature: { value: 37.1, unit: 'C' },
            heart_rate: { value: 82, unit: 'bpm' },
            blood_pressure: { systolic: 120, diastolic: 80, unit: 'mmHg' },
            gps: { latitude: 28.6139, longitude: 77.2090, fix_valid: true },
            battery_level: 88,
            signal_strength: -70
        }
    }, resValid2);
    record('Second valid telemetry with GPS/BP accepted with 201', resValid2.statusCode === 201);
    const storedReading2 = mockDb.readings[1];
    record('Supplied BP systolic (120) saved correctly', storedReading2.blood_pressure.systolic === 120);
    record('Supplied GPS latitude saved correctly', storedReading2.gps.latitude === 28.6139);
    record('Supplied GPS fix_valid is true', storedReading2.gps.fix_valid === true);

    // ------------------------------------------------------------------------
    // TEST 6: Query Endpoints (api/iot/device-reading.js)
    // ------------------------------------------------------------------------
    console.log('\nTest 6: Reading Retrieval Endpoints');

    // 6.1 Latest reading: GET /api/iot/device/:id/latest
    const resLatest = createMockRes();
    await readingHandler({
        method: 'GET',
        url: `/api/iot/device/${testDeviceId}/latest`,
        query: { id: testDeviceId, view: 'latest' },
        headers: {}
    }, resLatest);
    record('Latest reading endpoint returns 200', resLatest.statusCode === 200);
    record('Latest reading has_data: true', resLatest.body.has_data === true);
    record('Latest reading temperature is 37.1', resLatest.body.reading.temperature.value === 37.1);
    record('Latest reading heart rate is 82', resLatest.body.reading.heart_rate.value === 82);
    record('Latest reading GPS latitude is 28.6139', resLatest.body.reading.gps.latitude === 28.6139);

    // 6.2 History readings: GET /api/iot/device/:id/history
    const resHistory = createMockRes();
    await readingHandler({
        method: 'GET',
        url: `/api/iot/device/${testDeviceId}/history?range=1h`,
        query: { id: testDeviceId, view: 'history', range: '1h' },
        headers: {}
    }, resHistory);
    record('History endpoint returns 200', resHistory.statusCode === 200);
    record('History returns data array with 2 records', resHistory.body.data.length === 2);
    record('History series items contain temperature & heart_rate', resHistory.body.data[0].temperature !== undefined);

    // 6.3 Device status: GET /api/iot/device/:id/status
    const resStatus = createMockRes();
    await readingHandler({
        method: 'GET',
        url: `/api/iot/device/${testDeviceId}/status`,
        query: { id: testDeviceId, view: 'status' },
        headers: {}
    }, resStatus);
    record('Status endpoint returns 200', resStatus.statusCode === 200);
    record('Status reports device online', resStatus.body.connectivity === 'online');
    record('Status reports GPS fix acquired', resStatus.body.sensors.gps === 'fix_acquired');

    // 6.4 Location history: GET /api/iot/device/:id/location-history
    const resLoc = createMockRes();
    await readingHandler({
        method: 'GET',
        url: `/api/iot/device/${testDeviceId}/location-history`,
        query: { id: testDeviceId, view: 'location-history' },
        headers: {}
    }, resLoc);
    record('Location history returns 200', resLoc.statusCode === 200);
    record('Location history contains 1 GPS point (ignoring null)', resLoc.body.count === 1);
    record('Location history latitude is 28.6139', resLoc.body.locations[0].latitude === 28.6139);

    // ------------------------------------------------------------------------
    // TEST 7: Device Management Endpoints (api/iot/devices.js)
    // ------------------------------------------------------------------------
    console.log('\nTest 7: Device Management CRUD and Token Rotation');

    // 7.1 Register new device with admin auth
    const newDevId = 'ALPHA-002';
    const resReg = createMockRes();
    await devicesHandler({
        method: 'POST',
        url: '/api/iot/devices',
        headers: { 'x-admin-key': auth.DEFAULT_DEV_ADMIN_KEY },
        body: { device_id: newDevId, device_name: 'Patient Ward 2 Unit' }
    }, resReg);
    record('Device registration returns 201 Created', resReg.statusCode === 201);
    record('Device registration returns plain device_token', typeof resReg.body.device_token === 'string');
    record('Device registration returned token starts with alphadev_', resReg.body.device_token.startsWith('alphadev_'));

    // Check token is stored hashed in MongoDB
    const devInDb = mockDb.devices.get(newDevId);
    record('Stored token in MongoDB is SHA-256 hashed (64 chars)', devInDb.token_hash.length === 64);
    record('Plain token is NOT stored in MongoDB', devInDb.device_token === undefined);

    // 7.2 List devices: GET /api/iot/devices
    const resList = createMockRes();
    await devicesHandler({
        method: 'GET',
        url: '/api/iot/devices',
        headers: {}
    }, resList);
    record('List devices returns 200', resList.statusCode === 200);
    record('List devices contains 3 devices', resList.body.count === 3);

    // 7.3 Get single device: GET /api/iot/devices/:id
    const resGetSingle = createMockRes();
    await devicesHandler({
        method: 'GET',
        url: `/api/iot/devices/${newDevId}`,
        query: { id: newDevId },
        headers: {}
    }, resGetSingle);
    record('Get single device returns 200', resGetSingle.statusCode === 200);
    record('Get single device does NOT leak token_hash', resGetSingle.body.device.token_hash === undefined);
    record('Get single device has correct name', resGetSingle.body.device.device_name === 'Patient Ward 2 Unit');

    // 7.4 Patch device: PATCH /api/iot/devices/:id
    const resPatch = createMockRes();
    await devicesHandler({
        method: 'PATCH',
        url: `/api/iot/devices/${newDevId}`,
        query: { id: newDevId },
        headers: { 'x-admin-key': auth.DEFAULT_DEV_ADMIN_KEY },
        body: { device_name: 'Patient Ward 2 Updated' }
    }, resPatch);
    record('Patch device returns 200', resPatch.statusCode === 200);
    record('Patch device updated device_name', devInDb.device_name === 'Patient Ward 2 Updated');

    // 7.5 Rotate token: POST /api/iot/devices/:id/rotate-token
    const oldHash = devInDb.token_hash;
    const resRotate = createMockRes();
    await devicesHandler({
        method: 'POST',
        url: `/api/iot/devices/${newDevId}/rotate-token`,
        query: { id: newDevId, action: 'rotate-token' },
        headers: { 'x-admin-key': auth.DEFAULT_DEV_ADMIN_KEY },
        body: {}
    }, resRotate);
    record('Rotate token returns 200', resRotate.statusCode === 200);
    record('Rotate token returns new_device_token', typeof resRotate.body.new_device_token === 'string');
    record('Stored token_hash in database is updated', devInDb.token_hash !== oldHash);

    // 7.6 Delete device: DELETE /api/iot/devices/:id
    const resDelete = createMockRes();
    await devicesHandler({
        method: 'DELETE',
        url: `/api/iot/devices/${newDevId}`,
        query: { id: newDevId },
        headers: { 'x-admin-key': auth.DEFAULT_DEV_ADMIN_KEY }
    }, resDelete);
    record('Delete device returns 200', resDelete.statusCode === 200);
    record('Device removed from MongoDB', !mockDb.devices.has(newDevId));

    console.log('\n================================================================');
    console.log(`TEST SUMMARY: ${passed} PASSED, ${failed} FAILED`);
    console.log('================================================================\n');

    if (failed > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error('Test runner fatal error:', err);
    process.exit(1);
});
