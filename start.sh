#!/bin/bash
# Universal entrypoint for E2B / Blaxel / Daytona / Modal.
set -euo pipefail

# ── Blaxel ───────────────────────────────────────────────────────────────────
# Blaxel requires sandbox-api on :8080 for fs/exec RPC. Next.js (port 3000) is
# started by the backend after S3 restore — not here.
if [ -n "${BL_SERVER_URL:-}" ] || [ -n "${BL_ENV:-}" ] || [ "${SANDBOX_PROVIDER:-}" = "blaxel" ]; then
  echo "[start.sh] Blaxel: starting sandbox-api on :8080"

  if [ ! -x /usr/local/bin/sandbox-api ]; then
    echo "[start.sh] ERROR: /usr/local/bin/sandbox-api missing"
    exit 1
  fi

  /usr/local/bin/sandbox-api &

  for _ in $(seq 1 60); do
    if curl -sf --connect-timeout 1 http://127.0.0.1:8080/health >/dev/null 2>&1; then
      echo "[start.sh] sandbox-api ready on :8080"
      exec tail -f /dev/null
    fi
    sleep 0.5
  done

  echo "[start.sh] ERROR: sandbox-api did not become ready on :8080"
  exit 1
fi

# ── E2B / Modal / Daytona / fallback ─────────────────────────────────────────
# E2B's envd handles RPC; container just needs to stay alive.
# Modal and Daytona manage execution themselves.
echo "[start.sh] Non-Blaxel runtime, staying alive"

exec tail -f /dev/null
