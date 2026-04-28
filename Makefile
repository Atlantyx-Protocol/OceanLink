# Load .env file if it exists
ifneq (,$(wildcard .env))
include .env
export
endif

PG_CONTAINER ?= oceanlink-pg
PG_IMAGE     ?= postgres:16
PG_PORT      ?= 5432
PG_USER      ?= postgres
PG_PASSWORD  ?= postgres
PG_DB        ?= oceanlink

.PHONY: help install dev dev-app build e2e-test e2e-matching-test e2e-liquidity-test e2e-full-flow-test approve-usdc-all approve-lps backend frontend db-up db-down db-logs db-push db-studio db-reset db-wait

help:
	@echo "Available commands:"
	@echo "  make install      - Install all dependencies"
	@echo "  make dev          - Start Postgres + push schema + run frontend & backend"
	@echo "  make dev-app      - Run frontend & backend only (no DB management)"
	@echo "  make build        - Build all packages"
	@echo "  make backend      - Start backend server"
	@echo "  make frontend     - Start frontend server"
	@echo ""
	@echo "Database:"
	@echo "  make db-up        - Start Postgres container ($(PG_CONTAINER))"
	@echo "  make db-down      - Stop & remove the Postgres container"
	@echo "  make db-logs      - Tail Postgres container logs"
	@echo "  make db-push      - Push Drizzle schema to the database"
	@echo "  make db-studio    - Open Drizzle Studio in the browser"
	@echo "  make db-reset     - Drop & recreate the Postgres container (DESTROYS DATA)"
	@echo ""
	@echo "  make approve-usdc-all        - Approve USDC on all chains (defaults to AMOUNT=max)"
	@echo "  make approve-lps             - Pre-approve LP wallets (B/C/D) on their source chains"
	@echo "  make e2e-bridge-test          - Run E2E bridge test"
	@echo "  make e2e-matching-test - Run E2E matching engine test"
	@echo "  make e2e-liquidity-test - Run E2E liquidity market service test"
	@echo "  make e2e-full-flow-test - Run E2E full flow (intent→match→bridge→verify)"
	@echo ""
	@echo "E2E Test: Loads PRIVATE_KEY_A/B from .env (full-flow also needs C/D)"

install:
	pnpm install

# Boots Postgres (idempotent), waits for it to be ready, applies the
# Drizzle schema, then starts both frontend and backend in parallel.
dev: db-up db-wait db-push
	pnpm dev

# Skips DB management — useful when Postgres is already running elsewhere.
dev-app:
	pnpm dev

# -----------------------------------------------------------------------------
# Database (Postgres in Docker)
# -----------------------------------------------------------------------------

db-up:
	@if [ -n "$$(docker ps -a --filter name=^/$(PG_CONTAINER)$$ --format '{{.Names}}')" ]; then \
		echo "[db] container $(PG_CONTAINER) exists — starting"; \
		docker start $(PG_CONTAINER) >/dev/null; \
	else \
		echo "[db] creating container $(PG_CONTAINER)"; \
		docker run -d --name $(PG_CONTAINER) \
			-p $(PG_PORT):5432 \
			-e POSTGRES_USER=$(PG_USER) \
			-e POSTGRES_PASSWORD=$(PG_PASSWORD) \
			-e POSTGRES_DB=$(PG_DB) \
			$(PG_IMAGE) >/dev/null; \
	fi

db-wait:
	@echo "[db] waiting for Postgres to accept connections..."
	@for i in $$(seq 1 30); do \
		if docker exec $(PG_CONTAINER) pg_isready -U $(PG_USER) -d $(PG_DB) >/dev/null 2>&1; then \
			echo "[db] ready"; exit 0; \
		fi; \
		sleep 1; \
	done; \
	echo "[db] timed out waiting for Postgres"; exit 1

db-down:
	-docker stop $(PG_CONTAINER) >/dev/null 2>&1
	-docker rm $(PG_CONTAINER) >/dev/null 2>&1
	@echo "[db] container removed"

db-logs:
	docker logs -f $(PG_CONTAINER)

db-push:
	pnpm --filter @ocean-link/backend db:push

db-studio:
	pnpm --filter @ocean-link/backend db:studio

db-reset: db-down db-up db-wait db-push
	@echo "[db] reset complete"

build:
	pnpm build

backend:
	cd packages/backend && pnpm dev

frontend:
	cd packages/frontend && pnpm dev

approve-usdc-all:
	@if [ -z "$$PRIVATE_KEY" ] && [ -z "$$PRIVATE_KEY_A" ]; then echo "Error: PRIVATE_KEY or PRIVATE_KEY_A not set"; exit 1; fi
	@PRIVATE_KEY="$${PRIVATE_KEY:-$$PRIVATE_KEY_A}" ./packages/backend/scripts/approve-usdc-all.sh "$${AMOUNT:-max}"

approve-lps:
	@if [ -z "$$PRIVATE_KEY_B" ]; then echo "Error: PRIVATE_KEY_B not set"; exit 1; fi
	@if [ -z "$$PRIVATE_KEY_C" ]; then echo "Error: PRIVATE_KEY_C not set"; exit 1; fi
	@if [ -z "$$PRIVATE_KEY_D" ]; then echo "Error: PRIVATE_KEY_D not set"; exit 1; fi
	./packages/backend/scripts/approve-lps.sh

e2e-bridge-test:
	@if [ -z "$$PRIVATE_KEY_A" ]; then echo "Error: PRIVATE_KEY_A not set"; exit 1; fi
	@if [ -z "$$PRIVATE_KEY_B" ]; then echo "Error: PRIVATE_KEY_B not set"; exit 1; fi
	./packages/backend/scripts/e2e-bridge-test.sh

e2e-matching-test:
	./packages/backend/scripts/e2e-matching-engine-test.sh

e2e-liquidity-test:
	@if [ -z "$$PRIVATE_KEY_TESTER" ]; then echo "Error: PRIVATE_KEY_TESTER not set"; exit 1; fi
	./packages/backend/scripts/e2e-liquidity-test.sh

e2e-full-flow-test:
	@if [ -z "$$PRIVATE_KEY_A" ]; then echo "Error: PRIVATE_KEY_A not set"; exit 1; fi
	@if [ -z "$$PRIVATE_KEY_B" ]; then echo "Error: PRIVATE_KEY_B not set"; exit 1; fi
	@if [ -z "$$PRIVATE_KEY_C" ]; then echo "Error: PRIVATE_KEY_C not set"; exit 1; fi
	@if [ -z "$$PRIVATE_KEY_D" ]; then echo "Error: PRIVATE_KEY_D not set"; exit 1; fi
	@set -o pipefail; ./packages/backend/scripts/e2e-full-flow-test.sh 2>&1 | tee packages/backend/scripts/e2e-full-flow-test-report.txt
