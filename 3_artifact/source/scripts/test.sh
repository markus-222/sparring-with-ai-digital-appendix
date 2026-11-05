#!/usr/bin/env bash
set -euo pipefail

# ============================================================
# Integration Test Script — Master Thesis Prototype
# Run: ./scripts/test.sh
# Requires: docker compose up -d
# ============================================================

GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

pass() { echo -e "${GREEN}✓ $1${NC}"; }
fail() { echo -e "${RED}✗ $1${NC}"; exit 1; }

echo "=== Integration Tests ==="
echo ""

# 1. Backend Health
echo "Checking backend health..."
STATUS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:8000/health)
[ "$STATUS" = "200" ] && pass "Backend /health → 200" || fail "Backend /health → $STATUS"

# 2. Database reachable (via backend)
echo "Checking database connection..."
docker compose exec -T backend python -c "
import asyncio
from app.database import engine
from sqlalchemy import text
async def check():
    async with engine.begin() as conn:
        await conn.execute(text('SELECT 1'))
asyncio.run(check())
" && pass "Database connected" || fail "Database unreachable"

# 3. Schema exists
echo "Checking database schema..."
TABLES=$(docker compose exec -T db psql -U postgres -d aireprototype -tc "SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE';")
TABLES=$(echo "$TABLES" | xargs)
[ "$TABLES" -ge 8 ] && pass "Database schema: $TABLES tables" || fail "Expected ≥8 tables, got $TABLES"

# 4. Unit Tests
echo "Running unit tests..."
docker compose exec -T backend pytest app/tests/ -m "not integration" -q --tb=short && pass "Unit tests passed" || fail "Unit tests failed"

# 5. Integration Tests
echo "Running integration tests..."
docker compose exec -T backend pytest app/tests/ -m integration -q --tb=short && pass "Integration tests passed" || fail "Integration tests failed"

echo ""
echo "=== All checks passed ==="
