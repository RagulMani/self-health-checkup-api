-- AUTO-GENERATED from the schema contract for reminders. Rendered deterministically — edit the schema, not this file.

-- @apply
CREATE TABLE IF NOT EXISTS "reminders" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "reminder_type" TEXT NOT NULL,
  "reminder_time" TIME NOT NULL,
  "days_of_week" TEXT NOT NULL,
  "notes" TEXT,
  "is_active" BOOLEAN NOT NULL,
  "last_completed_on" DATE,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @rollback
DROP TABLE IF EXISTS "reminders" CASCADE;
