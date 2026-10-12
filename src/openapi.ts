/**
 * `npm run openapi` — do NOT edit. Builds the app, writes `openapi.json` at
 * the repo root, exits 0. The platform runs this after every typecheck so the
 * linked clients regenerate their typed API client from the real contract.
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildOpenAPIDocument, createApp } from "./app";

const outPath = resolve(process.cwd(), "openapi.json");
const doc = buildOpenAPIDocument(createApp());
writeFileSync(outPath, JSON.stringify(doc, null, 2) + "\n", "utf8");
const pathCount = Object.keys((doc as { paths?: Record<string, unknown> }).paths ?? {}).length;
console.log(`[openapi] wrote ${outPath} (${pathCount} paths)`);
process.exit(0);
