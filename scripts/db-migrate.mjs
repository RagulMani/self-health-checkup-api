#!/usr/bin/env node
/**
 * Apply Dual7 app migrations from lib/migrations against DATABASE_URL.
 *
 * Usage:
 *   npm run db:migrate
 *   npm run db:migrate -- --status
 *   MIGRATION_START=5 MIGRATION_END=12 npm run db:migrate
 *
 * Requires: pg (npm i pg), DATABASE_URL in .env.local or environment.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

function loadDotenv() {
  for (const name of [".env.local", ".env"]) {
    const p = path.join(ROOT, name);
    if (!fs.existsSync(p)) continue;
    const text = fs.readFileSync(p, "utf8");
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  }
}

loadDotenv();

const MIGRATION_TABLE = "app_schema_migrations";
const START_ENV = "MIGRATION_START";
const END_ENV = "MIGRATION_END";

function parseArgs(argv) {
  const statusOnly = argv.includes("--status");
  let start = null;
  let end = null;
  const startEq = argv.find((a) => a.startsWith("--start="));
  if (startEq) start = parseInt(startEq.split("=")[1], 10);
  else {
    const i = argv.indexOf("--start");
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      start = parseInt(argv[i + 1], 10);
    }
  }
  const endEq = argv.find((a) => a.startsWith("--end="));
  if (endEq) end = parseInt(endEq.split("=")[1], 10);
  else {
    const i = argv.indexOf("--end");
    if (i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--")) {
      end = parseInt(argv[i + 1], 10);
    }
  }
  if (start == null && process.env[START_ENV]?.trim()) {
    start = parseInt(String(process.env[START_ENV]).trim(), 10);
  }
  if (end == null && process.env[END_ENV]?.trim()) {
    end = parseInt(String(process.env[END_ENV]).trim(), 10);
  }
  return { statusOnly, start, end };
}

function leadingNumber(filename) {
  const base = path.basename(filename);
  const m = base.match(/^(\d+)[_-]/);
  return m ? parseInt(m[1], 10) : null;
}

function inRange(filename, start, end) {
  const n = leadingNumber(filename);
  if (n == null) return false;
  if (start != null && Number.isFinite(start) && n < start) return false;
  if (end != null && Number.isFinite(end) && n > end) return false;
  return true;
}

function rangeActive(start, end) {
  return (
    (start != null && Number.isFinite(start)) ||
    (end != null && Number.isFinite(end))
  );
}

function listMigrationFiles() {
  const roots = [
    path.join(ROOT, "lib", "migrations"),
    path.join(ROOT, "lib", "migration"),
  ];
  const out = [];
  function walk(dir) {
    if (!fs.existsSync(dir)) return;
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(full);
      else if (ent.name.endsWith(".sql") && !ent.name.endsWith(".down.sql")) {
        out.push(path.relative(ROOT, full).split(path.sep).join("/"));
      }
    }
  }
  for (const r of roots) walk(r);
  return out.sort((a, b) => {
    const na = leadingNumber(a);
    const nb = leadingNumber(b);
    if (na != null && nb != null && na !== nb) return na - nb;
    return a.localeCompare(b);
  });
}

function sha256(content) {
  return crypto.createHash("sha256").update(content, "utf8").digest("hex");
}

async function main() {
  const { statusOnly, start, end } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL?.trim();
  if (!databaseUrl) {
    console.error("DATABASE_URL is required (set in .env.local or the environment).");
    process.exit(1);
  }

  let Pool;
  try {
    ({ Pool } = require("pg"));
  } catch {
    console.error("Missing dependency: pg. Run: npm install pg");
    process.exit(1);
  }

  const pool = new Pool({ connectionString: databaseUrl });
  const files = listMigrationFiles();
  if (files.length === 0) {
    console.log("No SQL files under lib/migrations/");
    await pool.end();
    return;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${MIGRATION_TABLE} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      checksum TEXT
    )
  `);

  const appliedRes = await pool.query(
    `SELECT name FROM ${MIGRATION_TABLE} ORDER BY name`,
  );
  const applied = new Set(appliedRes.rows.map((r) => r.name));

  const active = rangeActive(start, end);
  const pending = files.filter((f) => !applied.has(path.basename(f)));
  const toRun = active
    ? pending.filter((f) => inRange(path.basename(f), start, end))
    : pending;
  const skippedNonNumeric = active
    ? pending.filter((f) => leadingNumber(path.basename(f)) == null)
    : [];
  const skippedOutOfRange = active
    ? pending.filter((f) => {
        const n = leadingNumber(path.basename(f));
        return n != null && !inRange(path.basename(f), start, end);
      })
    : [];

  console.log(`Found ${files.length} migration file(s); ${applied.size} applied; ${pending.length} pending.`);
  if (active) {
    console.log(
      `Range: ${start ?? "…"}–${end ?? "…"} → ${toRun.length} to apply` +
        (skippedOutOfRange.length
          ? `, ${skippedOutOfRange.length} skipped by range`
          : "") +
        (skippedNonNumeric.length
          ? `, ${skippedNonNumeric.length} non-numeric skipped`
          : ""),
    );
  }

  if (statusOnly) {
    for (const f of toRun) console.log(`  pending  ${f}`);
    await pool.end();
    return;
  }

  if (toRun.length === 0) {
    console.log("Nothing to apply.");
    await pool.end();
    return;
  }

  for (const rel of toRun) {
    const abs = path.join(ROOT, rel);
    const sql = fs.readFileSync(abs, "utf8");
    const name = path.basename(rel);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(
        `INSERT INTO ${MIGRATION_TABLE} (name, checksum) VALUES ($1, $2)
         ON CONFLICT (name) DO NOTHING`,
        [name, sha256(sql)],
      );
      await client.query("COMMIT");
      console.log(`✓ ${name}`);
    } catch (err) {
      await client.query("ROLLBACK");
      console.error(`✗ ${name}:`, err instanceof Error ? err.message : err);
      client.release();
      await pool.end();
      process.exit(1);
    }
    client.release();
  }

  console.log(`Applied ${toRun.length} migration(s).`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
