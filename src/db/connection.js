// Open a SQLite database with node:sqlite (built into Node 22.13+).

import { mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

export const MEMORY = ':memory:';

function tryExec(db, sql) {
  try {
    db.exec(sql);
  } catch {
    // migration may already be applied
  }
}

function migrate(db) {
  tryExec(db, 'ALTER TABLE users ADD COLUMN password_hash TEXT');
  tryExec(db, 'ALTER TABLE bookings ADD COLUMN refund_id TEXT');
  tryExec(db, 'ALTER TABLE bookings ADD COLUMN refund_amount_cents INTEGER');
  tryExec(db, 'ALTER TABLE bookings ADD COLUMN refunded_at TEXT');
  tryExec(db, 'ALTER TABLE bookings ADD COLUMN checked_in_at TEXT');
}

export function openDatabase(path = MEMORY) {
  if (path !== MEMORY) mkdirSync(dirname(path), { recursive: true });

  const db = new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys = ON;');
  if (path !== MEMORY) {
    db.exec('PRAGMA journal_mode = WAL;');
    db.exec('PRAGMA busy_timeout = 5000;');
  }
  db.exec(SCHEMA);
  migrate(db);
  return db;
}
