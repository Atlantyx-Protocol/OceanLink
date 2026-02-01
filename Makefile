# Load .env file if it exists
ifneq (,$(wildcard .env))
include .env
export
endif

.PHONY: help install dev build test e2e-test backend frontend

# Default target
help:
	@echo "Available commands:"
	@echo "  make install      - Install all dependencies"
	@echo "  make dev          - Start development servers"
	@echo "  make build        - Build all packages"
	@echo "  make backend      - Start backend server"
	@echo "  make frontend     - Start frontend server"
	@echo "  make e2e-test     - Run E2E bridge test (requires PRIVATE_KEY_A and PRIVATE_KEY_B)"
	@echo ""
	@echo "E2E Test:"
	@echo "  Automatically loads PRIVATE_KEY_A and PRIVATE_KEY_B from .env file"
	@echo "  Or run with: PRIVATE_KEY_A=0x... PRIVATE_KEY_B=0x... make e2e-test"

# Install dependencies
install:
	pnpm install

# Start all dev servers
dev:
	pnpm dev

# Build all packages
build:
	pnpm build

# Start backend only
backend:
	cd packages/backend && pnpm dev

# Start frontend only
frontend:
	cd packages/frontend && pnpm dev

# Run E2E bridge test
e2e-test:
	@if [ -z "$$PRIVATE_KEY_A" ]; then \
		echo "Error: PRIVATE_KEY_A is not set"; \
		echo "Usage: PRIVATE_KEY_A=0x... PRIVATE_KEY_B=0x... make e2e-test"; \
		exit 1; \
	fi
	@if [ -z "$$PRIVATE_KEY_B" ]; then \
		echo "Error: PRIVATE_KEY_B is not set"; \
		echo "Usage: PRIVATE_KEY_A=0x... PRIVATE_KEY_B=0x... make e2e-test"; \
		exit 1; \
	fi
	./packages/backend/scripts/e2e-bridge-test.sh
