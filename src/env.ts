/**
 * Platform-owned environment access — do NOT edit.
 *
 * Loads `.env.local` (written by the platform on every sandbox boot) and then
 * `.env`, without overriding variables already present in the process. Every
 * accessor is a getter so values are read at call time — tests and scripts
 * that set `process.env` after import see the change.
 */
import { config as loadDotenv } from "dotenv";

loadDotenv({ path: ".env.local" });
loadDotenv();

function str(name: string, fallback = ""): string {
  const value = process.env[name];
  return value === undefined ? fallback : value;
}

function bool(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined || value.trim() === "") return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

function int(name: string, fallback: number): number {
  const value = Number.parseInt(str(name), 10);
  return Number.isFinite(value) ? value : fallback;
}

function list(name: string): string[] {
  return str(name)
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

export type CookieSameSite = "Lax" | "Strict" | "None";

export const env = {
  get NODE_ENV(): string {
    return str("NODE_ENV", "development");
  },
  get isProduction(): boolean {
    return this.NODE_ENV === "production";
  },
  /** Listen port for the Node adapter (sandbox: 3000 standalone, 3002 as a client sidecar). */
  get PORT(): number {
    return int("PORT", 3000);
  },
  get ENABLE_DATABASE(): boolean {
    return bool("ENABLE_DATABASE");
  },
  get DATABASE_URL(): string {
    return str("DATABASE_URL");
  },
  /** Postgres schema Dual7 maps to (search_path). Defaults empty → public via URL options. */
  get DATABASE_SCHEMA(): string {
    return str("DATABASE_SCHEMA");
  },
  /** JWT signing secret. `AUTH_SECRET` wins; the NextAuth names are honoured for parity. */
  get AUTH_SECRET(): string {
    return (
      process.env.AUTH_SECRET ||
      process.env.NEXTAUTH_SECRET ||
      process.env.AUTHJS_SECRET ||
      ""
    ).trim();
  },
  get PUBLIC_SIGNUP_ENABLED(): boolean {
    return bool("PUBLIC_SIGNUP_ENABLED");
  },
  /** Exact origins allowed to make credentialed cross-origin calls. */
  get ALLOWED_CORS_ORIGINS(): string[] {
    return list("AS_ALLOWED_CORS_ORIGINS");
  },
  /** Public URL of the CLIENT app (used in password-reset links). */
  get APP_URL(): string {
    return (
      process.env.APP_URL ||
      process.env.AUTH_URL ||
      process.env.NEXTAUTH_URL ||
      ""
    )
      .trim()
      .replace(/\/+$/, "");
  },
  get RESEND_API_KEY(): string {
    return str("RESEND_API_KEY").trim();
  },
  get AUTH_EMAIL_FROM(): string {
    return str("AUTH_EMAIL_FROM", "no-reply@example.com").trim();
  },
  /** `Lax` (default, same-site clients) or `None` (split deploys on another origin; requires HTTPS). */
  get AUTH_COOKIE_SAME_SITE(): CookieSameSite {
    const raw = str("AUTH_COOKIE_SAME_SITE", "Lax").trim().toLowerCase();
    if (raw === "none") return "None";
    if (raw === "strict") return "Strict";
    return "Lax";
  },
  /** Force the Secure cookie flag on/off; unset = derive from the request scheme. */
  get AUTH_COOKIE_SECURE(): boolean | null {
    const value = process.env.AUTH_COOKIE_SECURE;
    if (value === undefined || value.trim() === "") return null;
    return /^(1|true|yes|on)$/i.test(value.trim());
  },
  /** Trusted-proxy token: a caller presenting it on `x-as-integration-token` may call integration routes. */
  get AS_INTEGRATION_ROUTE_TOKEN(): string {
    return str("AS_INTEGRATION_ROUTE_TOKEN").trim();
  },
  /** Per-app action manifest the platform syncs (same path as the Next.js stacks). */
  get INTEGRATION_MANIFEST_PATH(): string {
    return str(
      "AS_INTEGRATION_MANIFEST_PATH",
      "lib/integrations/connectors/manifest.json",
    );
  },
};
