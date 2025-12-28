#!/usr/bin/env node
// Simple script to open the SQLite DB, run WAL checkpoint and close it.
// This ensures better-sqlite3's close() and checkpoint behavior runs in CI

const fs = require('fs');
const path = process.env.DATABASE_PATH || './sync_data.db';

function log(...args) { console.log(...args); }

if (!fs.existsSync(path)) {
  log('No database file found at', path);
  process.exit(0);
}

try {
  const Database = require('better-sqlite3');
  const db = new Database(path);
  log('Opened database:', path);

  try {
    const integrity = db.pragma('integrity_check', { simple: true });
    log('integrity_check:', integrity);
  } catch (e) {
    log('integrity_check failed:', e.message);
  }

  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    log('WAL checkpoint completed');
  } catch (e) {
    log('WAL checkpoint failed:', e.message || e);
  }

  try {
    db.close();
    log('Database closed successfully');
  } catch (e) {
    log('Error closing database:', e.message || e);
  }

  // Show files for debugging
  try {
    const dir = require('path').dirname(path) || '.';
    const files = fs.readdirSync(dir).filter(f => f.startsWith(require('path').basename(path)));
    files.forEach(f => {
      try { const stat = fs.statSync(require('path').join(dir, f)); log(f, stat.size); } catch(_){}
    });
  } catch (_) {}

  process.exit(0);
} catch (err) {
  console.error('Failed to checkpoint DB:', err.message || err);
  process.exit(1);
}
