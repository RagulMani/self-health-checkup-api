-- AUTO-GENERATED from the schema contract for symptom_checks. Rendered deterministically — edit the schema, not this file.

-- @apply
CREATE TABLE IF NOT EXISTS "symptom_checks" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "symptoms" JSONB NOT NULL,
  "duration" TEXT NOT NULL,
  "severity" TEXT NOT NULL,
  "urgency_level" TEXT NOT NULL,
  "guidance" JSONB NOT NULL,
  "notes" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @rollback
DROP TABLE IF EXISTS "symptom_checks" CASCADE;
