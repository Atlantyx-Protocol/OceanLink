#!/bin/bash
#
# One-shot pre-approval for liquidity providers.
# Delegates to scripts/approve-lps.ts via tsx — no running backend required.
#
# Reads PRIVATE_KEY_B / PRIVATE_KEY_C / PRIVATE_KEY_D and the RPC URLs from
# the monorepo root .env (same one the backend uses).

set -euo pipefail

cd "$(dirname "$0")/.."   # packages/backend
exec pnpm exec tsx scripts/approve-lps.ts
