import { createRoute, z } from "@hono/zod-openapi";
import { currentUser, requireUser } from "@/auth/middleware";
import { query } from "@/db";
import { ErrorResponseSchema, createRouter, jsonContent, successSchema } from "@/router";
import { MEDICAL_DISCLAIMER } from "@/lib/health";
import { HealthRecordSchema, RECORD_SELECT, internalError, type HealthRecord } from "@/lib/records";
import {
  AveragesSchema,
  SnapshotSchema,
  TrendPointSchema,
  averages,
  currentSnapshot,
  dailyTrend,
  streakDays,
} from "@/lib/summary";

const DashboardSchema = z
  .object({
    snapshot: SnapshotSchema,
    latest_record: HealthRecordSchema.nullable(),
    averages_7d: AveragesSchema,
    trend: z.array(TrendPointSchema),
    total_records: z.number().int(),
    streak_days: z.number().int(),
    unread_notifications: z.number().int(),
    disclaimer: z.string(),
  })
  .openapi("Dashboard");

const DashboardQuery = z.object({
  days: z.coerce.number().int().min(7).max(365).optional().openapi({ param: { name: "days", in: "query" }, example: 30 }),
});

export const dashboardRoutes = createRouter();

dashboardRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["dashboard"],
    summary: "Dashboard: today's wellness snapshot, BMI, alerts, 7-day averages and daily trend",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { query: DashboardQuery },
    responses: {
      200: jsonContent(successSchema(DashboardSchema), "Dashboard"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const days = c.req.valid("query").days ?? 30;
      const [snapshot, latest, avg7, trend, totals, streak, unread] = await Promise.all([
        currentSnapshot(user.id),
        query<HealthRecord>(
          `SELECT ${RECORD_SELECT} FROM health_records WHERE user_id = $1 ORDER BY recorded_at DESC LIMIT 1`,
          [user.id],
        ),
        averages(user.id, 7),
        dailyTrend(user.id, days),
        query<{ total: number }>(`SELECT COUNT(*)::int AS total FROM health_records WHERE user_id = $1`, [user.id]),
        streakDays(user.id),
        query<{ unread: number }>(
          `SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND is_read = false`,
          [user.id],
        ),
      ]);
      return c.json(
        {
          success: true as const,
          data: {
            snapshot,
            latest_record: latest[0] ?? null,
            averages_7d: avg7,
            trend,
            total_records: totals[0]?.total ?? 0,
            streak_days: streak,
            unread_notifications: unread[0]?.unread ?? 0,
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
