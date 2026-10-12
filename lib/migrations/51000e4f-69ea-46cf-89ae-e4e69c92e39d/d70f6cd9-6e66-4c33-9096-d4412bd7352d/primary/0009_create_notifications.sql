-- AUTO-GENERATED from the schema contract for notifications. Rendered deterministically — edit the schema, not this file.

-- @apply
CREATE TABLE IF NOT EXISTS "notifications" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "reminder_id" UUID REFERENCES "reminders" ("id") ON DELETE SET NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "notification_type" TEXT NOT NULL,
  "is_read" BOOLEAN NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @rollback
DROP TABLE IF EXISTS "notifications" CASCADE;
