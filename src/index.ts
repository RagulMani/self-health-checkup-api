/**
 * Node adapter — do NOT edit. `npm run dev` (tsx watch) and `npm start`
 * (esbuild bundle) both enter here. Lambda enters through src/lambda.ts.
 */
import { serve } from "@hono/node-server";
import { createApp } from "./app";
import { closePool } from "./db";
import { env } from "./env";

const app = createApp();
const port = env.PORT;

const server = serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, (info) => {
  console.log(`[node-api] listening on http://0.0.0.0:${info.port}`);
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[node-api] ${signal} received — shutting down`);
  const forceExit = setTimeout(() => process.exit(0), 5_000);
  forceExit.unref();
  server.close(() => {
    void closePool().finally(() => process.exit(0));
  });
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));
