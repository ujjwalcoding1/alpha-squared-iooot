/**
 * Alpha Squared IoT - Live Monitoring Test Suite (Without MongoDB)
 * Verifies live in-memory telemetry ingestion, device authentication, physiological validation,
 * reading retrieval endpoints, health checks, and device management CRUD.
 */

const http = require('http');

// Load live backend modules
const liveStore = require('./backend/live-store');
const healthHandler = require('./api/iot/health');
const dataHandler = require('./api/iot/data');
const readingHandler = require('./api/iot/device-reading');
const devicesHandler = require('./api/iot/devices');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  [PASS] ${message}`);
    } else {
        console.error(`  [FAIL] ${message}`);
        throw new Error(`Test assertion failed: ${message}`);
    }
}

function mockReqRes(method, url, headers = {}, body = null) {
    const req = {
        method,
        url,
        headers,
        body
    };

    let resData = null;
    let resStatus = 200;
    let resHeaders = {};

    const res = {
        status(code) {
            resStatus = code;
            return res;
        },
        setHeader(name, val) {
            resHeaders[name] = val;
            return res;
        },
        json(obj) {
            resData = obj;
            return res;
        },
        end() {
            return res;
        },
        _getStatus() { return resStatus; },
        _getData() { return resData; },
        _getHeaders() { return resHeaders; }
    };

    return { req, res };
}

async function runTests() {
    console.log("================================================================");
    console.log("ALPHA SQUARED IoT - LIVE MONITORING VERIFICATION SUITE");
    console.log("================================================================");

    // Reset live store before tests
    liveStore.resetStore();

    // ------------------------------------------------------------------------
    // Test 1: Health Endpoint Check
    // ------------------------------------------------------------------------
    console.log("\nTest 1: Health Endpoint Check");
    {
        const { req, res } = mockReqRes('GET', '/api/iot/health');
        await healthHandler(req, res);
        assert(res._getStatus() === 200, "Health check returns HTTP 200");
        const data = res._getData();
        assert(data.status === 'standalone_memory' || data.status === 'operational', "Health reports status cleanly");
        assert(data.mode === 'live-sensor-monitoring', "Health reports mode: live-sensor-monitoring");
        assert(typeof data.storage.shared_storage_configured === 'boolean', "Health reports shared_storage_configured boolean");
        assert(data.storage.persistent === false, "Health reports persistent: false");
    }

    // ------------------------------------------------------------------------
    // Test 2: Ingestion Authentication Checks
    // ------------------------------------------------------------------------
    console.log("\nTest 2: Ingestion Authentication Checks");
    {
        // Missing token
        const { req: req1, res: res1 } = mockReqRes('POST', '/api/iot/data', {}, { device_id: 'ALPHA-001' });
        await dataHandler(req1, res1);
        assert(res1._getStatus() === 401, "Missing token rejected with HTTP 401");

        // Invalid token
        const { req: req2, res: res2 } = mockReqRes('POST', '/api/iot/data', { 'x-device-token': 'wrong_token' }, { device_id: 'ALPHA-001' });
        await dataHandler(req2, res2);
        assert(res2._getStatus() === 401, "Invalid token rejected with HTTP 401");

        // Unregistered device
        const { req: req3, res: res3 } = mockReqRes('POST', '/api/iot/data', { 'x-device-token': liveStore.DEFAULT_DEVICE_TOKEN }, { device_id: 'UNREGISTERED-DEV' });
        await dataHandler(req3, res3);
        assert(res3._getStatus() === 404, "Unregistered device rejected with HTTP 404");
    }

    // ------------------------------------------------------------------------
    // Test 3: Telemetry Validation & Live Ingestion
    // ------------------------------------------------------------------------
    console.log("\nTest 3: Telemetry Validation & Live Ingestion");
    {
        // Out of range heart rate (> 220)
        const invalidBody = {
            device_id: 'ALPHA-001',
            temperature: { value: 36.6 },
            heart_rate: { value: 300 }
        };
        const { req: req1, res: res1 } = mockReqRes('POST', '/api/iot/data', { 'x-device-token': liveStore.DEFAULT_DEVICE_TOKEN }, invalidBody);
        await dataHandler(req1, res1);
        assert(res1._getStatus() === 400, "Out of range heart rate (>220) rejected with HTTP 400");

        // Valid Telemetry
        const validBody = {
            device_id: 'ALPHA-001',
            device_timestamp: new Date().toISOString(),
            temperature: { value: 36.8, unit: 'C', sensor_status: 'ok' },
            heart_rate: { value: 74, unit: 'bpm', sensor_status: 'ok' },
            gps: { latitude: 28.6139, longitude: 77.2090, fix_valid: true, sensor_status: 'ok' },
            sim800l: { status: 'ready', last_sms_status: 'submitted', last_call_status: 'idle' },
            battery_level: 92,
            signal_strength: -65
        };
        const { req: req2, res: res2 } = mockReqRes('POST', '/api/iot/data', { 'x-device-token': liveStore.DEFAULT_DEVICE_TOKEN }, validBody);
        await dataHandler(req2, res2);
        assert(res2._getStatus() === 201, "Valid telemetry accepted with HTTP 201 Created");
        const data = res2._getData();
        assert(data.storage_mode === 'live-in-memory', "Response confirms storage_mode: live-in-memory");
        assert(data.persistent === false, "Response confirms persistent: false");
    }

    // ------------------------------------------------------------------------
    // Test 4: Live Reading Retrieval Endpoints
    // ------------------------------------------------------------------------
    console.log("\nTest 4: Live Reading Retrieval Endpoints");
    {
        // Latest reading
        const { req: req1, res: res1 } = mockReqRes('GET', '/api/iot/device/ALPHA-001/latest');
        await readingHandler(req1, res1);
        assert(res1._getStatus() === 200, "Latest reading endpoint returns HTTP 200");
        const data1 = res1._getData();
        assert(data1.has_data === true, "Latest reading reports has_data: true");
        assert(data1.reading.temperature.value === 36.8, "Temperature value is 36.8");
        assert(data1.reading.heart_rate.value === 74, "Heart rate value is 74");
        assert(data1.reading.blood_pressure.systolic === null, "Missing systolic BP is strictly null");

        // Device Status
        const { req: req2, res: res2 } = mockReqRes('GET', '/api/iot/device/ALPHA-001/status');
        await readingHandler(req2, res2);
        assert(res2._getStatus() === 200, "Device status endpoint returns HTTP 200");
        const data2 = res2._getData();
        assert(data2.connectivity === 'online', "Device status reports connectivity: online");
        assert(data2.sensors.gps === 'fix_acquired', "GPS sensor status reports fix_acquired");

        // Location History
        const { req: req3, res: res3 } = mockReqRes('GET', '/api/iot/device/ALPHA-001/location-history');
        await readingHandler(req3, res3);
        assert(res3._getStatus() === 200, "Location history returns HTTP 200");
        const data3 = res3._getData();
        assert(data3.count === 1, "Location history returns current live point (count: 1)");
        assert(data3.locations[0].latitude === 28.6139, "Location latitude matches ingested GPS fix");

        // History endpoint
        const { req: req4, res: res4 } = mockReqRes('GET', '/api/iot/device/ALPHA-001/history');
        await readingHandler(req4, res4);
        assert(res4._getStatus() === 200, "History endpoint returns HTTP 200");
        const data4 = res4._getData();
        assert(data4.mode === 'live_only', "History endpoint reports mode: live_only");
    }

    // ------------------------------------------------------------------------
    // Test 5: Disconnected Sensors & SOS Event Ingestion
    // ------------------------------------------------------------------------
    console.log("\nTest 5: Disconnected Sensors & SOS Event Ingestion");
    {
        const sosPayload = {
            device_id: 'ALPHA-001',
            temperature: { value: null, sensor_status: 'disconnected' },
            heart_rate: { value: null, sensor_status: 'disconnected' },
            gps: { latitude: null, longitude: null, fix_valid: false, sensor_status: 'no_fix' },
            sim800l: { status: 'ready', last_sms_status: 'sent', last_call_status: 'dialing', last_sos_time: new Date().toISOString() }
        };
        const { req: req1, res: res1 } = mockReqRes('POST', '/api/iot/data', { 'x-device-token': liveStore.DEFAULT_DEVICE_TOKEN }, sosPayload);
        await dataHandler(req1, res1);
        assert(res1._getStatus() === 201, "SOS telemetry accepted with HTTP 201");

        const { req: req2, res: res2 } = mockReqRes('GET', '/api/iot/device/ALPHA-001/latest');
        await readingHandler(req2, res2);
        const data2 = res2._getData();
        assert(data2.reading.temperature.value === null, "Disconnected temperature is strictly null (not fabricated)");
        assert(data2.reading.heart_rate.value === null, "Disconnected heart rate is strictly null (not 0 BPM)");
        assert(data2.reading.sim800l.last_call_status === 'dialing', "SIM800L call status ingested as 'dialing'");
    }

    // ------------------------------------------------------------------------
    // Test 6: Device Management CRUD Operations
    // ------------------------------------------------------------------------
    console.log("\nTest 6: Device Management CRUD Operations");
    {
        const adminHeaders = { 'x-admin-key': 'alpha_admin_master_secret_2026' };

        // Register new device
        const { req: req1, res: res1 } = mockReqRes('POST', '/api/iot/devices', adminHeaders, {
            device_id: 'ALPHA-002',
            device_name: 'Patient Monitor Beta',
            device_type: 'ESP32'
        });
        await devicesHandler(req1, res1);
        assert(res1._getStatus() === 201, "Register device returns HTTP 201 Created");
        const data1 = res1._getData();
        assert(typeof data1.device_token === 'string', "Plain device token returned");
        const dev2Token = data1.device_token;

        // List devices
        const { req: req2, res: res2 } = mockReqRes('GET', '/api/iot/devices');
        await devicesHandler(req2, res2);
        assert(res2._getStatus() === 200, "List devices returns HTTP 200");
        assert(res2._getData().count === 2, "List devices count is 2");

        // Rotate token
        const { req: req3, res: res3 } = mockReqRes('POST', '/api/iot/devices/ALPHA-002/rotate-token', adminHeaders);
        await devicesHandler(req3, res3);
        assert(res3._getStatus() === 200, "Rotate token returns HTTP 200");
        assert(res3._getData().new_device_token !== dev2Token, "Rotated token is different from original");

        // Delete device
        const { req: req4, res: res4 } = mockReqRes('DELETE', '/api/iot/devices/ALPHA-002', adminHeaders);
        await devicesHandler(req4, res4);
        assert(res4._getStatus() === 200, "Delete device returns HTTP 200");
    }

    console.log("\n================================================ me");
    console.log(`TEST SUMMARY: ${passedTests} PASSED, 0 FAILED out of ${totalTests} assertions`);
    console.log("================================================================");
}

runTests().catch(err => {
    console.error("Test Suite Error:", err);
    process.exit(1);
});
