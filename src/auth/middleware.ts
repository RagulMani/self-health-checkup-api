/**
 * Platform-owned auth middleware — do NOT edit.
 *
 *   optionalUser        sets c.get('user') to the caller or null; never rejects
 *   requireUser         401 unless a valid access token is presented
 *   authorize(...roles) 401 unless authenticated, 403 unless role is allowed;
 *                       no roles = any authenticated user
 *
 * Usage in a route file:
 *   const route = createRoute({ ..., middleware: [authorize("admin")] });
 *   app.openapi(route, (c) => { const user = currentUser(c); ... });
 */
import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv } from "../router";
import { SESSION_COOKIE, verifyAccessToken, type SessionUser } from "./jwt";
import type { AppRole } from "./roles";

/** Bearer header first, then the `as_session` cookie. */
export function readAccessToken(c: Context): string | null {
  const auth = c.req.header("authorization") ?? "";
  const bearer = auth.match(/^Bearer\s+(\S+)/i);
  if (bearer?.[1]) return bearer[1].trim();
  const cookie = getCookie(c, SESSION_COOKIE);
  return cookie ? cookie : null;
}

export async function resolveUser(c: Context): Promise<SessionUser | null> {
  const token = readAccessToken(c);
  if (!token) return null;
  return verifyAccessToken(token);
}

export const optionalUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("user", await resolveUser(c));
  await next();
};

export const requireUser: MiddlewareHandler<AppEnv> = async (c, next) => {
  const user = await resolveUser(c);
  if (!user) {
    return c.json({ success: false as const, error: "Authentication required" }, 401);
  }
  c.set("user", user);
  await next();
};

export function authorize(...allowedRoles: AppRole[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const user = await resolveUser(c);
    if (!user) {
      return c.json({ success: false as const, error: "Authentication required" }, 401);
    }
    if (allowedRoles.length > 0 && !(allowedRoles as readonly string[]).includes(user.role)) {
      return c.json(
        {
          success: false as const,
          error: `Role '${user.role}' not in allow-list [${allowedRoles.join(", ")}]`,
        },
        403,
      );
    }
    c.set("user", user);
    await next();
  };
}

/** The authenticated caller. Only call after `requireUser` / `authorize`. */
export function currentUser(c: Context<AppEnv>): SessionUser {
  const user = c.get("user");
  if (!user) {
    throw new Error("currentUser() called on a route without requireUser/authorize middleware");
  }
  return user;
}
