/**
 * Platform-owned refresh-token store — do NOT edit.
 *
 * Refresh tokens live in the platform-provisioned `sessions` table
 * (`"sessionToken"` = sha256 of the opaque token, `"userId"`, `expires`).
 * Column names are camelCase-quoted because the table shape is shared with the
 * NextAuth adapter used by the Next.js stacks.
 */
import { randomUUID } from "node:crypto";
import { query } from "../db";
import {
  REFRESH_TOKEN_TTL_SECONDS,
  generateOpaqueToken,
  hashOpaqueToken,
} from "./jwt";

export interface DbUser {
  id: string;
  email: string | null;
  name: string | null;
  role: string;
  password_hash: string | null;
}

export const USER_COLUMNS = `id, email, name, role, password_hash`;

export interface IssuedRefreshToken {
  refreshToken: string;
  expires: Date;
}

export async function createSession(userId: string): Promise<IssuedRefreshToken> {
  const refreshToken = generateOpaqueToken();
  const expires = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  await query(
    `INSERT INTO sessions (id, "sessionToken", "userId", expires)
     VALUES ($1, $2, $3, $4)`,
    [randomUUID(), hashOpaqueToken(refreshToken), userId, expires.toISOString()],
  );
  return { refreshToken, expires };
}

/**
 * Consume a refresh token: returns the user and a NEW token, or null when the
 * token is unknown, expired, or already used (rotation makes replay fail).
 */
export async function rotateSession(
  rawRefreshToken: string,
): Promise<{ user: DbUser; issued: IssuedRefreshToken } | null> {
  const hashed = hashOpaqueToken(rawRefreshToken);
  const rows = await query<DbUser & { session_id: string; expires: string }>(
    `SELECT s.id AS session_id, s.expires, u.id, u.email, u.name, u.role, u.password_hash
       FROM sessions s
       JOIN users u ON u.id = s."userId"
      WHERE s."sessionToken" = $1
      LIMIT 1`,
    [hashed],
  );
  const row = rows[0];
  if (!row) return null;
  await query(`DELETE FROM sessions WHERE id = $1`, [row.session_id]);
  if (new Date(row.expires).getTime() <= Date.now()) return null;
  const issued = await createSession(row.id);
  return {
    user: {
      id: row.id,
      email: row.email,
      name: row.name,
      role: row.role,
      password_hash: row.password_hash,
    },
    issued,
  };
}

export async function revokeSession(rawRefreshToken: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE "sessionToken" = $1`, [
    hashOpaqueToken(rawRefreshToken),
  ]);
}

export async function revokeAllSessions(userId: string): Promise<void> {
  await query(`DELETE FROM sessions WHERE "userId" = $1`, [userId]);
}
