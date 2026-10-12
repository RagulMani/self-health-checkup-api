import { z } from "@hono/zod-openapi";
import { query } from "@/db";
import {
  bmiCategory,
  calculateBmi,
  healthAlerts,
  scoreComponents,
  wellnessLabel,
  wellnessScore,
  type HealthMetrics,
} from "./health";
import { HealthAlertSchema, RECORD_SELECT, ScoreComponentSchema, type HealthRecord } from "./records";

export const TrendPointSchema = z
  .object({
    date: z.string(),
    weight_kg: z.number().nullable(),
    bmi: z.number().nullable(),
    systolic_bp: z.number().nullable(),
    diastolic_bp: z.number().nullable(),
    heart_rate: z.number().nullable(),
    body_temperature_c: z.number().nullable(),
    blood_sugar_mgdl: z.number().nullable(),
    sleep_hours: z.number().nullable(),
    water_intake_liters: z.number().nullable(),
    activity_minutes: z.number().nullable(),
    wellness_score: z.number().nullable(),
  })
  .openapi("TrendPoint");

export type TrendPoint = z.infer<typeof TrendPointSchema>;

export const AveragesSchema = TrendPointSchema.omit({ date: true })
  .extend({ record_count: z.number().int() })
  .openapi("MetricAverages");

export type Averages = z.infer<typeof AveragesSchema>;

export const SnapshotSchema = z
  .object({
    as_of: z.string().nullable(),
    metrics: z.object({
      height_cm: z.number().nullable(),
      weight_kg: z.number().nullable(),
      systolic_bp: z.number().nullable(),
      diastolic_bp: z.number().nullable(),
      heart_rate: z.number().nullable(),
      body_temperature_c: z.number().nullable(),
      blood_sugar_mgdl: z.number().nullable(),
      blood_sugar_context: z.string().nullable(),
      sleep_hours: z.number().nullable(),
      water_intake_liters: z.number().nullable(),
      activity_minutes: z.number().nullable(),
    }),
    bmi: z.number().nullable(),
    bmi_category: z.string().nullable(),
    wellness_score: z.number().nullable(),
    wellness_label: z.string().nullable(),
    components: z.array(ScoreComponentSchema),
    alerts: z.array(HealthAlertSchema),
  })
  .openapi("HealthSnapshot");

export type Snapshot = z.infer<typeof SnapshotSchema>;

const AVG = (col: string) => `ROUND(AVG(${col})::numeric, 1)::float8 AS ${col}`;
const AVG_COLUMNS = [
  "weight_kg",
  "bmi",
  "systolic_bp",
  "diastolic_bp",
  "heart_rate",
  "body_temperature_c",
  "blood_sugar_mgdl",
  "sleep_hours",
  "water_intake_liters",
  "activity_minutes",
  "wellness_score",
]
  .map(AVG)
  .join(", ");

export async function dailyTrend(userId: string, days: number): Promise<TrendPoint[]> {
  return query<TrendPoint>(
    `SELECT to_char(date_trunc('day', recorded_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS date, ${AVG_COLUMNS}
       FROM health_records
      WHERE user_id = $1 AND recorded_at >= now() - make_interval(days => $2::int)
      GROUP BY 1 ORDER BY 1 ASC`,
    [userId, days],
  );
}

export async function averages(userId: string, days: number): Promise<Averages> {
  const rows = await query<Averages>(
    `SELECT ${AVG_COLUMNS}, COUNT(*)::int AS record_count
       FROM health_records
      WHERE user_id = $1 AND recorded_at >= now() - make_interval(days => $2::int)`,
    [userId, days],
  );
  return rows[0];
}

/**
 * Combine the most recent non-empty value of each metric from the last 24
 * hours (weight/height fall back to the latest ever) into today's snapshot.
 */
export async function currentSnapshot(userId: string): Promise<Snapshot> {
  const recent = await query<HealthRecord>(
    `SELECT ${RECORD_SELECT} FROM health_records
      WHERE user_id = $1 AND recorded_at >= now() - interval '24 hours'
      ORDER BY recorded_at DESC LIMIT 50`,
    [userId],
  );
  const latestBody = await query<{ height_cm: number | null; weight_kg: number | null }>(
    `SELECT height_cm::float8 AS height_cm, weight_kg::float8 AS weight_kg FROM health_records
      WHERE user_id = $1 AND weight_kg IS NOT NULL ORDER BY recorded_at DESC LIMIT 1`,
    [userId],
  );
  const pick = <K extends keyof HealthMetrics>(key: K): HealthMetrics[K] => {
    for (const r of recent) {
      const v = (r as unknown as HealthMetrics)[key];
      if (v !== null && v !== undefined) return v;
    }
    return null as HealthMetrics[K];
  };
  const metrics: HealthMetrics = {
    height_cm: pick("height_cm") ?? latestBody[0]?.height_cm ?? null,
    weight_kg: pick("weight_kg") ?? latestBody[0]?.weight_kg ?? null,
    systolic_bp: pick("systolic_bp"),
    diastolic_bp: pick("diastolic_bp"),
    heart_rate: pick("heart_rate"),
    body_temperature_c: pick("body_temperature_c"),
    blood_sugar_mgdl: pick("blood_sugar_mgdl"),
    blood_sugar_context: pick("blood_sugar_context"),
    sleep_hours: pick("sleep_hours"),
    water_intake_liters: pick("water_intake_liters"),
    activity_minutes: pick("activity_minutes"),
  };
  if (recent.length === 0) {
    metrics.systolic_bp = null;
    metrics.diastolic_bp = null;
  }
  const bmi = calculateBmi(metrics.height_cm, metrics.weight_kg);
  const score = recent.length > 0 ? wellnessScore(metrics) : null;
  return {
    as_of: recent[0]?.recorded_at ?? null,
    metrics,
    bmi,
    bmi_category: bmiCategory(bmi),
    wellness_score: score,
    wellness_label: wellnessLabel(score),
    components: recent.length > 0 ? scoreComponents(metrics) : [],
    alerts: recent.length > 0 ? healthAlerts(metrics) : [],
  };
}

export async function streakDays(userId: string): Promise<number> {
  const rows = await query<{ day: string }>(
    `SELECT DISTINCT to_char(date_trunc('day', recorded_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day
       FROM health_records WHERE user_id = $1 AND recorded_at >= now() - interval '400 days'
      ORDER BY day DESC`,
    [userId],
  );
  const days = new Set(rows.map((r) => r.day));
  const cursor = new Date();
  const key = (d: Date) => d.toISOString().slice(0, 10);
  if (!days.has(key(cursor))) cursor.setUTCDate(cursor.getUTCDate() - 1);
  let streak = 0;
  while (days.has(key(cursor))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return streak;
}

export function insightsFrom(avg: Averages): string[] {
  const out: string[] = [];
  if (avg.record_count === 0) return ["No health check-ins were recorded in this period."];
  if (avg.sleep_hours !== null) {
    out.push(
      avg.sleep_hours < 7
        ? `Average sleep was ${avg.sleep_hours} h — below the recommended 7–9 hours.`
        : `Average sleep was ${avg.sleep_hours} h, within or above the recommended range.`,
    );
  }
  if (avg.water_intake_liters !== null) {
    out.push(
      avg.water_intake_liters < 2
        ? `Average water intake was ${avg.water_intake_liters} L — consider drinking more fluids.`
        : `Average water intake was ${avg.water_intake_liters} L per check-in.`,
    );
  }
  if (avg.activity_minutes !== null) {
    out.push(
      avg.activity_minutes < 30
        ? `Average activity was ${avg.activity_minutes} min — aim for at least 30 minutes most days.`
        : `Average activity was ${avg.activity_minutes} min, meeting the 30-minute daily goal.`,
    );
  }
  if (avg.systolic_bp !== null && avg.diastolic_bp !== null && (avg.systolic_bp >= 130 || avg.diastolic_bp >= 80)) {
    out.push(`Average blood pressure was ${avg.systolic_bp}/${avg.diastolic_bp} mmHg — discuss elevated readings with a doctor.`);
  }
  if (avg.bmi !== null) out.push(`Average BMI was ${avg.bmi} (${bmiCategory(avg.bmi)}).`);
  if (avg.wellness_score !== null) {
    out.push(`Average wellness score was ${avg.wellness_score} / 100 (${wellnessLabel(Math.round(avg.wellness_score))}).`);
  }
  return out;
}
