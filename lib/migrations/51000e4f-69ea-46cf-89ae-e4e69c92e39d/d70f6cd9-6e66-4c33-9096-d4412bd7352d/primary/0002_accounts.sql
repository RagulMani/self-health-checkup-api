-- AUTO-GENERATED — platform-managed NextAuth adapter table (accounts).
-- Provisioned at app↔database mapping creation. Do not edit by hand:
-- the platform regenerates these on mapping changes and your edits will
-- be lost. App-specific extensions to `accounts` go through the schema
-- proposal flow as a `modified` delta, not by editing this file.

-- @apply
CREATE TABLE IF NOT EXISTS "accounts" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "type" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  "refresh_token" TEXT,
  "access_token" TEXT,
  "expires_at" BIGINT,
  "id_token" TEXT,
  "scope" TEXT,
  "session_state" TEXT,
  "token_type" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "uq_accounts_provider_account" ON "accounts" ("provider", "providerAccountId");

CREATE INDEX IF NOT EXISTS "idx_accounts_user_id" ON "accounts" ("userId");

-- @rollback
DROP TABLE IF EXISTS "accounts" CASCADE;
