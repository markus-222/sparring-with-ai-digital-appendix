.PHONY: check fix test-unit test-int lint types layers up down reset dev test-frontend test-e2e check-full

# === THE DONE-GATE ===
# Stages: 1) lint  2) types  3) layering contracts  4) fast tests  5) frontend
check:
	@echo "=== Stage 1: Lint ==="
	@docker compose exec -T backend python -m ruff check app/ --quiet 2>&1 || (echo "✗ Lint failed" && exit 1)
	@docker compose exec -T backend python -m ruff format --check app/ --quiet 2>&1 || (echo "✗ Format failed" && exit 1)
	@echo "=== Stage 2: Type Check ==="
	@docker compose exec -T backend python -m mypy app/ --no-error-summary 2>&1 || (echo "✗ Type check failed" && exit 1)
	@echo "=== Stage 3: Layering Contracts ==="
	@docker compose exec -T backend lint-imports 2>&1 || (echo "✗ Import contracts violated" && exit 1)
	@echo "=== Stage 4: Unit Tests ==="
	@docker compose exec -T backend pytest app/tests/ -m "not integration" -q --tb=short 2>&1 || (echo "✗ Tests failed" && exit 1)
	@echo "=== Stage 5: Frontend ==="
	@cd frontend && pnpm lint --quiet 2>&1 || (echo "✗ Frontend lint failed" && exit 1)
	@cd frontend && pnpm exec tsc --noEmit 2>&1 || (echo "✗ Frontend types failed" && exit 1)
	@cd frontend && pnpm vitest run --reporter=dot 2>&1 || (echo "✗ Frontend tests failed" && exit 1)
	@echo ""
	@echo "✓ make check passed (lint + types + layers + tests + frontend)"

# === AUTO-FIX (mutating — use when check fails on lint/format) ===
fix:
	@echo "=== Auto-fixing lint + format ==="
	@docker compose exec -T backend python -m ruff check app/ --fix --quiet 2>&1
	@docker compose exec -T backend python -m ruff format app/ --quiet 2>&1
	@echo "✓ Applied ruff fixes. Re-run: make check"

# === Individual targets ===

test-unit:
	docker compose exec -T backend pytest app/tests/ -m "not integration" -v --tb=short

test-int:
	./scripts/test.sh

lint:
	docker compose exec -T backend python -m ruff check app/ --fix
	docker compose exec -T backend python -m ruff format app/

types:
	docker compose exec -T backend python -m mypy app/

layers:
	docker compose exec -T backend lint-imports

# === Docker lifecycle ===

up:
	docker compose up -d --build

down:
	docker compose down

reset:
	docker compose down -v && docker compose up -d --build

# === Full-Stack Dev (frontend outside Docker for fast HMR) ===
dev:
	@echo "Starting backend stack (DB, Backend)..."
	docker compose up -d db backend
	@echo "Waiting for backend health..."
	@until curl -sf http://localhost:8000/health > /dev/null 2>&1; do sleep 1; done
	@echo "✓ Backend ready at http://localhost:8000"
	@echo "Starting frontend dev server..."
	cd frontend && pnpm dev

# === Frontend Unit Tests (Vitest + MSW, no backend needed) ===
test-frontend:
	cd frontend && pnpm test:unit

# === Frontend E2E Tests (Playwright + Mock API, no backend needed) ===
test-e2e:
	cd frontend && npx playwright test

# === All gates ===
check-full: check test-frontend
	@echo ""
	@echo "✓ All gates passed (backend + frontend unit tests)"
