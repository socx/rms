#!/usr/bin/env bash
set -euo pipefail

# dev/stop.sh - kill stray development processes for this repo
# Usage: ./dev/stop.sh

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "Scanning for dev processes under: $REPO_ROOT"

PATTERN="${REPO_ROOT}"

PIDS=$(ps -eo pid=,args= | grep -F "$PATTERN" | grep -E 'nodemon|vite|concurrently|esbuild|python|node' | grep -v grep | awk '{print $1}' | sort -u || true)

if [ -z "$PIDS" ]; then
  echo "No matching dev processes found."
  exit 0
fi

echo "Found PIDs: $PIDS"

echo "Sending SIGINT to processes..."
for pid in $PIDS; do
  if kill -0 "$pid" 2>/dev/null; then
    kill -INT "$pid" || true
  fi
done

sleep 2

# Check remaining
REMAINING="$(echo "$PIDS" | xargs -n1 sh -c 'kill -0 "$0" 2>/dev/null && echo "$0"' 2>/dev/null || true)"
if [ -n "$REMAINING" ]; then
  echo "Processes still running after SIGINT: $REMAINING"
  echo "Sending SIGTERM..."
  for pid in $REMAINING; do
    kill -TERM "$pid" || true
  done
  sleep 1
fi

# Force kill any that remain
FINAL="$(echo "$PIDS" | xargs -n1 sh -c 'kill -0 "$0" 2>/dev/null && echo "$0"' 2>/dev/null || true)"
if [ -n "$FINAL" ]; then
  echo "Force killing: $FINAL"
  for pid in $FINAL; do
    kill -9 "$pid" || true
  done
fi

echo "Done."
