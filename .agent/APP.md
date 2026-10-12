# App knowledge — e1a5afb2-8858-4a5d-a0fb-49e363a5fbd1

_Auto-generated after each build from the app's persisted files. Do not hand-edit — it is regenerated automatically. Treat it as the authoritative orientation map; read individual files only when you need their contents._

## Pages (0)
- (none yet)

## API routes (0)
- (none yet)

## Components (0)
- (none yet)

## Lib / helpers (0)
- (none yet)

## Other files (36)
- scripts/db-migrate.mjs
- src/app.ts
- src/auth/email.ts
- src/auth/jwt.ts
- src/auth/middleware.ts
- src/auth/roles.ts
- src/auth/routes.ts
- src/auth/sessions.ts
- src/db.ts
- src/env.ts
- src/index.ts
- src/integrations/connectors/authNormalize.ts
- src/integrations/connectors/connector.ts
- src/integrations/connectors/index.ts
- src/integrations/connectors/providerRegistry.ts
- src/integrations/connectors/types.ts
- src/integrations/handleIntegrationAction.ts
- src/integrations/index.ts
- src/integrations/routes/index.ts
- src/json.ts
- src/lambda.ts
- src/lib/health.ts
- src/lib/records.ts
- src/lib/summary.ts
- src/lib/symptoms.ts
- src/openapi.ts
- src/router.ts
- src/routes/_example.ts
- src/routes/dashboard.ts
- src/routes/health-records.ts
- src/routes/index.ts
- src/routes/notifications.ts
- src/routes/profile.ts
- src/routes/reminders.ts
- src/routes/reports.ts
- src/routes/symptom-checks.ts

## Database entities
- (no database entities)

## Applied database migrations
_Check this list before emitting any DDL — never re-create an existing migration._
- 0001_users.sql
- 0002_accounts.sql
- 0003_sessions.sql
- 0004_verification_token.sql
- 0005_create_health_profiles.sql
- 0006_create_health_records.sql
- 0007_create_symptom_checks.sql
- 0008_create_reminders.sql
- 0009_create_notifications.sql

## npm dependencies
- @hono/node-server
- @hono/zod-openapi
- bcryptjs
- dotenv
- hono
- jose
- pg
- zod

## Images
_No images in `public/images/library/` yet. Search with `image_search`, then `materialize_image` to save once and reuse the returned `url_path` everywhere._

## Platform conventions
- Next.js **Pages Router**. List/dashboard routes use `pages/<segment>/index.tsx` (directory-first); never create both `pages/X.tsx` and `pages/X/index.tsx`.
- API handlers live under `pages/api/**` and use the shared pool from `lib/db.ts` with `$1, $2…` positional placeholders — never string-interpolate values into SQL.
- JSON responses go through the helpers in `lib/json.ts`.
- Design tokens are CSS variables in `styles/globals.css` (managed by the platform) — style with the token classes, do not hardcode palette hexes.
- `package.json` is a locked path — add packages via the add_dependency tool only.
