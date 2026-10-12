import { z } from "@hono/zod-openapi";

export const ISO = (col: string) => `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;

export const RECORD_SELECT = `
  id,
  ${ISO("recorded_at")} AS recorded_at,
  age,
  height_cm::float8 AS height_cm,
  weight_kg::float8 AS weight_kg,
  bmi::float8 AS bmi,
  systolic_bp,
  diastolic_bp,
  heart_rate,
  body_temperature_c::float8 AS body_temperature_c,
  blood_sugar_mgdl::float8 AS blood_sugar_mgdl,
  blood_sugar_context,
  sleep_hours::float8 AS sleep_hours,
  water_intake_liters::float8 AS water_intake_liters,
  activity_minutes,
  activity_type,
  wellness_score,
  notes,
  ${ISO("created_at")} AS created_at,
  ${ISO("updated_at")} AS updated_at`;

export const HealthRecordSchema = z
  .object({
    id: z.string().uuid(),
    recorded_at: z.string(),
    age: z.number().int().nullable(),
    height_cm: z.number().nullable(),
    weight_kg: z.number().nullable(),
    bmi: z.number().nullable(),
    systolic_bp: z.number().int().nullable(),
    diastolic_bp: z.number().int().nullable(),
    heart_rate: z.number().int().nullable(),
    body_temperature_c: z.number().nullable(),
    blood_sugar_mgdl: z.number().nullable(),
    blood_sugar_context: z.enum(["fasting", "before_meal", "after_meal", "random"]).nullable(),
    sleep_hours: z.number().nullable(),
    water_intake_liters: z.number().nullable(),
    activity_minutes: z.number().int().nullable(),
    activity_type: z.string().nullable(),
    wellness_score: z.number().int().nullable(),
    notes: z.string().nullable(),
    created_at: z.string(),
    updated_at: z.string(),
  })
  .openapi("HealthRecord");

export type HealthRecord = z.infer<typeof HealthRecordSchema>;

export const ScoreComponentSchema = z
  .object({
    metric: z.string(),
    label: z.string(),
    score: z.number(),
    status: z.enum(["good", "caution", "alert"]),
    message: z.string(),
  })
  .openapi("ScoreComponent");

export const HealthAlertSchema = z
  .object({
    metric: z.string(),
    level: z.enum(["caution", "alert"]),
    message: z.string(),
  })
  .openapi("HealthAlert");

export function internalError(err: unknown): string {
  console.error(err);
  return err instanceof Error && err.message.trim() ? err.message : "Something went wrong. Please try again.";
}
