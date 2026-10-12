// Platform-provided entity-file mock query helper — do NOT edit manually.
// It is auto-managed by the AlgorithmShift platform.
//
// Mirrors the `lib/json.ts` seed the Next.js stacks receive: when no database
// is configured, `query()` answers from `entities/{table}.json` (column-based
// generation) or `entities/mock/{table}.json` (explicit rows).
import fs from "fs";
import path from "path";
import { randomUUID } from "crypto";

type _Col = { name: string; type?: string; pk?: boolean };

function _extractTable(sql: string): string | null {
  const m =
    sql.match(/\bFROM\s+["']?(\w+)["']?/i) ||
    sql.match(/\bINTO\s+["']?(\w+)["']?/i) ||
    sql.match(/\bUPDATE\s+["']?(\w+)["']?/i);
  return m ? m[1] : null;
}

function _loadCols(table: string): _Col[] {
  try {
    const p = path.join(process.cwd(), "entities", table + ".json");
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    return (data.columns as _Col[]) ?? [];
  } catch {
    return [];
  }
}

function _loadExplicitRows<T>(table: string): T[] | null {
  try {
    const p = path.join(process.cwd(), "entities", "mock", table + ".json");
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    if (Array.isArray(data) && data.length > 0) return data as T[];
    return null;
  } catch {
    return null;
  }
}

function _mockVal(col: _Col, i: number): unknown {
  const n = col.name.toLowerCase();
  const t = (col.type || "").toLowerCase();
  if (col.pk || n === "id") return randomUUID();
  if (n.includes("uuid") || t === "uuid") return randomUUID();
  if (n.includes("email")) return "user" + (i + 1) + "@example.com";
  if (n === "name" || n.includes("_name") || n === "title" || n.includes("full_name"))
    return ["Alice Johnson", "Bob Smith", "Carol White", "Dave Brown", "Eve Davis"][i % 5];
  if (n.includes("first_name")) return ["Alice", "Bob", "Carol", "Dave", "Eve"][i % 5];
  if (n.includes("last_name")) return ["Johnson", "Smith", "White", "Brown", "Davis"][i % 5];
  if (n.includes("phone")) return "+1-555-" + String(1000 + i).padStart(4, "0");
  if (n.includes("url") || n.includes("image") || n.includes("avatar") || n.includes("photo"))
    return "https://picsum.photos/seed/" + (i + 1) + "/200";
  if (n.includes("price") || n.includes("amount") || n.includes("total") || n.includes("cost") || n.includes("revenue"))
    return Number(((i + 1) * 19.99).toFixed(2));
  if (n.includes("count") || n.includes("quantity") || n.includes("stock") || n.includes("inventory"))
    return (i + 1) * 10;
  if (n === "status") return ["active", "inactive", "pending"][i % 3];
  if (n.includes("description") || n.includes("bio") || n.includes("summary") || n.includes("note") || n.includes("content"))
    return "Sample " + col.name.replace(/_/g, " ") + " for record " + (i + 1) + ".";
  if (n === "created_at" || n === "updated_at" || n.includes("_at") || t.includes("timestamp"))
    return new Date(Date.now() - i * 86400000).toISOString();
  if (t.includes("bool")) return i % 2 === 0;
  if (t.includes("int") || t.includes("serial") || t.includes("bigint")) return i + 1;
  if (t.includes("numeric") || t.includes("float") || t.includes("decimal") || t.includes("real"))
    return Number(((i + 1) * 9.99).toFixed(2));
  if (t.includes("json")) return {};
  return "Sample " + col.name.replace(/_/g, " ") + " " + (i + 1);
}

function _mockRows<T>(table: string, count: number): T[] {
  // Prefer explicit mock rows from entities/mock/{table}.json
  const explicit = _loadExplicitRows<T>(table);
  if (explicit) return explicit.slice(0, count);
  // Fall back to column-based generation from entities/{table}.json schema
  const cols = _loadCols(table);
  if (cols.length === 0) return [];
  return Array.from({ length: count }, (_, i) => {
    const row: Record<string, unknown> = {};
    for (const col of cols) row[col.name] = _mockVal(col, i);
    return row as T;
  });
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  _params?: unknown[],
): Promise<T[]> {
  const op = sql.trimStart().toUpperCase();
  const table = _extractTable(sql);
  if (!table) return [];
  if (op.startsWith("DELETE")) return [];
  if (op.startsWith("INSERT") || op.startsWith("UPDATE")) return _mockRows<T>(table, 1);
  return _mockRows<T>(table, 5);
}

export const isMockMode = true;
