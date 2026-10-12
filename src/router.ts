/**
 * Platform-owned router factory and response-envelope schemas — do NOT edit.
 *
 * Every Hono sub-app in this service (platform auth, integrations, and the
 * agent's own `src/routes/**`) is created with `createRouter()` so it shares:
 *   - the request-scoped `user` variable set by the auth middleware
 *   - the platform's validation-error envelope `{ success: false, error }`
 *
 * Route files declare zod schemas with `createRoute` from `@hono/zod-openapi`;
 * those schemas are the OpenAPI source of truth (`npm run openapi`).
 */
import { OpenAPIHono, z } from "@hono/zod-openapi";
import type { SessionUser } from "./auth/jwt";

/** Hono environment shared by every router in the service. */
export type AppEnv = {
  Variables: {
    /** Set by `optionalUser` / `requireUser`; null when unauthenticated. */
    user: SessionUser | null;
  };
};

export type AppRouter = OpenAPIHono<AppEnv>;

/** Error envelope: `{ success: false, error }`. */
export const ErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string(),
  })
  .openapi("ErrorResponse");

/** Success envelope: `{ success: true, data }`. */
export function successSchema<T extends z.ZodTypeAny>(data: T) {
  return z.object({ success: z.literal(true), data });
}

/** OpenAPI `content` block for a JSON body/response. */
export function jsonContent<T extends z.ZodTypeAny>(schema: T, description: string) {
  return { description, content: { "application/json": { schema } } };
}

function formatZodError(error: z.ZodError): string {
  return error.issues
    .map((issue) => {
      const path = issue.path.join(".");
      return path ? `${path}: ${issue.message}` : issue.message;
    })
    .join("; ");
}

/**
 * A typed OpenAPI router. Validation failures answer 400 with the platform
 * envelope instead of zod's raw issue list.
 */
export function createRouter(): AppRouter {
  return new OpenAPIHono<AppEnv>({
    defaultHook: (result, c) => {
      if (!result.success) {
        return c.json(
          { success: false as const, error: formatZodError(result.error) },
          400,
        );
      }
      return undefined;
    },
  });
}
