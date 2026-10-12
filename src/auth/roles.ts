/**
 * Platform-owned role list — do NOT edit by hand.
 *
 * The platform may later regenerate this file from the app's approved schema
 * (the Next.js auth bundle substitutes role-list placeholder tokens at
 * auth-provision time; this file deliberately contains none). Until then it
 * ships as a plain file with the defaults the platform-provisioned
 * `users.role` column expects.
 *
 * Conventions:
 *   - `ROLE_LIST[0]` is the most privileged role; the FIRST user to sign up
 *     receives it so a brand-new deploy has an admin without an out-of-band
 *     role bump.
 *   - `DEFAULT_ROLE` (the last entry) is what every later signup receives.
 */
export const ROLE_LIST = ["admin", "user"] as const;

export type AppRole = (typeof ROLE_LIST)[number];

export const APP_ROLES: readonly AppRole[] = ROLE_LIST;

export const FIRST_USER_ROLE: AppRole = ROLE_LIST[0];

export const DEFAULT_ROLE: AppRole = ROLE_LIST[ROLE_LIST.length - 1];

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && (ROLE_LIST as readonly string[]).includes(value);
}
