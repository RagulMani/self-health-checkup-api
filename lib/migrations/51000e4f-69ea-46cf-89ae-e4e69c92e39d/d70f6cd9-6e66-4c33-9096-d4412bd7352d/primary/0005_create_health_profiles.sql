-- AUTO-GENERATED from the schema contract for health_profiles. Rendered deterministically — edit the schema, not this file.

-- @apply
CREATE TABLE IF NOT EXISTS "health_profiles" (
  "id" UUID PRIMARY KEY,
  "user_id" UUID NOT NULL REFERENCES "users" ("id") ON DELETE CASCADE,
  "date_of_birth" DATE,
  "gender" TEXT,
  "height_cm" NUMERIC(5,1),
  "blood_type" TEXT,
  "phone" TEXT,
  "emergency_contact_name" TEXT,
  "emergency_contact_phone" TEXT,
  "medical_conditions" TEXT,
  "allergies" TEXT,
  "current_medications" TEXT,
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- @rollback
DROP TABLE IF EXISTS "health_profiles" CASCADE;
