-- AUTO-GENERATED from the schema contract for health_records. Rendered deterministically — edit the schema, not this file.

-- @apply
CREATE TABLE IF NOT EXISTS "health_records" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "recorded_at" TIMESTAMPTZ NOT NULL,
  "age" INTEGER,
  "height_cm" NUMERIC(5,1),
  "weight_kg" NUMERIC(5,1),
  "bmi" NUMERIC(4,1),
  "systolic_bp" INTEGER,
  "diastolic_bp" INTEGER,
  "heart_rate" INTEGER,
  "body_temperature_c" NUMERIC(4,1),
  "blood_sugar_mgdl" NUMERIC(5,1),
  "blood_sugar_context" TEXT,
  "sleep_hours" NUMERIC(4,1),
  "water_intake_liters" NUMERIC(4,2),
  "activity_minutes" INTEGER,
  "activity_type" TEXT,
  "wellness_score" INTEGER,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @rollback
DROP TABLE IF EXISTS "health_records" CASCADE;
