PRAGMA foreign_keys = ON;

DROP TABLE IF EXISTS events;
DROP TABLE IF EXISTS shipments;
DROP TABLE IF EXISTS users;

CREATE TABLE users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    email         TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    company       TEXT,
    role          TEXT NOT NULL DEFAULT 'customer',
    created_at    TEXT NOT NULL
);

CREATE TABLE shipments (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tracking_number TEXT UNIQUE NOT NULL,
    container_no    TEXT,
    user_id         INTEGER REFERENCES users(id) ON DELETE SET NULL,

    origin_city     TEXT NOT NULL,
    origin_country  TEXT NOT NULL,
    origin_lat      REAL NOT NULL,
    origin_lng      REAL NOT NULL,

    dest_city       TEXT NOT NULL,
    dest_country    TEXT NOT NULL,
    dest_lat        REAL NOT NULL,
    dest_lng        REAL NOT NULL,

    service         TEXT NOT NULL DEFAULT 'sea',
    status          TEXT NOT NULL DEFAULT 'booked',
    cargo_type      TEXT,
    weight_kg       REAL,
    pieces          INTEGER DEFAULT 1,
    cost_usd        REAL,

    shipper_name    TEXT,
    recipient_name  TEXT,
    recipient_email TEXT,
    recipient_addr  TEXT,

    signed_by       TEXT,
    notes           TEXT,

    -- Last position reported by a telematics box, AIS feed or dispatcher.
    -- NULL means the map falls back to estimating position from the schedule.
    current_lat     REAL,
    current_lng     REAL,

    created_at      TEXT NOT NULL,
    eta             TEXT,
    delivered_at    TEXT
);

CREATE TABLE events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    shipment_id  INTEGER NOT NULL REFERENCES shipments(id) ON DELETE CASCADE,
    status       TEXT NOT NULL,
    location     TEXT NOT NULL,
    country      TEXT,
    note         TEXT,
    occurred_at  TEXT NOT NULL,
    created_at   TEXT NOT NULL
);

CREATE INDEX idx_shipments_user   ON shipments(user_id);
CREATE INDEX idx_shipments_track  ON shipments(tracking_number);
CREATE INDEX idx_events_shipment  ON events(shipment_id, occurred_at);
