#!/bin/bash
echo "🚀 Starting Reliable Context API..."

# Cleanup function to kill all background processes on exit
cleanup() {
    echo "Stopping all services..."
    kill $NODE_PID $FASTAPI_PID $WORKER_PID 2>/dev/null
    exit 0
}

# Trap SIGINT (Ctrl+C) and SIGTERM to run cleanup
trap cleanup SIGINT SIGTERM

# -1. Kill any stray instances from a previous run that didn't get cleaned up
# properly (e.g. the terminal was closed instead of Ctrl+C'd). Without this,
# every restart leaves the old worker.py running in the background — it
# doesn't hold a port so nothing complains, but it keeps pulling jobs off
# the SAME Redis queue as the new one and keeps serving whatever code was on
# disk when IT started, silently competing with the current instance and
# making "it doesn't do what I just fixed" bugs look non-deterministic.
echo "Checking for stray processes from a previous run..."
pkill -f "worker\.py" 2>/dev/null
lsof -ti :3000 -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null
lsof -ti :8000 -sTCP:LISTEN 2>/dev/null | xargs -r kill 2>/dev/null
sleep 1

# 0. Ensure Redis is running
if ! /opt/homebrew/bin/redis-cli ping > /dev/null 2>&1 && ! redis-cli ping > /dev/null 2>&1; then
    echo "Starting Redis server..."
    brew services start redis > /dev/null 2>&1 || redis-server --daemonize yes 2>/dev/null || /opt/homebrew/bin/redis-server --daemonize yes 2>/dev/null
    sleep 1
fi

# 1. Start Node Gateway
# `exec` replaces the subshell with the final process instead of leaving it
# as a child of a subshell — otherwise `$!` below captures the SUBSHELL's
# PID, and `kill $NODE_PID` in cleanup() can fail to reach the actual
# node/python process it spawned, which is exactly how these stray
# processes accumulate across restarts.
echo "Starting Node API Gateway on port 3000..."
(cd gateway && npm install && exec node src/server.js) &
NODE_PID=$!

# 2. Start Python FastAPI Server
echo "Starting Python FastAPI Server on port 8000..."
(cd worker && source venv/bin/activate && exec uvicorn server:app --port 8000) &
FASTAPI_PID=$!

# 3. Start Python Background Worker
echo "Starting Python Background Worker (BullMQ)..."
(cd worker && source venv/bin/activate && exec python worker.py) &
WORKER_PID=$!

echo ""
echo "✅ All systems are running!"
echo "Press Ctrl+C to stop everything."

# Wait for all background processes
wait $NODE_PID $FASTAPI_PID $WORKER_PID
