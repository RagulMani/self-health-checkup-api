import { createRoute, z } from "@hono/zod-openapi";
import { currentUser, requireUser } from "@/auth/middleware";
import { query } from "@/db";
import { ErrorResponseSchema, createRouter, jsonContent, successSchema } from "@/router";
import { MEDICAL_DISCLAIMER } from "@/lib/health";
import { HealthRecordSchema, ISO, RECORD_SELECT, internalError, type HealthRecord } from "@/lib/records";
import {
  AveragesSchema,
  SnapshotSchema,
  TrendPointSchema,
  averages,
  currentSnapshot,
  dailyTrend,
  insightsFrom,
} from "@/lib/summary";
import { loadProfile } from "./profile";

const ReportSymptomCheckSchema = z.object({
  id: z.string().uuid(),
  symptoms: z.array(z.object({ id: z.string(), label: z.string() })),
  duration: z.string(),
  severity: z.string(),
  urgency_level: z.string(),
  created_at: z.string(),
});

const HealthReportSchema = z
  .object({
    generated_at: z.string(),
    period: z.object({ from: z.string(), to: z.string(), days: z.number().int() }),
    user: z.object({ name: z.string().nullable(), email: z.string().nullable() }),
    profile: z.object({
      age: z.number().int().nullable(),
      gender: z.string().nullable(),
      height_cm: z.number().nullable(),
      blood_type: z.string().nullable(),
      medical_conditions: z.string().nullable(),
      allergies: z.string().nullable(),
      current_medications: z.string().nullable(),
      emergency_contact_name: z.string().nullable(),
      emergency_contact_phone: z.string().nullable(),
    }),
    snapshot: SnapshotSchema,
    averages: AveragesSchema,
    trend: z.array(TrendPointSchema),
    records: z.array(HealthRecordSchema),
    symptom_checks: z.array(ReportSymptomCheckSchema),
    insights: z.array(z.string()),
    disclaimer: z.string(),
  })
  .openapi("HealthReport");

const ReportQuery = z.object({
  days: z.coerce.number().int().min(1).max(365).optional().openapi({ param: { name: "days", in: "query" }, example: 30 }),
});

export const reportsRoutes = createRouter();

reportsRoutes.openapi(
  createRoute({
    method: "get",
    path: "/health",
    tags: ["reports"],
    summary: "Personal health report data for a period (rendered to PDF by the client)",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { query: ReportQuery },
    responses: {
      200: jsonContent(successSchema(HealthReportSchema), "Health report"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "User not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const days = c.req.valid("query").days ?? 30;
      const profile = await loadProfile(user.id);
      if (!profile) return c.json({ success: false as const, error: "User not found" }, 404);
      const [snapshot, avg, trend, records, checks] = await Promise.all([
        currentSnapshot(user.id),
        averages(user.id, days),
        dailyTrend(user.id, days),
        query<HealthRecord>(
          `SELECT ${RECORD_SELECT} FROM health_records
            WHERE user_id = $1 AND recorded_at >= now() - make_interval(days => $2::int)
            ORDER BY recorded_at DESC LIMIT 100`,
          [user.id, days],
        ),
        query<z.infer<typeof ReportSymptomCheckSchema>>(
          `SELECT id, symptoms, duration, severity, urgency_level, ${ISO("created_at")} AS created_at
             FROM symptom_checks
            WHERE user_id = $1 AND created_at >= now() - make_interval(days => $2::int)
            ORDER BY created_at DESC LIMIT 10`,
          [user.id, days],
        ),
      ]);
      const to = new Date();
      const from = new Date(to.getTime() - days * 24 * 60 * 60 * 1000);
      const p = profile.profile;
      return c.json(
        {
          success: true as const,
          data: {
            generated_at: to.toISOString(),
            period: { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10), days },
            user: { name: profile.user.name, email: profile.user.email },
            profile: {
              age: p.age,
              gender: p.gender,
              height_cm: p.height_cm,
              blood_type: p.blood_type,
              medical_conditions: p.medical_conditions,
              allergies: p.allergies,
              current_medications: p.current_medications,
              emergency_contact_name: p.emergency_contact_name,
              emergency_contact_phone: p.emergency_contact_phone,
            },
            snapshot,
            averages: avg,
            trend,
            records,
            symptom_checks: checks,
            insights: insightsFrom(avg),
            disclaimer: MEDICAL_DISCLAIMER,
          },
        },
        200,
      );
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);
