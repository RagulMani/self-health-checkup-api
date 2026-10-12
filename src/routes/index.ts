/**
 * Route registry — YOU (the implementation agent) own this file.
 *
 * One file per resource under src/routes/, each exporting a router built
 * with `createRouter()` from "@/router". Register it here with the URL
 * prefix it should live under; the platform shell mounts every entry under
 * `/api`, so `{ path: "/projects", app: projectsRoutes }` serves
 * `/api/projects`, `/api/projects/{id}`, ...
 *
 * See src/routes/_example.ts for the conventions (zod schemas on every
 * route, `{ success, data }` envelope, auth middleware, `query()` from
 * "@/db"). The example is NOT registered — copy it, do not import it.
 */
import type { AppRouter } from "@/router";
import { dashboardRoutes } from "./dashboard";
import { healthRecordsRoutes } from "./health-records";
import { notificationsRoutes } from "./notifications";
import { profileRoutes } from "./profile";
import { remindersRoutes } from "./reminders";
import { reportsRoutes } from "./reports";
import { symptomChecksRoutes } from "./symptom-checks";

export const routes: Array<{ path: string; app: AppRouter }> = [
  { path: "/profile", app: profileRoutes },
  { path: "/health-records", app: healthRecordsRoutes },
  { path: "/dashboard", app: dashboardRoutes },
  { path: "/symptom-checks", app: symptomChecksRoutes },
  { path: "/reminders", app: remindersRoutes },
  { path: "/notifications", app: notificationsRoutes },
  { path: "/reports", app: reportsRoutes },
];
