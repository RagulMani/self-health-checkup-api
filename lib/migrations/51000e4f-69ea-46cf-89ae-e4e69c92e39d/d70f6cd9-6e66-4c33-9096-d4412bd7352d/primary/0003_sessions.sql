-- AUTO-GENERATED — platform-managed NextAuth adapter table (sessions).
-- Provisioned at app↔database mapping creation. Do not edit by hand:
-- the platform regenerates these on mapping changes and your edits will
-- be lost. App-specific extensions to `sessions` go through the schema
-- proposal flow as a `modified` delta, not by editing this file.

-- @apply
CREATE TABLE IF NOT EXISTS "sessions" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionToken" TEXT UNIQUE NOT NULL,
  "userId" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "expires" TIMESTAMPTZ NOT NULL,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_sessions_user_id" ON "sessions" ("userId");

-- @rollback
DROP TABLE IF EXISTS "sessions" CASCADE;
