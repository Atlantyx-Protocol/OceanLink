#!/bin/bash

set -euo pipefail

API_BASE="${API_BASE:-http://localhost:3001/api}"
AMOUNT="${1:-${AMOUNT:-}}"
PRIVATE_KEY="${PRIVATE_KEY:-}"
MAX_UINT256="115792089237316195423570985008687907853269984665640564039457584007913129639935"

RED='\033[0;31m'
GREEN='\033[0;32m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

usage() {
    cat >&2 <<EOF
Usage:
  PRIVATE_KEY=0x... ./packages/backend/scripts/approve-usdc-all.sh <amount>
  PRIVATE_KEY=0x... ./packages/backend/scripts/approve-usdc-all.sh max

Examples:
  PRIVATE_KEY=0xabc... ./packages/backend/scripts/approve-usdc-all.sh 1000000
  PRIVATE_KEY=0xabc... ./packages/backend/scripts/approve-usdc-all.sh max
  API_BASE=http://localhost:3001/api PRIVATE_KEY=0xabc... ./packages/backend/scripts/approve-usdc-all.sh 700000000
EOF
}

check_deps() {
    for cmd in curl jq; do
        if ! command -v "$cmd" >/dev/null 2>&1; then
            log_error "$cmd is not installed"
            exit 1
        fi
    done
}

check_inputs() {
    if [ -z "$PRIVATE_KEY" ]; then
        log_error "PRIVATE_KEY is required"
        usage
        exit 1
    fi

    if [ -z "$AMOUNT" ]; then
        log_error "amount is required"
        usage
        exit 1
    fi

    if [ "$AMOUNT" = "max" ] || [ "$AMOUNT" = "MAX" ]; then
        AMOUNT="$MAX_UINT256"
    fi
}

main() {
    check_deps
    check_inputs

    log_info "Approving $AMOUNT USDC for all configured chains..."

    response=$(curl -s -X POST "$API_BASE/usdc/approve/all" \
        -H "Content-Type: application/json" \
        -d "{
            \"privateKey\": \"$PRIVATE_KEY\",
            \"amount\": \"$AMOUNT\"
        }")

    success=$(echo "$response" | jq -r '.success')

    if [ "$success" != "true" ]; then
        log_error "Approval request failed"
        echo "$response" | jq . >&2
        exit 1
    fi

    log_success "Approval request completed"
    echo "$response" | jq .
}

main "$@"
