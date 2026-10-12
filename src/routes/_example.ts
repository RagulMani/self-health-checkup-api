/**
 * Example resource router — reference only, NOT mounted.
 *
 * Copy this file to src/routes/<resource>.ts, adapt the schemas and SQL, and
 * register the export in src/routes/index.ts. Everything the platform
 * expects of a route is demonstrated here:
 *
 *   - `createRoute` with zod schemas for params, body, and every response
 *     status you return (they become openapi.json — the clients' contract)
 *   - the `{ success: true, data }` / `{ success: false, error }` envelope
 *   - auth via `middleware: [requireUser]` or `[authorize("admin")]`, and
 *     `currentUser(c)` inside the handler
 *   - database access ONLY through `query()` from "@/db"
 */
import { createRoute, z } from "@hono/zod-openapi";
import { authorize, currentUser, requireUser } from "@/auth/middleware";
import { query } from "@/db";
import {
  ErrorResponseSchema,
  createRouter,
  jsonContent,
  successSchema,
} from "@/router";

const ProjectSchema = z
  .object({
    id: z.string().uuid(),
    name: z.string(),
    owner_id: z.string().uuid(),
    created_at: z.string(),
  })
  .openapi("Project");

const CreateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200),
});

const IdParams = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
});

export const exampleRoutes = createRouter();

const listRoute = createRoute({
  method: "get",
  path: "/",
  tags: ["projects"],
  summary: "List the caller's projects",
  middleware: [requireUser],
  security: [{ bearerAuth: [] }],
  responses: {
    200: jsonContent(successSchema(z.array(ProjectSchema)), "Projects"),
    401: jsonContent(ErrorResponseSchema, "Not authenticated"),
  },
});
exampleRoutes.openapi(listRoute, async (c) => {
  const user = currentUser(c);
  const rows = await query<z.infer<typeof ProjectSchema>>(
    `SELECT id, name, owner_id, created_at FROM projects WHERE owner_id = $1 ORDER BY created_at DESC`,
    [user.id],
  );
  return c.json({ success: true as const, data: rows }, 200);
});

const createProjectRoute = createRoute({
  method: "post",
  path: "/",
  tags: ["projects"],
  summary: "Create a project",
  middleware: [requireUser],
  security: [{ bearerAuth: [] }],
  request: { body: jsonContent(CreateProjectSchema, "New project") },
  responses: {
    201: jsonContent(successSchema(ProjectSchema), "Created"),
    400: jsonContent(ErrorResponseSchema, "Validation error"),
    401: jsonContent(ErrorResponseSchema, "Not authenticated"),
  },
});
exampleRoutes.openapi(createProjectRoute, async (c) => {
  const user = currentUser(c);
  const body = c.req.valid("json");
  const rows = await query<z.infer<typeof ProjectSchema>>(
    `INSERT INTO projects (id, name, owner_id, created_at)
     VALUES (gen_random_uuid(), $1, $2, now())
     RETURNING id, name, owner_id, created_at`,
    [body.name, user.id],
  );
  return c.json({ success: true as const, data: rows[0] }, 201);
});

const deleteRoute = createRoute({
  method: "delete",
  path: "/{id}",
  tags: ["projects"],
  summary: "Delete a project (admins only)",
  middleware: [authorize("admin")],
  security: [{ bearerAuth: [] }],
  request: { params: IdParams },
  responses: {
    200: jsonContent(successSchema(z.object({ id: z.string().uuid() })), "Deleted"),
    401: jsonContent(ErrorResponseSchema, "Not authenticated"),
    403: jsonContent(ErrorResponseSchema, "Wrong role"),
    404: jsonContent(ErrorResponseSchema, "No such project"),
  },
});
exampleRoutes.openapi(deleteRoute, async (c) => {
  const { id } = c.req.valid("param");
  const rows = await query<{ id: string }>(
    `DELETE FROM projects WHERE id = $1 RETURNING id`,
    [id],
  );
  if (rows.length === 0) {
    return c.json({ success: false as const, error: "Project not found" }, 404);
  }
  return c.json({ success: true as const, data: { id: rows[0].id } }, 200);
});
