/**
 * Platform-owned auth routes — do NOT edit. Mounted at `/api/auth`.
 *
 *   POST /signup           { email, password, name? }      → 201 { user, accessToken, refreshToken, expiresIn }
 *   POST /login            { email, password }             → 200 { user, accessToken, refreshToken, expiresIn }
 *   POST /logout           { refreshToken? } | cookie      → 200 { ok: true }
 *   POST /refresh          { refreshToken? } | cookie      → 200 { user, accessToken, refreshToken, expiresIn }
 *   GET  /session          Bearer | cookie                 → 200 { user | null }
 *   POST /forgot-password  { email }                       → 200 { ok: true }   (always; never enumerates)
 *   POST /reset-password   { token, password }             → 200 { ok: true }
 *
 * Web clients (same site, via the dev-server `/api` proxy) rely on the
 * httpOnly cookies set here; mobile clients store the tokens from the body and
 * send `Authorization: Bearer`. Both are set/accepted on every call.
 *
 * Requires a database: the users / sessions / verification_token tables are
 * platform-provisioned when the app is mapped to one. In mock mode every
 * route answers 503 so a client sees an honest "no auth yet" instead of a
 * fake login.
 */
import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { createRoute, z } from "@hono/zod-openapi";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { isMockMode, query } from "../db";
import { env } from "../env";
import {
  ErrorResponseSchema,
  createRouter,
  jsonContent,
  successSchema,
} from "../router";
import { sendAuthEmail } from "./email";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  REFRESH_COOKIE,
  SESSION_COOKIE,
  generateOpaqueToken,
  hashOpaqueToken,
  signAccessToken,
  type SessionUser,
} from "./jwt";
import { optionalUser } from "./middleware";
import { DEFAULT_ROLE, FIRST_USER_ROLE } from "./roles";
import {
  USER_COLUMNS,
  createSession,
  revokeAllSessions,
  revokeSession,
  rotateSession,
  type DbUser,
  type IssuedRefreshToken,
} from "./sessions";

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
const RESET_IDENTIFIER_PREFIX = "password-reset:";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// ─── Schemas ────────────────────────────────────────────────────────────────

const UserSchema = z
  .object({
    id: z.string(),
    email: z.string().nullable(),
    name: z.string().nullable(),
    role: z.string(),
  })
  .openapi("AuthUser");

const TokenBundleSchema = z
  .object({
    user: UserSchema,
    accessToken: z.string(),
    refreshToken: z.string(),
    /** Access-token lifetime in seconds. */
    expiresIn: z.number(),
  })
  .openapi("AuthTokens");

const CredentialsSchema = z.object({
  email: z.string().min(1).openapi({ example: "you@example.com" }),
  password: z.string().min(1),
});

const SignupSchema = CredentialsSchema.extend({
  name: z.string().trim().max(200).optional(),
});

/**
 * Optional `{ refreshToken }` body for /logout and /refresh. Documented as a
 * plain OpenAPI schema (not zod) on purpose: zod-openapi would otherwise
 * install the JSON validator, which answers 400 to a cookie-only caller that
 * sends `Content-Type: application/json` with an empty body.
 */
const OptionalRefreshBody = {
  description: "Optional refresh token; the `as_refresh` cookie is used when omitted.",
  required: false,
  content: {
    "application/json": {
      schema: {
        type: "object",
        properties: { refreshToken: { type: "string" } },
      },
    },
  },
} as const;

async function readOptionalJson(c: Context): Promise<{ refreshToken?: string }> {
  try {
    const text = await c.req.text();
    if (!text.trim()) return {};
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const token = (parsed as { refreshToken?: unknown }).refreshToken;
      return typeof token === "string" ? { refreshToken: token } : {};
    }
  } catch {
    /* not JSON — cookie path */
  }
  return {};
}

const OkSchema = successSchema(z.object({ ok: z.literal(true) }));

const errorResponses = {
  400: jsonContent(ErrorResponseSchema, "Validation error"),
  503: jsonContent(ErrorResponseSchema, "Auth requires a database"),
};

// ─── Helpers ────────────────────────────────────────────────────────────────

function publicUser(user: DbUser | SessionUser): SessionUser {
  return { id: String(user.id), email: user.email ?? null, name: user.name ?? null, role: user.role };
}

function isSecureRequest(c: Context): boolean {
  const forced = env.AUTH_COOKIE_SECURE;
  if (forced !== null) return forced;
  const proto = c.req.header("x-forwarded-proto");
  if (proto) return proto.split(",")[0].trim() === "https";
  return new URL(c.req.url).protocol === "https:";
}

function cookieBase(c: Context) {
  const sameSite = env.AUTH_COOKIE_SAME_SITE;
  // SameSite=None is only honoured by browsers on Secure cookies.
  const secure = sameSite === "None" ? true : isSecureRequest(c);
  return { httpOnly: true, sameSite, secure } as const;
}

function setAuthCookies(c: Context, accessToken: string, issued: IssuedRefreshToken): void {
  const base = cookieBase(c);
  setCookie(c, SESSION_COOKIE, accessToken, {
    ...base,
    path: "/",
    maxAge: ACCESS_TOKEN_TTL_SECONDS,
  });
  setCookie(c, REFRESH_COOKIE, issued.refreshToken, {
    ...base,
    path: "/api/auth",
    expires: issued.expires,
  });
}

function clearAuthCookies(c: Context): void {
  const base = cookieBase(c);
  deleteCookie(c, SESSION_COOKIE, { ...base, path: "/" });
  deleteCookie(c, REFRESH_COOKIE, { ...base, path: "/api/auth" });
}

async function issueTokens(c: Context, user: DbUser) {
  const session = publicUser(user);
  const [accessToken, issued] = await Promise.all([
    signAccessToken(session),
    createSession(user.id),
  ]);
  setAuthCookies(c, accessToken, issued);
  return {
    user: session,
    accessToken,
    refreshToken: issued.refreshToken,
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

function refreshTokenFrom(c: Context, body: { refreshToken?: string } | undefined): string | null {
  const fromBody = body?.refreshToken?.trim();
  if (fromBody) return fromBody;
  const fromCookie = getCookie(c, REFRESH_COOKIE);
  return fromCookie ? fromCookie : null;
}

const MOCK_MODE_ERROR =
  "Auth requires a database. Map this API service to a database (ENABLE_DATABASE=true + DATABASE_URL) so the platform can provision the users and sessions tables.";

// ─── Router ─────────────────────────────────────────────────────────────────

export function createAuthRoutes() {
  const app = createRouter();

  const signupRoute = createRoute({
    method: "post",
    path: "/signup",
    tags: ["auth"],
    summary: "Create an account with email + password",
    request: { body: jsonContent(SignupSchema, "Signup payload") },
    responses: {
      201: jsonContent(successSchema(TokenBundleSchema), "Account created and signed in"),
      403: jsonContent(ErrorResponseSchema, "Self-signup disabled"),
      409: jsonContent(ErrorResponseSchema, "Email already registered"),
      ...errorResponses,
    },
  });
  app.openapi(signupRoute, async (c) => {
    if (isMockMode) return c.json({ success: false as const, error: MOCK_MODE_ERROR }, 503);
    if (!env.PUBLIC_SIGNUP_ENABLED) {
      return c.json(
        { success: false as const, error: "Self-signup is disabled. Contact your admin." },
        403,
      );
    }
    const body = c.req.valid("json");
    const email = body.email.trim().toLowerCase();
    const password = body.password;
    const name = body.name ? body.name.trim() : null;
    if (!EMAIL_RE.test(email)) {
      return c.json({ success: false as const, error: "Valid email required" }, 400);
    }
    if (password.length < 8) {
      return c.json(
        { success: false as const, error: "Password must be at least 8 characters" },
        400,
      );
    }
    const existing = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    if (existing.length > 0) {
      return c.json(
        { success: false as const, error: "An account with that email already exists" },
        409,
      );
    }
    const countRows = await query<{ n: string }>(`SELECT count(*)::text AS n FROM users`);
    const isFirstUser = countRows[0]?.n === "0";
    const role = isFirstUser ? FIRST_USER_ROLE : DEFAULT_ROLE;
    const password_hash = await bcrypt.hash(password, 10);
    const inserted = await query<DbUser>(
      `INSERT INTO users (id, email, name, password_hash, role)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING ${USER_COLUMNS}`,
      [randomUUID(), email, name, password_hash, role],
    );
    const user = inserted[0];
    if (!user) {
      return c.json({ success: false as const, error: "Signup failed" }, 503);
    }
    return c.json({ success: true as const, data: await issueTokens(c, user) }, 201);
  });

  const loginRoute = createRoute({
    method: "post",
    path: "/login",
    tags: ["auth"],
    summary: "Sign in with email + password",
    request: { body: jsonContent(CredentialsSchema, "Credentials") },
    responses: {
      200: jsonContent(successSchema(TokenBundleSchema), "Signed in"),
      401: jsonContent(ErrorResponseSchema, "Bad credentials"),
      ...errorResponses,
    },
  });
  app.openapi(loginRoute, async (c) => {
    if (isMockMode) return c.json({ success: false as const, error: MOCK_MODE_ERROR }, 503);
    const body = c.req.valid("json");
    const email = body.email.trim().toLowerCase();
    const rows = await query<DbUser>(
      `SELECT ${USER_COLUMNS} FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    const user = rows[0];
    const ok = user?.password_hash ? await bcrypt.compare(body.password, user.password_hash) : false;
    if (!user || !ok) {
      return c.json({ success: false as const, error: "Email or password is incorrect" }, 401);
    }
    return c.json({ success: true as const, data: await issueTokens(c, user) }, 200);
  });

  const logoutRoute = createRoute({
    method: "post",
    path: "/logout",
    tags: ["auth"],
    summary: "Revoke the refresh token and clear cookies",
    request: { body: OptionalRefreshBody },
    responses: { 200: jsonContent(OkSchema, "Signed out") },
  });
  app.openapi(logoutRoute, async (c) => {
    const raw = refreshTokenFrom(c, await readOptionalJson(c));
    if (raw && !isMockMode) await revokeSession(raw).catch(() => undefined);
    clearAuthCookies(c);
    return c.json({ success: true as const, data: { ok: true as const } }, 200);
  });

  const refreshRoute = createRoute({
    method: "post",
    path: "/refresh",
    tags: ["auth"],
    summary: "Rotate the refresh token and mint a new access token",
    request: { body: OptionalRefreshBody },
    responses: {
      200: jsonContent(successSchema(TokenBundleSchema), "Fresh tokens"),
      401: jsonContent(ErrorResponseSchema, "Refresh token missing, expired, or revoked"),
      ...errorResponses,
    },
  });
  app.openapi(refreshRoute, async (c) => {
    if (isMockMode) return c.json({ success: false as const, error: MOCK_MODE_ERROR }, 503);
    const raw = refreshTokenFrom(c, await readOptionalJson(c));
    if (!raw) {
      return c.json({ success: false as const, error: "Refresh token required" }, 401);
    }
    const rotated = await rotateSession(raw);
    if (!rotated) {
      clearAuthCookies(c);
      return c.json({ success: false as const, error: "Session expired. Sign in again." }, 401);
    }
    const session = publicUser(rotated.user);
    const accessToken = await signAccessToken(session);
    setAuthCookies(c, accessToken, rotated.issued);
    return c.json(
      {
        success: true as const,
        data: {
          user: session,
          accessToken,
          refreshToken: rotated.issued.refreshToken,
          expiresIn: ACCESS_TOKEN_TTL_SECONDS,
        },
      },
      200,
    );
  });

  const sessionRoute = createRoute({
    method: "get",
    path: "/session",
    tags: ["auth"],
    summary: "The caller's user, or null",
    middleware: [optionalUser],
    security: [{ bearerAuth: [] }, {}],
    responses: {
      200: jsonContent(successSchema(z.object({ user: UserSchema.nullable() })), "Session state"),
    },
  });
  app.openapi(sessionRoute, (c) => {
    const user = c.get("user");
    return c.json({ success: true as const, data: { user: user ? publicUser(user) : null } }, 200);
  });

  const forgotRoute = createRoute({
    method: "post",
    path: "/forgot-password",
    tags: ["auth"],
    summary: "Email a single-use password-reset link",
    request: { body: jsonContent(z.object({ email: z.string().min(1) }), "Account email") },
    responses: {
      200: jsonContent(OkSchema, "Always OK — never reveals whether the email exists"),
      ...errorResponses,
    },
  });
  app.openapi(forgotRoute, async (c) => {
    const email = c.req.valid("json").email.trim().toLowerCase();
    const okResponse = { success: true as const, data: { ok: true as const } };
    if (isMockMode || !EMAIL_RE.test(email)) return c.json(okResponse, 200);
    const rows = await query<{ id: string }>(
      `SELECT id FROM users WHERE email = $1 LIMIT 1`,
      [email],
    );
    if (rows.length === 0) return c.json(okResponse, 200);
    const rawToken = generateOpaqueToken();
    const identifier = `${RESET_IDENTIFIER_PREFIX}${email}`;
    const expires = new Date(Date.now() + RESET_TOKEN_TTL_MS).toISOString();
    await query(`DELETE FROM verification_token WHERE identifier = $1`, [identifier]);
    await query(
      `INSERT INTO verification_token (identifier, token, expires) VALUES ($1, $2, $3)`,
      [identifier, hashOpaqueToken(rawToken), expires],
    );
    const base = env.APP_URL || new URL(c.req.url).origin;
    const link = `${base}/reset-password?token=${encodeURIComponent(rawToken)}`;
    await sendAuthEmail({
      to: email,
      subject: "Reset your password",
      text: `Use this link to choose a new password (valid for 1 hour):\n\n${link}\n\nIf you did not request a reset you can ignore this email.`,
      html: `<p>Use this link to choose a new password (valid for 1 hour):</p><p><a href="${link}">${link}</a></p><p>If you did not request a reset you can ignore this email.</p>`,
    }).catch((err) => console.error("[auth/forgot-password] email failed", err));
    return c.json(okResponse, 200);
  });

  const resetRoute = createRoute({
    method: "post",
    path: "/reset-password",
    tags: ["auth"],
    summary: "Set a new password using a reset token",
    request: {
      body: jsonContent(
        z.object({ token: z.string().min(1), password: z.string().min(1) }),
        "Reset token + new password",
      ),
    },
    responses: {
      200: jsonContent(OkSchema, "Password updated; all sessions revoked"),
      401: jsonContent(ErrorResponseSchema, "Token invalid or expired"),
      ...errorResponses,
    },
  });
  app.openapi(resetRoute, async (c) => {
    if (isMockMode) return c.json({ success: false as const, error: MOCK_MODE_ERROR }, 503);
    const { token, password } = c.req.valid("json");
    if (password.length < 8) {
      return c.json(
        { success: false as const, error: "Password must be at least 8 characters" },
        400,
      );
    }
    const rows = await query<{ identifier: string; expires: string }>(
      `SELECT identifier, expires FROM verification_token WHERE token = $1 LIMIT 1`,
      [hashOpaqueToken(token)],
    );
    const row = rows[0];
    if (!row || !row.identifier.startsWith(RESET_IDENTIFIER_PREFIX)) {
      return c.json({ success: false as const, error: "Reset link is invalid" }, 401);
    }
    await query(`DELETE FROM verification_token WHERE identifier = $1`, [row.identifier]);
    if (new Date(row.expires).getTime() <= Date.now()) {
      return c.json({ success: false as const, error: "Reset link has expired" }, 401);
    }
    const email = row.identifier.slice(RESET_IDENTIFIER_PREFIX.length);
    const password_hash = await bcrypt.hash(password, 10);
    const updated = await query<{ id: string }>(
      `UPDATE users SET password_hash = $1 WHERE email = $2 RETURNING id`,
      [password_hash, email],
    );
    const userId = updated[0]?.id;
    if (userId) await revokeAllSessions(userId);
    clearAuthCookies(c);
    return c.json({ success: true as const, data: { ok: true as const } }, 200);
  });

  return app;
}
