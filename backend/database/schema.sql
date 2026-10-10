-- ============================================================================
-- Alpha Squared IoT Health Monitoring System
-- Database Schema for PostgreSQL (Supabase / Neon / Self-Hosted PostgreSQL)
-- ============================================================================

-- Enable UUID extension if supported
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- Table: devices
-- Stores registered IoT devices, credentials hashes, and connectivity metadata
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS devices (
    id SERIAL PRIMARY KEY,
    device_id VARCHAR(64) UNIQUE NOT NULL,
    device_name VARCHAR(128) NOT NULL,
    device_type VARCHAR(64) DEFAULT 'ESP32',
    token_hash VARCHAR(128) NOT NULL,
    is_enabled BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    last_seen_at TIMESTAMPTZ,
    status VARCHAR(32) DEFAULT 'offline',
    metadata JSONB DEFAULT '{}'::jsonb
);

-- Index on public device_id
CREATE INDEX IF NOT EXISTS idx_devices_device_id ON devices (device_id);
CREATE INDEX IF NOT EXISTS idx_devices_status ON devices (status);

-- ----------------------------------------------------------------------------
-- Table: sensor_readings
-- Stores telemetry data submitted by ESP32 devices
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sensor_readings (
    id BIGSERIAL PRIMARY KEY,
    device_id VARCHAR(64) NOT NULL REFERENCES devices(device_id) ON DELETE CASCADE,
    device_timestamp TIMESTAMPTZ,
    server_received_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
    
    -- Temperature (DS18B20 or medical probe)
    temperature_val NUMERIC(5, 2),
    temperature_unit VARCHAR(16) DEFAULT 'C',
    temperature_status VARCHAR(32) DEFAULT 'ok',
    
    -- Heart Rate / Pulse
    heart_rate_val NUMERIC(5, 1),
    heart_rate_unit VARCHAR(16) DEFAULT 'bpm',
    heart_rate_status VARCHAR(32) DEFAULT 'ok',
    
    -- Blood Pressure (only if compatible module installed)
    bp_systolic NUMERIC(5, 1),
    bp_diastolic NUMERIC(5, 1),
    bp_unit VARCHAR(16) DEFAULT 'mmHg',
    bp_status VARCHAR(32) DEFAULT 'not_installed',
    
    -- GPS Location
    gps_latitude NUMERIC(10, 7),
    gps_longitude NUMERIC(10, 7),
    gps_fix_valid BOOLEAN DEFAULT FALSE,
    
    -- Device Telemetry Metadata
    battery_level NUMERIC(5, 2),
    signal_strength INTEGER,
    is_simulated BOOLEAN DEFAULT FALSE,
    raw_payload JSONB
);

-- High-performance indexes for historical time-series queries
CREATE INDEX IF NOT EXISTS idx_sensor_readings_device_time 
    ON sensor_readings (device_id, server_received_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_time 
    ON sensor_readings (server_received_at DESC);

CREATE INDEX IF NOT EXISTS idx_sensor_readings_gps 
    ON sensor_readings (device_id, gps_fix_valid, server_received_at DESC);

-- ----------------------------------------------------------------------------
-- Optional: Seed demo device for initial deployment testing
-- (Token: 'alphadev_demo_secret_token_12345')
-- SHA-256 of 'alphadev_demo_secret_token_12345' = 
-- '74a400893061cbb6932cd2ccdda2fdccb073b5fb42eaa4dc80c1a1c23ffb2bff'
-- ----------------------------------------------------------------------------
INSERT INTO devices (device_id, device_name, device_type, token_hash, is_enabled, status)
VALUES (
    'ALPHA-001',
    'Alpha Squared Health Monitor Node 1',
    'ESP32',
    '74a400893061cbb6932cd2ccdda2fdccb073b5fb42eaa4dc80c1a1c23ffb2bff',
    TRUE,
    'offline'
)
ON CONFLICT (device_id) DO NOTHING;

