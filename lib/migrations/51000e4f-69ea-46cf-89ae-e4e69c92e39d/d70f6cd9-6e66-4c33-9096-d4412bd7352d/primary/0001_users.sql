-- AUTO-GENERATED — platform-managed NextAuth adapter table (users).
-- Provisioned at app↔database mapping creation. Do not edit by hand:
-- the platform regenerates these on mapping changes and your edits will
-- be lost. App-specific extensions to `users` go through the schema
-- proposal flow as a `modified` delta, not by editing this file.

-- @apply
CREATE TABLE IF NOT EXISTS "users" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" TEXT,
  "email" TEXT UNIQUE,
  "emailVerified" TIMESTAMPTZ,
  "image" TEXT,
  "password_hash" TEXT,
  "role" TEXT NOT NULL DEFAULT 'user',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_users_email" ON "users" ("email");

-- @rollback
DROP TABLE IF EXISTS "users" CASCADE;
