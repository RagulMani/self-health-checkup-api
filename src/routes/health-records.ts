import { createRoute, z } from "@hono/zod-openapi";
import { currentUser, requireUser } from "@/auth/middleware";
import { query } from "@/db";
import { ErrorResponseSchema, createRouter, jsonContent, successSchema } from "@/router";
import { calculateBmi, healthAlerts, scoreComponents, wellnessScore, type HealthMetrics } from "@/lib/health";
import {
  HealthAlertSchema,
  HealthRecordSchema,
  RECORD_SELECT,
  ScoreComponentSchema,
  internalError,
  type HealthRecord,
} from "@/lib/records";

const RecordInputSchema = z
  .object({
    recorded_at: z.string().datetime({ offset: true }).optional(),
    age: z.number().int().min(1).max(120).nullable().optional(),
    height_cm: z.number().min(50).max(272).nullable().optional(),
    weight_kg: z.number().min(2).max(500).nullable().optional(),
    systolic_bp: z.number().int().min(50).max(260).nullable().optional(),
    diastolic_bp: z.number().int().min(30).max(160).nullable().optional(),
    heart_rate: z.number().int().min(20).max(250).nullable().optional(),
    body_temperature_c: z.number().min(30).max(45).nullable().optional(),
    blood_sugar_mgdl: z.number().min(10).max(800).nullable().optional(),
    blood_sugar_context: z.enum(["fasting", "before_meal", "after_meal", "random"]).nullable().optional(),
    sleep_hours: z.number().min(0).max(24).nullable().optional(),
    water_intake_liters: z.number().min(0).max(15).nullable().optional(),
    activity_minutes: z.number().int().min(0).max(1440).nullable().optional(),
    activity_type: z.string().trim().max(100).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .openapi("HealthRecordInput");

type RecordInput = z.infer<typeof RecordInputSchema>;

const RecordWithInsightsSchema = z
  .object({
    record: HealthRecordSchema,
    components: z.array(ScoreComponentSchema),
    alerts: z.array(HealthAlertSchema),
  })
  .openapi("HealthRecordWithInsights");

const IdParams = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
});

const ListQuery = z.object({
  from: z.string().optional().openapi({ param: { name: "from", in: "query" }, example: "2026-01-01" }),
  to: z.string().optional().openapi({ param: { name: "to", in: "query" }, example: "2026-12-31" }),
  limit: z.coerce.number().int().min(1).max(500).optional().openapi({ param: { name: "limit", in: "query" } }),
  offset: z.coerce.number().int().min(0).optional().openapi({ param: { name: "offset", in: "query" } }),
});

const FIELDS = [
  "age",
  "height_cm",
  "weight_kg",
  "systolic_bp",
  "diastolic_bp",
  "heart_rate",
  "body_temperature_c",
  "blood_sugar_mgdl",
  "blood_sugar_context",
  "sleep_hours",
  "water_intake_liters",
  "activity_minutes",
  "activity_type",
  "notes",
] as const;

type Merged = { [K in (typeof FIELDS)[number]]: RecordInput[K] | null };

function toMetrics(r: Merged): HealthMetrics {
  return {
    height_cm: r.height_cm ?? null,
    weight_kg: r.weight_kg ?? null,
    systolic_bp: r.systolic_bp ?? null,
    diastolic_bp: r.diastolic_bp ?? null,
    heart_rate: r.heart_rate ?? null,
    body_temperature_c: r.body_temperature_c ?? null,
    blood_sugar_mgdl: r.blood_sugar_mgdl ?? null,
    blood_sugar_context: r.blood_sugar_context ?? null,
    sleep_hours: r.sleep_hours ?? null,
    water_intake_liters: r.water_intake_liters ?? null,
    activity_minutes: r.activity_minutes ?? null,
  };
}

export function recordInsights(record: HealthRecord) {
  const metrics = toMetrics(record as unknown as Merged);
  return { record, components: scoreComponents(metrics), alerts: healthAlerts(metrics) };
}

async function profileDefaults(userId: string): Promise<{ height_cm: number | null; age: number | null }> {
  const rows = await query<{ height_cm: number | null; age: number | null }>(
    `SELECT height_cm::float8 AS height_cm,
            CASE WHEN date_of_birth IS NULL THEN NULL
                 ELSE EXTRACT(YEAR FROM age(current_date, date_of_birth))::int END AS age
       FROM health_profiles WHERE user_id = $1 LIMIT 1`,
    [userId],
  );
  return rows[0] ?? { height_cm: null, age: null };
}

async function notifyAlerts(userId: string, metrics: HealthMetrics) {
  const alerts = healthAlerts(metrics).filter((a) => a.level === "alert");
  for (const alert of alerts) {
    await query(
      `INSERT INTO notifications (id, user_id, title, message, notification_type, is_read, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, 'health_alert', false, now(), now())`,
      [userId, "Health reading needs attention", alert.message],
    );
  }
}

export const healthRecordsRoutes = createRouter();

healthRecordsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["health-records"],
    summary: "List the caller's health check-ins, newest first",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { query: ListQuery },
    responses: {
      200: jsonContent(
        z.object({ success: z.literal(true), data: z.array(HealthRecordSchema), total: z.number().int() }),
        "Health records",
      ),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const q = c.req.valid("query");
      const params: unknown[] = [user.id];
      let where = "user_id = $1";
      if (q.from) {
        params.push(q.from);
        where += ` AND recorded_at >= $${params.length}::timestamptz`;
      }
      if (q.to) {
        params.push(q.to);
        where += ` AND recorded_at < ($${params.length}::date + 1)`;
      }
      const countRows = await query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM health_records WHERE ${where}`,
        params,
      );
      params.push(q.limit ?? 100, q.offset ?? 0);
      const rows = await query<HealthRecord>(
        `SELECT ${RECORD_SELECT} FROM health_records WHERE ${where}
          ORDER BY recorded_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return c.json({ success: true as const, data: rows, total: countRows[0]?.total ?? 0 }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

healthRecordsRoutes.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["health-records"],
    summary: "Log a health check-in; BMI and wellness score are calculated automatically",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { body: jsonContent(RecordInputSchema, "Health check-in") },
    responses: {
      201: jsonContent(successSchema(RecordWithInsightsSchema), "Created"),
      400: jsonContent(ErrorResponseSchema, "Validation error"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const body = c.req.valid("json");
      const hasMetric = FIELDS.some((f) => f !== "notes" && f !== "age" && body[f] !== undefined && body[f] !== null);
      if (!hasMetric) {
        return c.json({ success: false as const, error: "Enter at least one health measurement." }, 400);
      }
      const defaults = await profileDefaults(user.id);
      const merged = {} as Merged;
      for (const f of FIELDS) (merged as Record<string, unknown>)[f] = body[f] ?? null;
      merged.height_cm = merged.height_cm ?? defaults.height_cm;
      merged.age = merged.age ?? defaults.age;
      const metrics = toMetrics(merged);
      const bmi = calculateBmi(metrics.height_cm, metrics.weight_kg);
      const score = wellnessScore(metrics);

      const rows = await query<HealthRecord>(
        `INSERT INTO health_records (
           id, user_id, recorded_at, age, height_cm, weight_kg, bmi, systolic_bp, diastolic_bp, heart_rate,
           body_temperature_c, blood_sugar_mgdl, blood_sugar_context, sleep_hours, water_intake_liters,
           activity_minutes, activity_type, wellness_score, notes, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, COALESCE($2::timestamptz, now()), $3, $4, $5, $6, $7, $8, $9,
           $10, $11, $12, $13, $14, $15, $16, $17, $18, now(), now())
         RETURNING ${RECORD_SELECT}`,
        [
          user.id,
          body.recorded_at ?? null,
          merged.age,
          merged.height_cm,
          merged.weight_kg,
          bmi,
          merged.systolic_bp,
          merged.diastolic_bp,
          merged.heart_rate,
          merged.body_temperature_c,
          merged.blood_sugar_mgdl,
          merged.blood_sugar_context,
          merged.sleep_hours,
          merged.water_intake_liters,
          merged.activity_minutes,
          merged.activity_type,
          score,
          merged.notes,
        ],
      );
      await notifyAlerts(user.id, metrics);
      return c.json({ success: true as const, data: recordInsights(rows[0]) }, 201);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

healthRecordsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    tags: ["health-records"],
    summary: "Get one health check-in with its score breakdown",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { params: IdParams },
    responses: {
      200: jsonContent(successSchema(RecordWithInsightsSchema), "Health record"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "Not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const { id } = c.req.valid("param");
      const rows = await query<HealthRecord>(
        `SELECT ${RECORD_SELECT} FROM health_records WHERE id = $1 AND user_id = $2`,
        [id, user.id],
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Health record not found" }, 404);
      return c.json({ success: true as const, data: recordInsights(rows[0]) }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

healthRecordsRoutes.openapi(
  createRoute({
    method: "patch",
    path: "/{id}",
    tags: ["health-records"],
    summary: "Update a health check-in; BMI and wellness score are recalculated",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { params: IdParams, body: jsonContent(RecordInputSchema, "Fields to change") },
    responses: {
      200: jsonContent(successSchema(RecordWithInsightsSchema), "Updated"),
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
      const existing = await query<HealthRecord>(
        `SELECT ${RECORD_SELECT} FROM health_records WHERE id = $1 AND user_id = $2`,
        [id, user.id],
      );
      if (existing.length === 0) return c.json({ success: false as const, error: "Health record not found" }, 404);
      const merged = {} as Merged;
      for (const f of FIELDS) {
        (merged as Record<string, unknown>)[f] = body[f] !== undefined ? body[f] : existing[0][f];
      }
      const metrics = toMetrics(merged);
      const rows = await query<HealthRecord>(
        `UPDATE health_records SET
           recorded_at = COALESCE($3::timestamptz, recorded_at), age = $4, height_cm = $5, weight_kg = $6, bmi = $7,
           systolic_bp = $8, diastolic_bp = $9, heart_rate = $10, body_temperature_c = $11, blood_sugar_mgdl = $12,
           blood_sugar_context = $13, sleep_hours = $14, water_intake_liters = $15, activity_minutes = $16,
           activity_type = $17, wellness_score = $18, notes = $19, updated_at = now()
         WHERE id = $1 AND user_id = $2
         RETURNING ${RECORD_SELECT}`,
        [
          id,
          user.id,
          body.recorded_at ?? null,
          merged.age,
          merged.height_cm,
          merged.weight_kg,
          calculateBmi(metrics.height_cm, metrics.weight_kg),
          merged.systolic_bp,
          merged.diastolic_bp,
          merged.heart_rate,
          merged.body_temperature_c,
          merged.blood_sugar_mgdl,
          merged.blood_sugar_context,
          merged.sleep_hours,
          merged.water_intake_liters,
          merged.activity_minutes,
          merged.activity_type,
          wellnessScore(metrics),
          merged.notes,
        ],
      );
      return c.json({ success: true as const, data: recordInsights(rows[0]) }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

healthRecordsRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["health-records"],
    summary: "Delete a health check-in",
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
        `DELETE FROM health_records WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, user.id],
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Health record not found" }, 404);
      return c.json({ success: true as const, data: { id: rows[0].id } }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);
