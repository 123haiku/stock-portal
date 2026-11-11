import { DatabaseSync } from 'node:sqlite';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, '..', 'data');
const dbPath = process.env.DB_PATH || join(dataDir, 'portal.db');

// In-memory mode keeps integration tests hermetic (no file on disk, no cleanup).
const target = process.env.DB_PATH === ':memory:' ? ':memory:' : dbPath;

if (target !== ':memory:') {
  try {
    mkdirSync(dataDir, { recursive: true });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
  }
}

export const db = new DatabaseSync(target);

db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

/**
 * Apply the schema once and seed the demo data when the tables are still empty.
 * Idempotent: running the server twice does not duplicate rows.
 */
export function initDb({ seed = true } = {}) {
  const schema = readFileSync(join(here, '..', 'sql', 'schema.sql'), 'utf8');
  db.exec(schema);

  if (!seed) return;

  const { n } = db.prepare('SELECT COUNT(*) AS n FROM products').get();
  if (n > 0) return;

  const seedSql = readFileSync(join(here, '..', 'sql', 'seed.sql'), 'utf8');
  db.exec(seedSql);
}

export function all(sql, params = []) {
  return db.prepare(sql).all(...params);
}

export function get(sql, params = []) {
  return db.prepare(sql).get(...params);
}

export function run(sql, params = []) {
  return db.prepare(sql).run(...params);
}

/** node:sqlite has no transaction helper, so keep the BEGIN/COMMIT/ROLLBACK explicit. */
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

export default db;
