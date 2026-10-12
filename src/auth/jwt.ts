/**
 * Platform-owned token primitives — do NOT edit.
 *
 * Two tokens:
 *   - ACCESS token: a short-lived (15 min) HS256 JWT signed with `AUTH_SECRET`
 *     (`NEXTAUTH_SECRET` honoured). Carries `sub`, `email`, `name`, `role`.
 *     Presented as `Authorization: Bearer <jwt>` or in the `as_session`
 *     cookie. Verified statelessly on every request.
 *   - REFRESH token: an opaque random string stored HASHED in
 *     `sessions."sessionToken"` with `expires` (30 days), rotated on every
 *     use. Presented as `{ refreshToken }` in the body or in the `as_refresh`
 *     cookie (path-scoped to the auth routes).
 */
import { createHash, randomBytes } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { env } from "../env";

export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

/** httpOnly cookie carrying the access JWT (web clients on the same site). */
export const SESSION_COOKIE = "as_session";
/** httpOnly cookie carrying the refresh token; scoped to the auth routes. */
export const REFRESH_COOKIE = "as_refresh";

export interface SessionUser {
  id: string;
  email: string | null;
  name: string | null;
  /** `users.role` at token mint time; refreshed on every `/auth/refresh`. */
  role: string;
}

const DEV_FALLBACK_SECRET = "dev-only-insecure-secret-set-AUTH_SECRET";
let warnedFallback = false;

function secretBytes(): Uint8Array {
  const secret = env.AUTH_SECRET;
  if (secret) return new TextEncoder().encode(secret);
  if (env.isProduction) {
    throw new Error("AUTH_SECRET (or NEXTAUTH_SECRET) is not configured.");
  }
  if (!warnedFallback) {
    warnedFallback = true;
    console.warn(
      "[auth] AUTH_SECRET is not set — using an insecure development secret. Set AUTH_SECRET before deploying.",
    );
  }
  return new TextEncoder().encode(DEV_FALLBACK_SECRET);
}

export async function signAccessToken(user: SessionUser): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    email: user.email,
    name: user.name,
    role: user.role,
    typ: "access",
  })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setSubject(String(user.id))
    .setIssuedAt(now)
    .setExpirationTime(now + ACCESS_TOKEN_TTL_SECONDS)
    .sign(secretBytes());
}

/** Returns the user encoded in a valid, unexpired access token; null otherwise. */
export async function verifyAccessToken(token: string): Promise<SessionUser | null> {
  try {
    const { payload } = await jwtVerify(token, secretBytes(), {
      algorithms: ["HS256"],
    });
    if (!payload.sub || payload.typ !== "access") return null;
    return {
      id: payload.sub,
      email: typeof payload.email === "string" ? payload.email : null,
      name: typeof payload.name === "string" ? payload.name : null,
      role: typeof payload.role === "string" && payload.role ? payload.role : "user",
    };
  } catch {
    return null;
  }
}

/** Opaque, URL-safe, 256 bits of entropy. */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Tokens are stored hashed so a database read never yields a usable credential. */
export function hashOpaqueToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}
