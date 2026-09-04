/**
 * setup.js
 * One-time initializer, the TiDB equivalent of apps-script/Setup.gs:
 * creates all tables (schema.sql) and seeds the admin login. Safe to
 * re-run — CREATE TABLE IF NOT EXISTS won't touch existing tables, and an
 * already-seeded username's password is left alone (matching
 * apps-script/Setup.gs's "safe to re-run" behavior).
 *
 * Run: npm run setup
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { pool } = require('./db');
const { hashPassword } = require('./logic');
const store = require('./store');

async function runSchema() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  const statements = sql
    .split(/;\s*(?:\r?\n|$)/)
    .map(s => s.trim())
    .filter(Boolean);
  for (const statement of statements) {
    await pool.query(statement);
  }
  console.log(`Schema OK (${statements.length} statement(s) applied).`);
}

async function seedUser(username, password, role) {
  if (!username || !password) return;
  const existing = await store.findUserByUsername(username);
  if (existing) {
    console.log(`User "${username}" already exists — leaving its password as-is.`);
    return;
  }
  const salt = crypto.randomUUID();
  const hash = hashPassword(password, salt);
  await pool.query(
    'INSERT INTO users (username, salt, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)',
    [username, salt, hash, role, new Date().toISOString()]
  );
  console.log(`Seeded user "${username}" (role: ${role}).`);
}

async function main() {
  await runSchema();

  const adminUsername = process.env.ADMIN_USERNAME || 'admin';
  const adminPassword = process.env.ADMIN_PASSWORD || 'Admin@123';
  await seedUser(adminUsername, adminPassword, 'admin');
  await seedUser(process.env.HR_USERNAME, process.env.HR_PASSWORD, 'hr');

  console.log('Setup complete.');
  if (!process.env.ADMIN_PASSWORD) {
    console.log(`Default admin login -> username: ${adminUsername}  password: ${adminPassword}  — change it after first login.`);
  }
  await pool.end();
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exitCode = 1;
});
