import { createRoute, z } from "@hono/zod-openapi";
import { currentUser, requireUser } from "@/auth/middleware";
import { query } from "@/db";
import { ErrorResponseSchema, createRouter, jsonContent, successSchema } from "@/router";
import { ISO, internalError } from "@/lib/records";

const GENDERS = ["male", "female", "other", "prefer_not_to_say"] as const;

const HealthProfileSchema = z
  .object({
    date_of_birth: z.string().nullable(),
    age: z.number().int().nullable(),
    gender: z.enum(GENDERS).nullable(),
    height_cm: z.number().nullable(),
    blood_type: z.string().nullable(),
    phone: z.string().nullable(),
    emergency_contact_name: z.string().nullable(),
    emergency_contact_phone: z.string().nullable(),
    medical_conditions: z.string().nullable(),
    allergies: z.string().nullable(),
    current_medications: z.string().nullable(),
    updated_at: z.string().nullable(),
  })
  .openapi("HealthProfile");

const ProfileResponseSchema = z
  .object({
    user: z.object({
      id: z.string().uuid(),
      name: z.string().nullable(),
      email: z.string().nullable(),
      created_at: z.string(),
    }),
    profile: HealthProfileSchema,
  })
  .openapi("Profile");

const optText = (max: number) => z.string().trim().max(max).nullable().optional();

const ProfileUpdateSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    date_of_birth: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
      .nullable()
      .optional(),
    gender: z.enum(GENDERS).nullable().optional(),
    height_cm: z.number().min(50).max(272).nullable().optional(),
    blood_type: z.enum(["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-", "unknown"]).nullable().optional(),
    phone: optText(40),
    emergency_contact_name: optText(120),
    emergency_contact_phone: optText(40),
    medical_conditions: optText(2000),
    allergies: optText(2000),
    current_medications: optText(2000),
  })
  .openapi("ProfileUpdate");

const PROFILE_FIELDS = [
  "date_of_birth",
  "gender",
  "height_cm",
  "blood_type",
  "phone",
  "emergency_contact_name",
  "emergency_contact_phone",
  "medical_conditions",
  "allergies",
  "current_medications",
] as const;

const EMPTY_PROFILE: z.infer<typeof HealthProfileSchema> = {
  date_of_birth: null,
  age: null,
  gender: null,
  height_cm: null,
  blood_type: null,
  phone: null,
  emergency_contact_name: null,
  emergency_contact_phone: null,
  medical_conditions: null,
  allergies: null,
  current_medications: null,
  updated_at: null,
};

export async function loadProfile(userId: string): Promise<z.infer<typeof ProfileResponseSchema> | null> {
  const users = await query<{ id: string; name: string | null; email: string | null; created_at: string }>(
    `SELECT id, name, email, ${ISO("created_at")} AS created_at FROM users WHERE id = $1`,
    [userId],
  );
  if (users.length === 0) return null;
  const profiles = await query<z.infer<typeof HealthProfileSchema>>(
    `SELECT to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth,
            CASE WHEN date_of_birth IS NULL THEN NULL
                 ELSE EXTRACT(YEAR FROM age(current_date, date_of_birth))::int END AS age,
            gender, height_cm::float8 AS height_cm, blood_type, phone, emergency_contact_name,
            emergency_contact_phone, medical_conditions, allergies, current_medications,
            ${ISO("updated_at")} AS updated_at
       FROM health_profiles WHERE user_id = $1
      ORDER BY created_at ASC LIMIT 1`,
    [userId],
  );
  return { user: users[0], profile: profiles[0] ?? EMPTY_PROFILE };
}

export const profileRoutes = createRouter();

profileRoutes.openapi(
  createRoute({
    method: "get",
    path: "/",
    tags: ["profile"],
    summary: "Get the caller's account and health profile",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    responses: {
      200: jsonContent(successSchema(ProfileResponseSchema), "Profile"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "User not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const data = await loadProfile(user.id);
      if (!data) return c.json({ success: false as const, error: "User not found" }, 404);
      return c.json({ success: true as const, data }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);

profileRoutes.openapi(
  createRoute({
    method: "put",
    path: "/",
    tags: ["profile"],
    summary: "Update the caller's name and health profile",
    middleware: [requireUser],
    security: [{ bearerAuth: [] }],
    request: { body: jsonContent(ProfileUpdateSchema, "Profile changes") },
    responses: {
      200: jsonContent(successSchema(ProfileResponseSchema), "Updated profile"),
      400: jsonContent(ErrorResponseSchema, "Validation error"),
      401: jsonContent(ErrorResponseSchema, "Not authenticated"),
      404: jsonContent(ErrorResponseSchema, "User not found"),
      500: jsonContent(ErrorResponseSchema, "Server error"),
    },
  }),
  async (c) => {
    try {
      const user = currentUser(c);
      const body = c.req.valid("json");
      if (body.date_of_birth && new Date(body.date_of_birth) > new Date()) {
        return c.json({ success: false as const, error: "Date of birth cannot be in the future" }, 400);
      }
      if (body.name !== undefined) {
        await query(`UPDATE users SET name = $1, updated_at = now() WHERE id = $2`, [body.name, user.id]);
      }

      const existing = await query<{ id: string }>(
        `SELECT id FROM health_profiles WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1`,
        [user.id],
      );
      const provided = PROFILE_FIELDS.filter((f) => body[f] !== undefined);
      if (existing.length === 0) {
        const values = PROFILE_FIELDS.map((f) => body[f] ?? null);
        await query(
          `INSERT INTO health_profiles (id, user_id, ${PROFILE_FIELDS.join(", ")}, created_at, updated_at)
           VALUES (gen_random_uuid(), $1, ${PROFILE_FIELDS.map((_, i) => `$${i + 2}`).join(", ")}, now(), now())`,
          [user.id, ...values],
        );
      } else if (provided.length > 0) {
        const sets = provided.map((f, i) => `${f} = $${i + 2}`).join(", ");
        await query(`UPDATE health_profiles SET ${sets}, updated_at = now() WHERE id = $1`, [
          existing[0].id,
          ...provided.map((f) => body[f] ?? null),
        ]);
      }

      const data = await loadProfile(user.id);
      if (!data) return c.json({ success: false as const, error: "User not found" }, 404);
      return c.json({ success: true as const, data }, 200);
    } catch (err) {
      return c.json({ success: false as const, error: internalError(err) }, 500);
    }
  },
);
