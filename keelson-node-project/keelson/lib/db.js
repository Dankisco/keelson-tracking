import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const DB_PATH = path.join(ROOT, 'instance', 'keelson.db');
export const SCHEMA_PATH = path.join(ROOT, 'schema.sql');

let db = null;

export function getDb() {
  if (db) return db;
  fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });
  db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA journal_mode = WAL');
  return db;
}

/**
 * Add columns introduced after a database was first created.
 * Keeps an existing instance/keelson.db working without re-seeding it, which
 * would throw away real shipments.
 */
export function ensureSchema() {
  if (!fs.existsSync(DB_PATH)) return;
  const conn = getDb();
  const have = new Set(
    conn.prepare('PRAGMA table_info(shipments)').all().map((r) => r.name)
  );
  for (const [column, type] of [['current_lat', 'REAL'], ['current_lng', 'REAL']]) {
    if (!have.has(column)) {
      conn.exec(`ALTER TABLE shipments ADD COLUMN ${column} ${type}`);
      console.log(`migrated: added shipments.${column}`);
    }
  }
}

/** Drop everything and rebuild from schema.sql. Used by seed.js only. */
export function resetSchema() {
  const conn = getDb();
  conn.exec(fs.readFileSync(SCHEMA_PATH, 'utf8'));
}

export const all = (sql, ...params) => getDb().prepare(sql).all(...params);
export const get = (sql, ...params) => getDb().prepare(sql).get(...params);
export const run = (sql, ...params) => getDb().prepare(sql).run(...params);
