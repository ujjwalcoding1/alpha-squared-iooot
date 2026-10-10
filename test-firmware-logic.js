/**
 * Alpha Squared IoT - ESP32 Firmware Logic & Mock GSM Test Suite
 * Tests SMS payload formatting, GPS link generation, voice call AT command construction,
 * software debouncing, cooldown timing, and non-blocking GSM parser handling.
 * DOES NOT send real SMS or make actual phone calls.
 */

const assert = require('assert');

let totalTests = 0;
let passedTests = 0;

function testAssert(condition, message) {
    totalTests++;
    if (condition) {
        passedTests++;
        console.log(`  [PASS] ${message}`);
    } else {
        console.error(`  [FAIL] ${message}`);
        throw new Error(`Assertion failed: ${message}`);
    }
}

/**
 * Mock Emergency SMS Formatter (replicates firmware triggerEmergencySMS logic)
 */
function formatEmergencySms(reason, temperature, heartRate, latitude, longitude, gpsFixValid) {
    let message = "🚨 EMERGENCY ALERT: Patient ALPHA-001!\n";
    message += "Reason: " + reason + "\n";

    if (temperature !== null && temperature !== undefined) {
        message += "Temp: " + Number(temperature).toFixed(1) + " C\n";
    } else {
        message += "Temp: Sensor Unavailable\n";
    }

    if (heartRate !== null && heartRate !== undefined) {
        message += "Heart Rate: " + Math.round(heartRate) + " BPM\n";
    } else {
        message += "Heart Rate: Sensor Unavailable\n";
    }

    if (gpsFixValid && typeof latitude === 'number' && typeof longitude === 'number') {
        message += "Location: https://maps.google.com/?q=" + latitude.toFixed(6) + "," + longitude.toFixed(6);
    } else {
        message += "Location: GPS Fix Unavailable";
    }

    return message;
}

/**
 * Mock Voice Dial AT Command Formatter (replicates firmware initiateEmergencyCall)
 */
function formatVoiceDialAtCommand(phoneNumber) {
    if (!phoneNumber || phoneNumber.length < 5) return null;
    return "ATD" + phoneNumber.trim() + ";";
}

/**
 * Mock Software Debounce & Cooldown Engine
 */
class MockButtonController {
    constructor(cooldownMs = 30000, debounceMs = 50) {
        this.cooldownMs = cooldownMs;
        this.debounceMs = debounceMs;
        this.lastTriggerMs = 0;
        this.lastReading = 1; // HIGH (unpressed)
        this.stableState = 1;
        this.lastDebounceTime = 0;
    }

    onButtonStateChange(reading, nowMs) {
        if (reading !== this.lastReading) {
            this.lastDebounceTime = nowMs;
        }
        this.lastReading = reading;

        if ((nowMs - this.lastDebounceTime) >= this.debounceMs) {
            if (reading !== this.stableState) {
                this.stableState = reading;
                if (this.stableState === 0) { // LOW transition
                    if (this.lastTriggerMs === 0 || (nowMs - this.lastTriggerMs) >= this.cooldownMs) {
                        this.lastTriggerMs = nowMs;
                        return { triggered: true, reason: 'pressed' };
                    } else {
                        return { triggered: false, reason: 'cooldown_active' };
                    }
                }
            }
        }
        return { triggered: false, reason: 'no_edge' };
    }
}

/**
 * Mock Non-Blocking GSM Parser
 */
class MockGsmParser {
    constructor() {
        this.callState = 'idle';
        this.lastResponse = '';
    }

    processLine(line, nowMs, callStartTimeMs, callDurationCapMs = 20000) {
        // Auto-hangup timeout check
        if (this.callState === 'active' || this.callState === 'dialing') {
            if (nowMs - callStartTimeMs > callDurationCapMs) {
                this.callState = 'ended';
            }
        }

        const trimmed = line.trim();
        if (!trimmed) return this.callState;

        this.lastResponse = trimmed;

        if (trimmed.includes('BUSY') || trimmed.includes('NO CARRIER') || trimmed.includes('NO DIALTONE')) {
            this.callState = 'ended';
        } else if (trimmed.includes('VOICE CALL: BEGIN') || trimmed.includes('OK')) {
            if (this.callState === 'dialing') {
                this.callState = 'active';
            }
        } else if (trimmed.includes('ERROR')) {
            if (this.callState === 'dialing') {
                this.callState = 'failed';
            }
        }

        return this.callState;
    }
}

function runFirmwareTests() {
    console.log("================================================================");
    console.log("ALPHA SQUARED IoT - ESP32 FIRMWARE LOGIC VERIFICATION SUITE");
    console.log("================================================================");

    // Test 1: SMS Formatting with Valid GPS Fix
    console.log("\nTest 1: SMS Formatting with Valid GPS Fix");
    {
        const sms = formatEmergencySms("Physical SOS Button Pressed", 36.8, 74, 28.6139, 77.2090, true);
        testAssert(sms.includes("https://maps.google.com/?q=28.613900,77.209000"), "SMS includes correct Google Maps URL");
        testAssert(sms.includes("Temp: 36.8 C"), "SMS includes valid temperature");
        testAssert(sms.includes("Heart Rate: 74 BPM"), "SMS includes valid heart rate");
        testAssert(sms.includes("Reason: Physical SOS Button Pressed"), "SMS includes trigger reason");
    }

    // Test 2: SMS Formatting without GPS Fix (Non-Fabrication)
    console.log("\nTest 2: SMS Formatting without GPS Fix");
    {
        const sms = formatEmergencySms("Physical SOS Button Pressed", null, null, null, null, false);
        testAssert(sms.includes("Location: GPS Fix Unavailable"), "SMS states GPS Fix Unavailable when missing");
        testAssert(!sms.includes("maps.google.com"), "SMS does NOT fabricate fake Google Maps URL");
        testAssert(sms.includes("Temp: Sensor Unavailable"), "SMS states Temp: Sensor Unavailable when missing");
        testAssert(sms.includes("Heart Rate: Sensor Unavailable"), "SMS states Heart Rate: Sensor Unavailable when missing");
    }

    // Test 3: Voice Call AT Command Formatting
    console.log("\nTest 3: Voice Call AT Command Formatting");
    {
        const atCmd = formatVoiceDialAtCommand("+919876543210");
        testAssert(atCmd === "ATD+919876543210;", "Voice dial command includes trailing semicolon 'ATD+919876543210;'");
        const invalidCmd = formatVoiceDialAtCommand("12");
        testAssert(invalidCmd === null, "Invalid short phone number rejected");
    }

    // Test 4: Software Debounce & Cooldown Engine
    console.log("\nTest 4: Software Debounce & Cooldown Engine");
    {
        const controller = new MockButtonController(30000, 50);

        // Initial unpressed state
        let res = controller.onButtonStateChange(1, 1000);
        testAssert(res.triggered === false, "Button unpressed: no trigger");

        // Noise spike (< 50ms)
        res = controller.onButtonStateChange(0, 1010);
        testAssert(res.triggered === false, "Noise spike (10ms): debounced & suppressed");

        // Solid press (> 50ms)
        res = controller.onButtonStateChange(0, 1060);
        testAssert(res.triggered === true, "Solid deliberate press (60ms): triggers emergency");

        // Continuous holding (same state)
        res = controller.onButtonStateChange(0, 2000);
        testAssert(res.triggered === false, "Button held down continuously: suppresses duplicate triggers");

        // Quick release and re-press within 30s cooldown window
        controller.onButtonStateChange(1, 3000); // Release start
        controller.onButtonStateChange(1, 3060); // Release debounced (stableState -> 1)
        controller.onButtonStateChange(0, 5000); // Start press at 5s
        res = controller.onButtonStateChange(0, 5060); // Debounced press at 5.06s
        testAssert(res.triggered === false && res.reason === 'cooldown_active', "Re-press within 30s cooldown suppressed");

        // Re-press after 30s cooldown window (32s)
        controller.onButtonStateChange(1, 31000); // Release start
        controller.onButtonStateChange(1, 31060); // Release debounced
        controller.onButtonStateChange(0, 32000); // Start press at 32s
        res = controller.onButtonStateChange(0, 32060); // Debounced press at 32.06s
        testAssert(res.triggered === true, "Re-press after 30s cooldown triggers successfully");
    }

    // Test 5: Non-Blocking GSM Response Parser & Call Auto-Hangup
    console.log("\nTest 5: Non-Blocking GSM Response Parser");
    {
        const parser = new MockGsmParser();
        parser.callState = 'dialing';

        // Dialing OK response
        let state = parser.processLine("OK", 1000, 1000);
        testAssert(state === 'active', "Dialing -> OK transitions to active call");

        // Remote hangup BUSY
        state = parser.processLine("BUSY", 2000, 1000);
        testAssert(state === 'ended', "BUSY response ends voice call");

        // Call duration timeout (20s)
        parser.callState = 'active';
        state = parser.processLine("", 22000, 1000); // 21 seconds later
        testAssert(state === 'ended', "Call exceeding 20s auto-hangs up");
    }

    console.log("\n================================================================");
    console.log(`FIRMWARE TEST SUMMARY: ${passedTests} PASSED, 0 FAILED out of ${totalTests} assertions`);
    console.log("================================================================");
}

runFirmwareTests();
