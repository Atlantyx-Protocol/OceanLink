# Load .env file if it exists
ifneq (,$(wildcard .env))
include .env
export
endif

.PHONY: help install dev build e2e-test e2e-matching-test backend frontend

help:
	@echo "Available commands:"
	@echo "  make install      - Install all dependencies"
	@echo "  make dev          - Start development servers"
	@echo "  make build        - Build all packages"
	@echo "  make backend      - Start backend server"
	@echo "  make frontend     - Start frontend server"
	@echo "  make e2e-test          - Run E2E bridge test"
	@echo "  make e2e-matching-test - Run E2E matching engine test"
	@echo ""
	@echo "E2E Test: Loads PRIVATE_KEY_A and PRIVATE_KEY_B from .env"

install:
	pnpm install

dev:
	pnpm dev

build:
	pnpm build

backend:
	cd packages/backend && pnpm dev

frontend:
	cd packages/frontend && pnpm dev

e2e-test:
	@if [ -z "$$PRIVATE_KEY_A" ]; then echo "Error: PRIVATE_KEY_A not set"; exit 1; fi
	@if [ -z "$$PRIVATE_KEY_B" ]; then echo "Error: PRIVATE_KEY_B not set"; exit 1; fi
	./packages/backend/scripts/e2e-bridge-test.sh

e2e-matching-test:
	./packages/backend/scripts/e2e-matching-engine-test.sh
