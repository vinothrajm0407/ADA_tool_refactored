#!/bin/bash
# Full-stack startup: Redis + Flask + RQ worker
# Usage (from project root in WSL): bash start.sh

PROJECT_ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_ROOT"

source env/bin/activate

# Start Redis if not already running
if ! redis-cli ping > /dev/null 2>&1; then
    echo "[start] Starting Redis..."
    redis-server --daemonize yes --logfile /tmp/redis-ada.log
else
    echo "[start] Redis already running."
fi

# Start Flask in background
echo "[start] Starting Flask (app.py)..."
python app.py &
FLASK_PID=$!

# Start RQ worker in background
echo "[start] Starting RQ worker..."
REDIS_URL=redis://localhost:6379 env/bin/python workers/run_worker.py &
WORKER_PID=$!

# Start Vite frontend dev server in background (calls Windows npm via WSL interop)
echo "[start] Starting frontend (npm run dev)..."
npm run dev &
FRONTEND_PID=$!

# Start browser extension watch build in background
echo "[start] Starting extension build (watch mode)..."
(cd "$PROJECT_ROOT/extension" && npm run dev) &
EXTENSION_PID=$!

echo ""
echo "  Flask     PID: $FLASK_PID"
echo "  Worker    PID: $WORKER_PID"
echo "  Frontend  PID: $FRONTEND_PID"
echo "  Extension PID: $EXTENSION_PID"
echo ""
echo "  Backend:   http://localhost:5000"
echo "  Frontend:  http://localhost:5173"
echo "  Extension: reload unpacked extension in chrome://extensions after each rebuild"
echo "  Press Ctrl+C to stop all."
echo ""

# Wait and forward Ctrl+C to all processes
trap "echo ''; echo '[start] Stopping...'; kill $FLASK_PID $WORKER_PID $FRONTEND_PID $EXTENSION_PID 2>/dev/null; exit 0" INT TERM
wait $FLASK_PID $WORKER_PID $FRONTEND_PID $EXTENSION_PID
