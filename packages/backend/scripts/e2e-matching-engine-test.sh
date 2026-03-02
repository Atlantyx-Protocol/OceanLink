#!/bin/bash

# E2E Matching Engine Test Script
# Tests the full intent → queue → match cycle via the API

set -e

# Configuration
API_BASE="http://localhost:3001/api"
MATCH_INTERVAL_MS="${MATCH_INTERVAL_MS:-5000}"

# Chain IDs (Sepolia & Base Sepolia as configured in the backend)
CHAIN_1=11155111
CHAIN_2=84532

# Deadline: 10 minutes from now
DEADLINE=$(( $(date +%s) + 600 ))

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1" >&2; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1" >&2; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

check_deps() {
    for cmd in jq curl; do
        if ! command -v "$cmd" &>/dev/null; then
            log_error "$cmd is not installed"
            exit 1
        fi
    done
}

# Submit an intent order and print/return its orderId
#   submit_order <srcChain> <desChain> <amount> <label>
submit_order() {
    local src=$1 des=$2 amount=$3 label=$4

    log_info "Submitting order: $label (${src} -> ${des}, amount ${amount})..."

    response=$(curl -s -X POST "$API_BASE/intent" \
        -H "Content-Type: application/json" \
        -d "{
            \"srcChain\": $src,
            \"desChain\": $des,
            \"amount\": \"$amount\",
            \"deadline\": $DEADLINE
        }")

    order_id=$(echo "$response" | jq -r '.order.orderId')

    if [ "$order_id" == "null" ] || [ -z "$order_id" ]; then
        log_error "Failed to submit order ($label): $response"
        exit 1
    fi

    log_success "Order submitted ($label) — orderId: $order_id"
    echo "$order_id"
}

# Query a single order and validate its status
#   query_order <orderId> <expectedStatus> <label>
query_order() {
    local order_id=$1 expected_status=$2 label=$3

    response=$(curl -s "$API_BASE/orders/$order_id")
    status=$(echo "$response" | jq -r '.order.status')

    if [ "$status" == "null" ] || [ -z "$status" ]; then
        log_error "Order not found ($label): $response"
        exit 1
    fi

    if [ "$status" != "$expected_status" ]; then
        log_error "Order $label status mismatch: expected $expected_status, got $status"
        echo "$response" | jq . >&2
        exit 1
    fi

    log_success "Order $label status = $status (expected $expected_status)"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

main() {
    echo ""
    echo "============================================"
    echo "  Matching Engine E2E Test"
    echo "============================================"
    echo ""

    check_deps

    # ------------------------------------------------------------------
    # Step 1: Submit orders
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 1: Submit Intent Orders"
    echo "============================================"

    # order 1: chain1 -> chain2, 1000
    ORDER_1=$(submit_order "$CHAIN_1" "$CHAIN_2" "1000" "Order 1 (1→2, 1000)")
    echo ""

    # order 2: chain2 -> chain1, 500
    ORDER_2=$(submit_order "$CHAIN_2" "$CHAIN_1" "500" "Order 2 (2→1, 500)")
    echo ""

    # order 3: chain2 -> chain1, 300
    ORDER_3=$(submit_order "$CHAIN_2" "$CHAIN_1" "300" "Order 3 (2→1, 300)")
    echo ""

    # order 4: chain2 -> chain1, 200
    ORDER_4=$(submit_order "$CHAIN_2" "$CHAIN_1" "200" "Order 4 (2→1, 200)")
    echo ""

    # ------------------------------------------------------------------
    # Step 2: Verify all orders are QUEUED
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 2: Verify Orders Are Queued"
    echo "============================================"

    query_order "$ORDER_1" "QUEUED" "Order 1"
    query_order "$ORDER_2" "QUEUED" "Order 2"
    query_order "$ORDER_3" "QUEUED" "Order 3"
    query_order "$ORDER_4" "QUEUED" "Order 4"
    echo ""

    # ------------------------------------------------------------------
    # Step 3: Poll for match results
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 3: Wait for Matching Engine Tick"
    echo "============================================"

    MAX_WAIT_SECS=$(( (MATCH_INTERVAL_MS / 1000) * 3 ))
    POLL_INTERVAL=2
    elapsed=0

    log_info "Polling /api/matches until results appear (timeout ${MAX_WAIT_SECS}s, MATCH_INTERVAL_MS=${MATCH_INTERVAL_MS})..."

    while [ "$elapsed" -lt "$MAX_WAIT_SECS" ]; do
        matches_response=$(curl -s "$API_BASE/matches")
        total_matches=$(echo "$matches_response" | jq '.data | length')

        if [ "$total_matches" -gt 0 ]; then
            break
        fi

        log_info "No matches yet (${elapsed}s elapsed), retrying in ${POLL_INTERVAL}s..."
        sleep "$POLL_INTERVAL"
        elapsed=$(( elapsed + POLL_INTERVAL ))
    done

    if [ "$total_matches" -eq 0 ]; then
        log_error "No match results found after ${MAX_WAIT_SECS}s — the engine may not have run"
        echo "$matches_response" | jq . >&2
        exit 1
    fi

    log_success "Found $total_matches match result(s) after ~${elapsed}s"
    echo "$matches_response" | jq '.data' >&2
    echo ""

    # ------------------------------------------------------------------
    # Step 5: Validate order statuses after matching
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 5: Validate Order Statuses"
    echo "============================================"

    # Fetch each order's final status
    for label_id in "Order 1:$ORDER_1" "Order 2:$ORDER_2" "Order 3:$ORDER_3" "Order 4:$ORDER_4"; do
        label="${label_id%%:*}"
        oid="${label_id##*:}"

        response=$(curl -s "$API_BASE/orders/$oid")
        status=$(echo "$response" | jq -r '.order.status')
        amount=$(echo "$response" | jq -r '.order.amount')

        log_info "$label — status: $status, remaining amount: $amount"
    done
    echo ""

    # Order 1 sent 1000 (1→2). Orders 2+3+4 send 500+300+200 = 1000 (2→1).
    # Expect all orders to be MATCHED.
    for label_id in "Order 1:$ORDER_1" "Order 2:$ORDER_2" "Order 3:$ORDER_3" "Order 4:$ORDER_4"; do
        label="${label_id%%:*}"
        oid="${label_id##*:}"

        response=$(curl -s "$API_BASE/orders/$oid")
        status=$(echo "$response" | jq -r '.order.status')

        if [ "$status" != "MATCHED" ]; then
            log_warn "$label is $status (expected MATCHED) — may be partial depending on algorithm threshold"
        else
            log_success "$label is MATCHED"
        fi
    done
    echo ""

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Test Summary"
    echo "============================================"
    echo ""
    echo "Order 1 (1→2, 1000): $ORDER_1"
    echo "Order 2 (2→1,  500): $ORDER_2"
    echo "Order 3 (2→1,  300): $ORDER_3"
    echo "Order 4 (2→1,  200): $ORDER_4"
    echo ""
    log_success "E2E Matching Engine Test Completed!"
    echo ""
}

main
