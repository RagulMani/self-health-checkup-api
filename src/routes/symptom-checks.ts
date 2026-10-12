import { createRoute, z } from "@hono/zod-openapi";
import { currentUser, requireUser } from "@/auth/middleware";
import { query } from "@/db";
import { ErrorResponseSchema, createRouter, jsonContent, successSchema } from "@/router";
import { ISO, internalError } from "@/lib/records";
import {
  DURATIONS,
  SEVERITIES,
  SYMPTOM_CATALOG,
  URGENCY_LEVELS,
  evaluateSymptoms,
  findSymptom,
  type SymptomGuidance,
} from "@/lib/symptoms";

const SymptomDefinitionSchema = z
  .object({
    id: z.string(),
    label: z.string(),
    category: z.string(),
    red_flag: z.boolean(),
  })
  .openapi("SymptomDefinition");

const GuidanceSchema = z
  .object({
    urgency_level: z.enum(URGENCY_LEVELS),
    headline: z.string(),
    summary: z.string(),
    recommendations: z.array(z.string()),
    self_care_tips: z.array(z.string()),
    see_doctor_if: z.array(z.string()),
    red_flags_detected: z.array(z.string()),
    related_areas: z.array(z.string()),
    disclaimer: z.string(),
  })
  .openapi("SymptomGuidance");

const SelectedSymptomSchema = z.object({ id: z.string(), label: z.string() });

const SymptomCheckSchema = z
  .object({
    id: z.string().uuid(),
    symptoms: z.array(SelectedSymptomSchema),
    duration: z.enum(DURATIONS),
    severity: z.enum(SEVERITIES),
    urgency_level: z.enum(URGENCY_LEVELS),
    guidance: GuidanceSchema,
    notes: z.string().nullable(),
    created_at: z.string(),
  })
  .openapi("SymptomCheck");

type SymptomCheck = z.infer<typeof SymptomCheckSchema>;

const CreateCheckSchema = z
  .object({
    symptoms: z.array(z.string()).min(1, "Select at least one symptom").max(20),
    duration: z.enum(DURATIONS),
    severity: z.enum(SEVERITIES),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .openapi("SymptomCheckInput");

const IdParams = z.object({
  id: z.string().uuid().openapi({ param: { name: "id", in: "path" } }),
});

const CHECK_SELECT = `id, symptoms, duration, severity, urgency_level, guidance, notes, ${ISO("created_at")} AS created_at`;

export const symptomChecksRoutes = createRouter();

symptomChecksRoutes.openapi(
  createRoute({
    method: "get",
    path: "/catalog",
    tags: ["symptom-checks"],
    summary: "List the symptoms users can choose from, grouped by category",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    responses: {
      200: jsonContent(successSchema(z.array(SymptomDefinitionSchema)), "Symptom catalog"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
    },
  }),
  (c) =>
    c.json(
      {
        success: true as const,
        data: SYMPTOM_CATALOG.map((s) => ({ id: s.id, label: s.label, category: s.category, red_flag: s.red_flag })),
      },
      200,
    ),
);

symptomChecksRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["symptom-checks"],
    summary: "List the caller's past symptom checks",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    responses: {
      200: jsonContent(successSchema(z.array(SymptomCheckSchema)), "Symptom checks"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const rows = await query<SymptomCheck>(
        `SELECT ${CHECK_SELECT} FROM symptom_checks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [user.id],
      );
      return c.json({ success: true as const, data: rows }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

symptomChecksRoutes.openapi(
  createRoute({
    method: "post",
    path: "/",
    tags: ["symptom-checks"],
    summary: "Evaluate selected symptoms and save the guidance to the caller's history",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { body: jsonContent(CreateCheckSchema, "Selected symptoms") },
    responses: {
      201: jsonContent(successSchema(SymptomCheckSchema), "Guidance"),
      400: jsonContent(ErrorResponseSchema, "Validation error"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const body = c.req.valid("json");
      const unknown = body.symptoms.filter((id) => !findSymptom(id));
      if (unknown.length > 0) {
        return c.json({ success: false as const, error: `Unknown symptom(s): ${unknown.join(", ")}` }, 400);
      }
      const ids = Array.from(new Set(body.symptoms));
      const guidance: SymptomGuidance = evaluateSymptoms(ids, body.duration, body.severity);
      const symptoms = ids.map((id) => ({ id, label: findSymptom(id)?.label ?? id }));
      const rows = await query<SymptomCheck>(
        `INSERT INTO symptom_checks (id, user_id, symptoms, duration, severity, urgency_level, guidance, notes, created_at, updated_at)
         VALUES (gen_random_uuid(), $1, $2::jsonb, $3, $4, $5, $6::jsonb, $7, now(), now())
         RETURNING ${CHECK_SELECT}`,
        [
          user.id,
          JSON.stringify(symptoms),
          body.duration,
          body.severity,
          guidance.urgency_level,
          JSON.stringify(guidance),
          body.notes ?? null,
        ],
      );
      if (guidance.urgency_level === "emergency" || guidance.urgency_level === "urgent_care") {
        await query(
          `INSERT INTO notifications (id, user_id, title, message, notification_type, is_read, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, $2, $3, 'health_alert', false, now(), now())`,
          [user.id, guidance.headline, guidance.summary],
        );
      }
      return c.json({ success: true as const, data: rows[0] }, 201);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

symptomChecksRoutes.openapi(
  createRoute({
    method: "get",
    path: "/{id}",
    tags: ["symptom-checks"],
    summary: "Get one saved symptom check",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { params: IdParams },
    responses: {
      200: jsonContent(successSchema(SymptomCheckSchema), "Symptom check"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "Not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const { id } = c.req.valid("param");
      const rows = await query<SymptomCheck>(
        `SELECT ${CHECK_SELECT} FROM symptom_checks WHERE id = $1 AND user_id = $2`,
        [id, user.id],
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Symptom check not found" }, 404);
      return c.json({ success: true as const, data: rows[0] }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

symptomChecksRoutes.openapi(
  createRoute({
    method: "delete",
    path: "/{id}",
    tags: ["symptom-checks"],
    summary: "Delete a saved symptom check",
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
        `DELETE FROM symptom_checks WHERE id = $1 AND user_id = $2 RETURNING id`,
        [id, user.id],
      );
      if (rows.length === 0) return c.json({ success: false as const, error: "Symptom check not found" }, 404);
      return c.json({ success: true as const, data: { id: rows[0].id } }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);
