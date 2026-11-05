#!/bin/sh
set -e

# Run database migrations
echo "Running database migrations..."
alembic upgrade head

# Start the application
# Hot-reload only in dev (DEBUG=true); production runs a stable worker process.
echo "Starting backend..."
if [ "$DEBUG" = "true" ]; then
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir /app/app
else
    exec uvicorn app.main:app --host 0.0.0.0 --port 8000
fi
