import { createRoute, z } from "@hono/zod-openapi";
import { currentUser, requireUser } from "@/auth/middleware";
import { query } from "@/db";
import { ErrorResponseSchema, createRouter, jsonContent, successSchema } from "@/router";
import { ISO, internalError } from "@/lib/records";

const NotificationSchema = z
  .object({
    id: z.string().uuid(),
    reminder_id: z.string().uuid().nullable(),
    title: z.string(),
    message: z.string(),
    notification_type: z.enum(["reminder", "health_alert", "system"]),
    is_read: z.boolean(),
    created_at: z.string(),
  })
  .openapi("Notification");

type Notification = z.infer<typeof NotificationSchema>;

const ListQuery = z.object({
  unread_only: z
    .enum(["true", "false"])
    .optional()
    .openapi({ param: { name: "unread_only", in: "query" } }),
  limit: z.coerce.number().int().min(1).max(100).optional().openapi({ param: { name: "limit", in: "query" } }),
});

const IdParams = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
});

const SELECT = `id, reminder_id, title, message, notification_type, is_read, ${ISO("created_at")} AS created_at`;

export const notificationsRoutes = createRouter();

notificationsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["notifications"],
    summary: "List the caller's in-app notifications with the unread count",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { query: ListQuery },
    responses: {
      200: jsonContent(
        z.object({
          success: z.literal(true),
          data: z.array(NotificationSchema),
          unread_count: z.number().int(),
        }),
        "Notifications",
      ),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const q = c.req.valid("query");
      const unreadOnly = q.unread_only === "true";
      const rows = await query<Notification>(
        `SELECT ${SELECT} FROM notifications
          WHERE user_id = $1 ${unreadOnly ? "AND is_read = false" : ""}
          ORDER BY created_at DESC LIMIT $2`,
        [user.id, q.limit ?? 30],
      );
      const counts = await query<{ unread: number }>(
        `SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND is_read = false`,
        [user.id],
      );
      return c.json({ success: true as const, data: rows, unread_count: counts[0]?.unread ?? 0 }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

notificationsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/read-all",
    tags: ["notifications"],
    summary: "Mark all of the caller's notifications as read",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    responses: {
      200: jsonContent(successSchema(z.object({ updated: z.number().int() })), "Marked read"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const rows = await query<{ id: string }>(
        `UPDATE notifications SET is_read = true, updated_at = now() WHERE user_id = $1 AND is_read = false RETURNING id`,
        [user.id],
      );
      return c.json({ success: true as const, data: { updated: rows.length } }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

notificationsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/{id}/read",
    tags: ["notifications"],
    summary: "Mark one notification as read",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { params: IdParams },
    responses: {
      200: jsonContent(successSchema(NotificationSchema), "Marked read"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "Not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const { id } = c.req.valid("param");
      const rows = await query<Notification>(
        `UPDATE notifications SET is_read = true, updated_at = now() WHERE id = $1 AND user_id = $2 RETURNING ${SELECT}`,
        [id, user.id],
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Notification not found" }, 404);
      return c.json({ success: true as const, data: rows[0] }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

notificationsRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["notifications"],
    summary: "Delete a notification",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { params: IdParams },
    responses: {
      200: jsonContent(successSchema(z.object({ id: z.string().uuid() })), "Deleted"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "Not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const { id } = c.req.valid("param");
      const rows = await query<{ id: string }>(
        `DELETE FROM notifications WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, user.id],
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Notification not found" }, 404);
      return c.json({ success: true as const, data: { id: rows[0].id } }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);
