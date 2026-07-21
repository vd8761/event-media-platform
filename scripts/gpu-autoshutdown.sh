#!/usr/bin/env bash
# Self-shutdown watchdog for the GPU box.
#
# Polls the API and powers the machine down when there is nothing left to do.
# The direction matters: the box asks us, we never push to the box. That means
#   - the VM needs no inbound network access, and
#   - if the API is unreachable, the VM shuts down.
# The expensive resource fails closed. A bug, an outage, or a bad deploy costs
# you an idle machine for at most FAILURE_GRACE polls, not a weekend of GPU time.
#
# Install on the GPU VM (see docs/deploy-production.md §6.5):
#   sudo cp gpu-autoshutdown.sh /usr/local/bin/
#   sudo chmod +x /usr/local/bin/gpu-autoshutdown.sh
#   # then run it from systemd or cron — the script loops on its own
#
# Required environment:
#   EL_API_URL          e.g. https://your-app.vercel.app
#   EL_GPU_HEARTBEAT_TOKEN  must match the API's EL_GPU_HEARTBEAT_TOKEN
# Optional:
#   POLL_INTERVAL       seconds between polls (default 60)
#   FAILURE_GRACE       consecutive failures tolerated before shutting down
#                       (default 5 — with the default interval, ~5 minutes)
#   SHUTDOWN_CMD        override for testing (default: sudo shutdown -h now)
set -euo pipefail

API_URL="${EL_API_URL:?EL_API_URL is required}"
TOKEN="${EL_GPU_HEARTBEAT_TOKEN:?EL_GPU_HEARTBEAT_TOKEN is required}"
POLL_INTERVAL="${POLL_INTERVAL:-60}"
FAILURE_GRACE="${FAILURE_GRACE:-5}"
SHUTDOWN_CMD="${SHUTDOWN_CMD:-sudo shutdown -h now}"

ENDPOINT="${API_URL%/}/api/webhooks/gpu/heartbeat"
failures=0

log() { echo "[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"; }

log "watchdog started — polling ${ENDPOINT} every ${POLL_INTERVAL}s"

while true; do
  # --max-time bounds a hung connection so a stalled API still counts as a
  # failure rather than pausing the loop indefinitely.
  if response=$(curl -fsS --max-time 20 -H "Authorization: Bearer ${TOKEN}" "${ENDPOINT}" 2>/dev/null); then
    failures=0

    # Parsed without jq so the script has no dependencies beyond curl.
    keep_alive=$(printf '%s' "$response" | grep -o '"keepAlive"[[:space:]]*:[[:space:]]*[a-z]*' | grep -o '[a-z]*$')
    reason=$(printf '%s' "$response" | sed -n 's/.*"reason"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')

    if [ "$keep_alive" = "true" ]; then
      log "staying up (${reason:-no reason given})"
    elif [ "$keep_alive" = "false" ]; then
      log "shutting down (${reason:-no reason given})"
      # Give in-flight work a moment to flush; BullMQ will retry anything
      # genuinely mid-job on the next boot.
      sleep 5
      exec ${SHUTDOWN_CMD}
    else
      # A 200 we could not parse. Treat as a failure rather than assuming
      # either answer — assuming "stay up" is the expensive mistake.
      failures=$((failures + 1))
      log "unparseable response (${failures}/${FAILURE_GRACE}): ${response:0:200}"
    fi
  else
    failures=$((failures + 1))
    log "API unreachable (${failures}/${FAILURE_GRACE})"
  fi

  if [ "$failures" -ge "$FAILURE_GRACE" ]; then
    log "no usable answer after ${failures} attempts — shutting down to avoid an idle bill"
    exec ${SHUTDOWN_CMD}
  fi

  sleep "${POLL_INTERVAL}"
done
