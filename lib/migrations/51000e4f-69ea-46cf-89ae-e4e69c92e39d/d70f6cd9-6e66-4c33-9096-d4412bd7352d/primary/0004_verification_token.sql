-- AUTO-GENERATED — platform-managed NextAuth adapter table (verification_token).
-- Provisioned at app↔database mapping creation. Do not edit by hand:
-- the platform regenerates these on mapping changes and your edits will
-- be lost. App-specific extensions to `verification_token` go through the schema
-- proposal flow as a `modified` delta, not by editing this file.

-- @apply
CREATE TABLE IF NOT EXISTS "verification_token" (
  "identifier" TEXT NOT NULL,
  "token" TEXT NOT NULL,
  "expires" TIMESTAMPTZ NOT NULL,
  PRIMARY KEY ("identifier", "token")
);

-- @rollback
DROP TABLE IF EXISTS "verification_token" CASCADE;
