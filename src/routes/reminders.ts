import { createRoute, z } from "@hono/zod-openapi";
import { currentUser, requireUser } from "@/auth/middleware";
import { query } from "@/db";
import { ErrorResponseSchema, createRouter, jsonContent, successSchema } from "@/router";
import { ISO, internalError } from "@/lib/records";

const REMINDER_TYPES = ["checkup", "medication", "exercise", "water", "other"] as const;
const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
type Weekday = (typeof WEEKDAYS)[number];

const ReminderSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    reminder_type: z.enum(REMINDER_TYPES),
    reminder_time: z.string().openapi({ example: "08:30" }),
    days_of_week: z.array(z.enum(WEEKDAYS)),
    notes: z.string().nullable(),
    is_active: z.boolean(),
    last_completed_on: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi("Reminder");

const TodayReminderSchema = ReminderSchema.extend({
  completed_today: z.boolean(),
  is_due: z.boolean(),
}).openapi("TodayReminder");

type ReminderRow = Omit<z.infer<typeof ReminderSchema>, "days_of_week"> & { days_of_week: string };

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const ReminderInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    reminder_type: z.enum(REMINDER_TYPES),
    reminder_time: z.string().regex(TIME_RE, "Use 24-hour HH:MM"),
    days_of_week: z.array(z.enum(WEEKDAYS)).min(1, "Pick at least one day").optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    is_active: z.boolean().optional(),
  })
  .openapi("ReminderInput");

const ReminderUpdateSchema = ReminderInputSchema.partial().openapi("ReminderUpdate");

const IdParams = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
});

const TodayQuery = z.object({
  date: z.string().regex(DATE_RE).optional().openapi({ param: { name: "date", in: "query" }, example: "2026-10-12" }),
  time: z.string().regex(TIME_RE).optional().openapi({ param: { name: "time", in: "query" }, example: "14:30" }),
});

const CompleteSchema = z
  .object({
    date: z.string().regex(DATE_RE, "Use YYYY-MM-DD"),
    completed: z.boolean().default(true),
  })
  .openapi("ReminderComplete");

const REMINDER_SELECT = `id, title, reminder_type, to_char(reminder_time, 'HH24:MI') AS reminder_time, days_of_week, notes,
  is_active, to_char(last_completed_on, 'YYYY-MM-DD') AS last_completed_on,
  ${ISO("created_at")} AS created_at, ${ISO("updated_at")} AS updated_at`;

function parseDays(value: string): Weekday[] {
  return value
    .split(",")
    .map((d) => d.trim())
    .filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d));
}

function toReminder(row: ReminderRow): z.infer<typeof ReminderSchema> {
  return { ...row, days_of_week: parseDays(row.days_of_week) };
}

const DEFAULT_DAYS = "mon,tue,wed,thu,fri,sat,sun";

const TYPE_LABEL: Record<(typeof REMINDER_TYPES)[number], string> = {
  checkup: "Health check-up",
  medication: "Medication",
  exercise: "Exercise",
  water: "Water intake",
  other: "Reminder",
};

export const remindersRoutes = createRouter();

remindersRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["reminders"],
    summary: "List the caller's reminders",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    responses: {
      200: jsonContent(successSchema(z.array(ReminderSchema)), "Reminders"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const rows = await query<ReminderRow>(
        `SELECT ${REMINDER_SELECT} FROM reminders WHERE user_id = $1 ORDER BY reminder_time ASC, created_at ASC`,
        [user.id],
      );
      return c.json({ success: true as const, data: rows.map(toReminder) }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

remindersRoutes.openapi(
  createRoute({
    method: "get",
    path: "/today",
    tags: ["reminders"],
    summary: "Today's reminders with completion status; creates in-app notifications for reminders that are due",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { query: TodayQuery },
    responses: {
      200: jsonContent(successSchema(z.array(TodayReminderSchema)), "Today's reminders"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const q = c.req.valid("query");
      const now = new Date();
      const date = q.date ?? now.toISOString().slice(0, 10);
      const time = q.time ?? now.toISOString().slice(11, 16);
      const weekday = WEEKDAYS[new Date(`${date}T12:00:00Z`).getUTCDay()];

      const rows = await query<ReminderRow>(
        `SELECT ${REMINDER_SELECT} FROM reminders WHERE user_id = $1 AND is_active = true ORDER BY reminder_time ASC`,
        [user.id],
      );
      const today = rows
        .map(toReminder)
        .filter((r) => r.days_of_week.includes(weekday))
        .map((r) => {
          const completed_today = r.last_completed_on === date;
          return { ...r, completed_today, is_due: !completed_today && r.reminder_time <= time };
        });

      for (const r of today.filter((x) => x.is_due)) {
        const existing = await query<{ id: string }>(
          `SELECT id FROM notifications WHERE user_id = $1 AND reminder_id = $2 AND created_at > now() - interval '20 hours' LIMIT 1`,
          [user.id, r.id],
        );
        if (existing.length === 0) {
          await query(
            `INSERT INTO notifications (id, user_id, reminder_id, title, message, notification_type, is_read, created_at, updated_at)
             VALUES (gen_random_uuid(), $1, $2, $3, $4, 'reminder', false, now(), now())`,
            [user.id, r.id, `${TYPE_LABEL[r.reminder_type]}: ${r.title}`, `Scheduled for ${r.reminder_time}. Mark it done once completed.`],
          );
        }
      }
      return c.json({ success: true as const, data: today }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

remindersRoutes.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["reminders"],
    summary: "Create a reminder",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { body: jsonContent(ReminderInputSchema, "New reminder") },
    responses: {
      201: jsonContent(successSchema(ReminderSchema), "Created"),
      400: jsonContent(ErrorResponseSchema, "Validation error"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const body = c.req.valid("json");
      const rows = await query<ReminderRow>(
        `INSERT INTO reminders (id, user_id, title, reminder_type, reminder_time, days_of_week, notes, is_active, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4::time, $5, $6, $7, now(), now())
         RETURNING ${REMINDER_SELECT}`,
        [
          user.id,
          body.title,
          body.reminder_type,
          body.reminder_time,
          body.days_of_week?.join(",") ?? DEFAULT_DAYS,
          body.notes ?? null,
          body.is_active ?? true,
        ],
      );
      return c.json({ success: true as const, data: toReminder(rows[0]) }, 201);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

remindersRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/{id}",
    tags: ["reminders"],
    summary: "Update a reminder",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { params: IdParams, body: jsonContent(ReminderUpdateSchema, "Fields to change") },
    responses: {
      200: jsonContent(successSchema(ReminderSchema), "Updated"),
      400: jsonContent(ErrorResponseSchema, "Validation error"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "Not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const sets: string[] = [];
      const params: unknown[] = [id, user.id];
      const add = (sql: string, value: unknown) => {
        params.push(value);
        sets.push(sql.replace("?", `$${params.length}`));
      };
      if (body.title !== undefined) add("title = ?", body.title);
      if (body.reminder_type !== undefined) add("reminder_type = ?", body.reminder_type);
      if (body.reminder_time !== undefined) add("reminder_time = ?::time", body.reminder_time);
      if (body.days_of_week !== undefined) add("days_of_week = ?", body.days_of_week.join(","));
      if (body.notes !== undefined) add("notes = ?", body.notes);
      if (body.is_active !== undefined) add("is_active = ?", body.is_active);
      const rows = await query<ReminderRow>(
        `UPDATE reminders SET ${[...sets, "updated_at = now()"].join(", ")}
          WHERE id = $1 AND user_id = $2 RETURNING ${REMINDER_SELECT}`,
        params,
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Reminder not found" }, 404);
      return c.json({ success: true as const, data: toReminder(rows[0]) }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

remindersRoutes.openapi(
  createRoute({
    method: "post",
    path: "/{id}/complete",
    tags: ["reminders"],
    summary: "Mark a reminder done (or not done) for a given day",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { params: IdParams, body: jsonContent(CompleteSchema, "Completion") },
    responses: {
      200: jsonContent(successSchema(ReminderSchema), "Updated"),
      400: jsonContent(ErrorResponseSchema, "Validation error"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "Not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const { id } = c.req.valid("param");
      const body = c.req.valid("json");
      const rows = await query<ReminderRow>(
        `UPDATE reminders
            SET last_completed_on = CASE WHEN $3 THEN $4::date
                                         WHEN last_completed_on = $4::date THEN NULL
                                         ELSE last_completed_on END,
                updated_at = now()
          WHERE id = $1 AND user_id = $2 RETURNING ${REMINDER_SELECT}`,
        [id, user.id, body.completed, body.date],
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Reminder not found" }, 404);
      if (body.completed) {
        await query(
          `UPDATE notifications SET is_read = true, updated_at = now()
            WHERE user_id = $1 AND reminder_id = $2 AND is_read = false`,
          [user.id, id],
        );
      }
      return c.json({ success: true as const, data: toReminder(rows[0]) }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

remindersRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["reminders"],
    summary: "Delete a reminder",
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
        `DELETE FROM reminders WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, user.id],
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Reminder not found" }, 404);
      return c.json({ success: true as const, data: { id: rows[0].id } }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);
