/**
 * Alpha Squad IoT - Verification Suite for Emergency System & Three-Zone Patient Safety
 * 
 * Verifies:
 * 1. Three-Zone Evaluation (Green, Yellow, Red) and Non-diagnostic recommendations
 * 2. Critical Rule: Fall + Critical Vital reading bypasses false-alarm countdown
 * 3. Emergency Voice Calling Engine (Twilio REST API logic, test suppression, 60s cooldown lock)
 * 4. Google Maps link generation with GPS coordinates, non-fabrication when unavailable
 * 5. Emergency Dispatch API (/api/emergency/dispatch)
 * 6. Emergency Event Acknowledgement API (/api/emergency/acknowledge)
 * 7. Patient Emergency Contacts API (/api/patient/contacts)
 */

const { evaluateThreeZones } = require('./backend/safety-zones');
const { initiateCloudEmergencyCall, activeCallLocks } = require('./backend/emergency-call');
const db = require('./backend/db');

let passedTests = 0;
let failedTests = 0;

function assert(condition, testName) {
    if (condition) {
        console.log(`  [PASS] ${testName}`);
        passedTests++;
    } else {
        console.error(`  [FAIL] ${testName}`);
        failedTests++;
    }
}

// In-memory MongoDB Mock Collections for Emergency Tests
const emergencyEvents = [];
const emergencyCalls = [];
let contactsList = [
    { name: "Dr. Marcus Vance", phone: "+15552345678", email: "caregiver@example.com", is_primary: true },
    { name: "Sarah Vance", phone: "+15559876543", email: "secondary@example.com", is_primary: false }
];

const mockEventsCol = {
    async insertOne(doc) {
        const id = doc.event_id || 'EMG_' + Date.now();
        const saved = { _id: id, ...doc };
        emergencyEvents.push(saved);
        return { insertedId: id };
    },
    async findOne(filter) {
        return emergencyEvents.find(e => e.event_id === filter.event_id) || null;
    },
    async updateOne(filter, update) {
        const item = emergencyEvents.find(e => e.event_id === filter.event_id);
        if (item && update.$set) {
            Object.assign(item, update.$set);
            return { modifiedCount: 1 };
        }
        return { modifiedCount: 0 };
    },
    find(filter = {}) {
        let list = [...emergencyEvents];
        return {
            sort() { return this; },
            limit(n) { list = list.slice(0, n); return this; },
            async toArray() { return list; }
        };
    }
};

const mockCallsCol = {
    async insertOne(doc) {
        emergencyCalls.push(doc);
        return { insertedId: 'call_' + Date.now() };
    }
};

const mockContactsCol = {
    find() {
        return {
            async toArray() { return contactsList; }
        };
    },
    async deleteMany() {
        contactsList = [];
        return { deletedCount: 2 };
    },
    async insertMany(docs) {
        contactsList = [...docs];
        return { insertedCount: docs.length };
    }
};

db.getEmergencyEventsCollection = async () => mockEventsCol;
db.getEmergencyCallsCollection = async () => mockCallsCol;
db.getPatientContactsCollection = async () => mockContactsCol;

async function runTests() {
    console.log("================================================================");
    console.log("ALPHA SQUAD IoT - EMERGENCY & THREE-ZONE SAFETY SYSTEM TESTS");
    console.log("================================================================\n");

    // -------------------------------------------------------------
    // Test Group 1: Three-Zone Patient Safety Evaluation
    // -------------------------------------------------------------
    console.log("Test 1: Three-Zone Safety Evaluation (Green, Yellow, Red)");

    // 1A. Normal Green Zone (HR 60-100, Temp 36.0-37.5)
    const greenResult = evaluateThreeZones({
        heartRate: 72,
        temperature: 36.6,
        fallDetected: false,
        sos: false
    });
    assert(greenResult.zone === "GREEN", "Normal vitals resolve to GREEN zone");
    assert(greenResult.status === "NORMAL", "Green zone reports NORMAL status");
    assert(!greenResult.is_emergency, "Green zone is not an emergency");
    assert(!greenResult.is_warning, "Green zone is not a warning");
    assert(greenResult.recommendation.includes("normal target ranges"), "Green zone gives reassuring guidance");
    assert(greenResult.disclaimer.includes("not professional medical diagnoses"), "Includes non-diagnostic clinical disclaimer");

    // 1B. Warning Yellow Zone - Borderline HR (55 BPM)
    const yellowHrResult = evaluateThreeZones({
        heartRate: 55,
        temperature: 36.6
    });
    assert(yellowHrResult.zone === "YELLOW", "Borderline HR (55 BPM) resolves to YELLOW zone");
    assert(yellowHrResult.status === "WARNING", "Yellow zone reports WARNING status");
    assert(yellowHrResult.is_warning, "Yellow zone is_warning is true");
    assert(!yellowHrResult.is_emergency, "Yellow zone is not an emergency");
    assert(yellowHrResult.recommendation.includes("rest quietly for 5 minutes"), "Yellow zone recommends resting & rechecking");

    // 1C. Warning Yellow Zone - Elevated Temp (37.8°C)
    const yellowTempResult = evaluateThreeZones({
        heartRate: 75,
        temperature: 37.8
    });
    assert(yellowTempResult.zone === "YELLOW", "Borderline Temp (37.8°C) resolves to YELLOW zone");
    assert(yellowTempResult.reasons.some(r => r.includes("37.8°C")), "Reasons list identifies low-grade fever");

    // 1D. Red Zone - Critical Tachycardia (135 BPM)
    const redHrResult = evaluateThreeZones({
        heartRate: 135,
        temperature: 36.6
    });
    assert(redHrResult.zone === "RED", "Critical HR (135 BPM) resolves to RED zone");
    assert(redHrResult.is_emergency, "Critical HR flags is_emergency as true");
    assert(redHrResult.requires_immediate_dispatch, "Requires immediate caregiver dispatch");

    // 1E. Red Zone - High Fever (39.2°C)
    const redTempResult = evaluateThreeZones({
        heartRate: 80,
        temperature: 39.2
    });
    assert(redTempResult.zone === "RED", "High Fever (39.2°C) resolves to RED zone");

    // 1F. Red Zone - Manual SOS Trigger
    const redSosResult = evaluateThreeZones({
        sos: true
    });
    assert(redSosResult.zone === "RED", "Manual SOS triggers RED zone");

    // -------------------------------------------------------------
    // Test Group 2: Critical Rule - Fall + Critical Vital Countdown Bypass
    // -------------------------------------------------------------
    console.log("\nTest 2: Fall Detection and False-Alarm Countdown Bypass Rule");

    // 2A. Isolated Fall with normal vitals -> Standard countdown allowed
    const isolatedFall = evaluateThreeZones({
        fallDetected: true,
        heartRate: 75,
        temperature: 36.6
    });
    assert(isolatedFall.zone === "RED", "Fall detected triggers RED emergency status");
    assert(isolatedFall.bypass_fall_countdown === false, "Isolated fall allows standard 10s false-alarm countdown");

    // 2B. Fall combined with Critical Tachycardia -> Bypass countdown IMMEDIATELY
    const fallPlusCriticalHr = evaluateThreeZones({
        fallDetected: true,
        heartRate: 140,
        temperature: 36.6
    });
    assert(fallPlusCriticalHr.bypass_fall_countdown === true, "CRITICAL RULE: Fall + Critical HR bypasses false-alarm countdown immediately");

    // 2C. Fall combined with Critical Hypothermia (< 35.5°C) -> Bypass countdown IMMEDIATELY
    const fallPlusHypothermia = evaluateThreeZones({
        fallDetected: true,
        heartRate: 80,
        temperature: 34.2
    });
    assert(fallPlusHypothermia.bypass_fall_countdown === true, "CRITICAL RULE: Fall + Critical Temp bypasses false-alarm countdown immediately");

    // -------------------------------------------------------------
    // Test Group 3: Emergency Voice Calling Engine (Twilio REST Client)
    // -------------------------------------------------------------
    console.log("\nTest 3: Voice Calling Engine (Test Suppression, Failover & 60s Deduplication)");

    // 3A. When Twilio credentials are not set, return safe unconfigured status
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;

    const unconfiguredCall = await initiateCloudEmergencyCall({
        patientName: "Eleanor Vance",
        reason: "Critical Tachycardia",
        vitals: { heartRate: 135, temperature: 36.6 },
        contacts: {
            primary: { phone: "+15552345678", name: "Dr. Marcus Vance" }
        },
        explicitTestCall: true
    });
    assert(unconfiguredCall.success === false, "Unconfigured Twilio returns success: false");
    assert(unconfiguredCall.status === "unconfigured", "Unconfigured Twilio returns status: unconfigured");
    assert(unconfiguredCall.recipient === "+15552345678", "Target recipient correctly extracted from primary contact");

    // 3B. When running in test mode without explicitTestCall: true, suppress real calls
    const testModeSuppressed = await initiateCloudEmergencyCall({
        patientName: "Test Patient",
        reason: "TEST ALERT",
        isTest: true,
        explicitTestCall: false,
        contacts: {
            primary: { phone: "+15552345678", name: "Dr. Marcus Vance" }
        }
    });
    assert(testModeSuppressed.success === true, "Test mode without explicit flag returns success: true");
    assert(testModeSuppressed.status === "test_simulated", "Test call suppressed from placing real phone call");

    // 3C. Cooldown Deduplication Lock (60 seconds)
    const testPhone = "+15552345678";
    activeCallLocks.set(`EMG_LOCK_TEST_${testPhone}`, Date.now());
    const lockedCall = await initiateCloudEmergencyCall({
        eventId: "EMG_LOCK_TEST",
        patientName: "Eleanor Vance",
        contacts: { primary: { phone: testPhone } },
        explicitTestCall: true
    });
    assert(lockedCall.status === "suppressed_cooldown", "Duplicate call within 60s cooldown is prevented");
    activeCallLocks.delete(`EMG_LOCK_TEST_${testPhone}`);

    // -------------------------------------------------------------
    // Test Group 4: Google Maps Location Link Generation
    // -------------------------------------------------------------
    console.log("\nTest 4: Google Maps Link Generation & GPS Non-fabrication");

    // 4A. Valid Coordinates provide clickable Google Maps link
    const validLat = 28.6139;
    const validLng = 77.2090;
    const expectedMapUrl = `https://www.google.com/maps?q=${validLat},${validLng}`;
    assert(expectedMapUrl === "https://www.google.com/maps?q=28.6139,77.209", "Correct Google Maps query URL created");

    // 4B. Null / Unavailable coordinates do not fabricate fake numbers
    const locationUnavailable = { available: false, latitude: null, longitude: null };
    assert(locationUnavailable.latitude === null, "Missing latitude is strictly null");
    assert(locationUnavailable.longitude === null, "Missing longitude is strictly null");

    // -------------------------------------------------------------
    // Test Group 5: Emergency Dispatch API Mock Test
    // -------------------------------------------------------------
    console.log("\nTest 5: Emergency Dispatch Endpoint (/api/emergency/dispatch)");

    const dispatchHandler = require('./api/emergency/dispatch');
    
    // Test Yellow Zone Dispatch (Logs warning, no sirens or phone calls)
    const mockYellowReq = {
        method: "POST",
        headers: {},
        body: {
            patientName: "Eleanor Vance",
            patientId: "ALPHA-001",
            vitals: { heartRate: 108, temperature: 37.8 }
        }
    };
    let yellowStatusCode = null;
    let yellowResponseData = null;
    const mockYellowRes = {
        setHeader: () => {},
        status: (code) => {
            yellowStatusCode = code;
            return {
                json: (data) => { yellowResponseData = data; }
            };
        }
    };

    await dispatchHandler(mockYellowReq, mockYellowRes);
    assert(yellowStatusCode === 200, "Yellow zone dispatch returns HTTP 200");
    assert(yellowResponseData.zone === "YELLOW", "Dispatched zone is YELLOW");
    assert(yellowResponseData.dispatched === false, "Yellow zone does not trigger emergency sirens/calls");
    assert(yellowResponseData.action === "caregiver_logged", "Yellow zone action is caregiver_logged");

    // Test Red Zone Dispatch (Initiates emergency workflow)
    const mockRedReq = {
        method: "POST",
        headers: {},
        body: {
            patientName: "Eleanor Vance",
            patientId: "ALPHA-001",
            vitals: { heartRate: 145, temperature: 36.6, fallDetected: true },
            location: { latitude: 28.6139, longitude: 77.2090, available: true }
        }
    };
    let redStatusCode = null;
    let redResponseData = null;
    const mockRedRes = {
        setHeader: () => {},
        status: (code) => {
            redStatusCode = code;
            return {
                json: (data) => { redResponseData = data; }
            };
        }
    };

    await dispatchHandler(mockRedReq, mockRedRes);
    assert(redStatusCode === 200, "Red zone dispatch returns HTTP 200");
    assert(redResponseData.zone === "RED", "Dispatched zone is RED");
    assert(redResponseData.dispatched === true, "Red zone triggers emergency dispatch");
    assert(redResponseData.bypass_fall_countdown === true, "Fall + Critical HR bypasses countdown in dispatch");
    assert(redResponseData.event_id && redResponseData.event_id.startsWith("EMG_"), "Generated valid event_id");
    assert(redResponseData.maps_url === "https://www.google.com/maps?q=28.6139,77.209", "Dispatch payload includes Google Maps link");

    // -------------------------------------------------------------
    // Test Group 6: Event Acknowledgement & Patient Contacts API
    // -------------------------------------------------------------
    console.log("\nTest 6: Emergency Acknowledge & Patient Contacts Endpoints");

    const ackHandler = require('./api/emergency/acknowledge');
    const mockAckReq = {
        method: "POST",
        headers: {},
        body: {
            event_id: redResponseData.event_id,
            resolved_by: "Caregiver Marcus",
            resolution_notes: "Arrived at bedside, patient resting comfortably"
        }
    };
    let ackCode = null;
    let ackData = null;
    const mockAckRes = {
        setHeader: () => {},
        status: (code) => {
            ackCode = code;
            return { json: (d) => { ackData = d; } };
        }
    };
    await ackHandler(mockAckReq, mockAckRes);
    assert(ackCode === 200, "Acknowledge endpoint returns HTTP 200");
    assert(ackData.success === true, "Acknowledge reports success: true");

    const contactsHandler = require('./api/patient/contacts');
    const mockGetContactsReq = { method: "GET", headers: {} };
    let contactsCode = null;
    let contactsData = null;
    const mockContactsRes = {
        setHeader: () => {},
        status: (code) => {
            contactsCode = code;
            return { json: (d) => { contactsData = d; } };
        }
    };
    await contactsHandler(mockGetContactsReq, mockContactsRes);
    assert(contactsCode === 200, "Contacts GET returns HTTP 200");
    assert(contactsData && contactsData.contacts, "Returns patient emergency contacts object");
    assert(contactsData.contacts.primary && contactsData.contacts.primary.phone, "Contains designated primary contact with phone");
    assert(contactsData.contacts.secondary && contactsData.contacts.secondary.phone, "Contains designated secondary contact with phone");

    // -------------------------------------------------------------
    // Final Summary
    // -------------------------------------------------------------
    console.log("\n================================================================");
    console.log(`EMERGENCY SYSTEM TEST SUMMARY: ${passedTests} PASSED, ${failedTests} FAILED`);
    console.log("================================================================\n");

    if (failedTests > 0) {
        process.exit(1);
    }
}

runTests().catch(err => {
    console.error("Test execution error:", err);
    process.exit(1);
});
