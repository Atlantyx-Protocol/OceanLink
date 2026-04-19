#!/bin/bash

# E2E Liquidity Market Service Test
# Verifies that a user intent order gets matched against LP liquidity
# and checks on-chain USDC balances before/after on both chains.
#
# Prerequisites:
#   - Backend running with LP keys (PRIVATE_KEY_B, PRIVATE_KEY_C, PRIVATE_KEY_D)
#   - PRIVATE_KEY_TESTER set in .env (funded with USDC on Sepolia)
#   - MATCH_INTERVAL_MS can be set to speed up the test (e.g. 2000)
#
# Usage:
#   bash scripts/e2e-liquidity-test.sh

set -e

API_BASE="http://localhost:3001/api"
MATCH_INTERVAL_MS="${MATCH_INTERVAL_MS:-5000}"

# Chain IDs
SEPOLIA=11155111
BASE_SEPOLIA=84532
ARBITRUM_SEPOLIA=421614

DEADLINE=$(( $(date +%s) + 600 ))

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1" >&2; }
log_success() { echo -e "${GREEN}[PASS]${NC} $1" >&2; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error()   { echo -e "${RED}[FAIL]${NC} $1" >&2; }

PASS=0
FAIL=0

assert_eq() {
    local actual=$1 expected=$2 msg=$3
    if [ "$actual" == "$expected" ]; then
        log_success "$msg"
        PASS=$(( PASS + 1 ))
    else
        log_error "$msg — expected '$expected', got '$actual'"
        FAIL=$(( FAIL + 1 ))
    fi
}

# Chain ID -> API chain key mapping
chain_key_for() {
    case "$1" in
        11155111) echo "sepolia" ;;
        84532)    echo "baseSepolia" ;;
        421614)   echo "arbitrumSepolia" ;;
        *)        echo "unknown" ;;
    esac
}

# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------

check_deps() {
    for cmd in jq curl bc; do
        if ! command -v "$cmd" &>/dev/null; then
            log_error "$cmd is not installed"
            exit 1
        fi
    done
}

check_server() {
    if ! curl -s --max-time 2 "$API_BASE/matches" > /dev/null 2>&1; then
        log_error "Backend not reachable at $API_BASE — is the server running?"
        exit 1
    fi
}

get_balance() {
    local chain_key=$1 addr=$2
    local resp
    resp=$(curl -s "$API_BASE/usdc/balance/$chain_key?address=$addr")
    echo "$resp" | jq -r '.balance'
}

derive_address() {
    local pk=$1
    local resp
    resp=$(curl -s -X POST "$API_BASE/usdc/wallet-address" \
        -H "Content-Type: application/json" \
        -d "{\"privateKey\": \"$pk\"}")
    echo "$resp" | jq -r '.address'
}

approve_usdc() {
    local chain_key=$1 pk=$2
    local resp
    resp=$(curl -s -X POST "$API_BASE/usdc/approve/$chain_key" \
        -H "Content-Type: application/json" \
        -d "{\"privateKey\": \"$pk\"}")
    local success
    success=$(echo "$resp" | jq -r '.success')
    if [ "$success" != "true" ]; then
        log_error "USDC approve on $chain_key failed: $resp"
        return 1
    fi
    local tx_hash
    tx_hash=$(echo "$resp" | jq -r '.txHash')
    log_info "Approved USDC on $chain_key (tx: $tx_hash)"
}

submit_order() {
    local src=$1 des=$2 amount=$3 addr=$4

    response=$(curl -s -X POST "$API_BASE/intent" \
        -H "Content-Type: application/json" \
        -d "{
            \"srcChain\": $src,
            \"desChain\": $des,
            \"amount\": \"$amount\",
            \"deadline\": $DEADLINE,
            \"userAddress\": \"$addr\"
        }")

    order_id=$(echo "$response" | jq -r '.order.orderId')

    if [ "$order_id" == "null" ] || [ -z "$order_id" ]; then
        log_error "Failed to submit order: $response"
        exit 1
    fi

    echo "$order_id"
}

poll_order_status() {
    local order_id=$1 expected=$2 timeout_secs=$3
    local elapsed=0

    while [ "$elapsed" -lt "$timeout_secs" ]; do
        status=$(curl -s "$API_BASE/orders/$order_id" | jq -r '.order.status')
        if [ "$status" == "$expected" ]; then
            echo "$status"
            return 0
        fi
        sleep 2
        elapsed=$(( elapsed + 2 ))
    done

    echo "$status"
    return 1
}

poll_execution_done() {
    local match_id=$1 timeout_secs=$2
    local elapsed=0

    while [ "$elapsed" -lt "$timeout_secs" ]; do
        exec_status=$(curl -s "$API_BASE/match-execution/$match_id" | jq -r '.status')
        if [ "$exec_status" == "done" ]; then
            echo "done"
            return 0
        fi
        if [ "$exec_status" == "error" ]; then
            echo "error"
            return 1
        fi
        sleep 3
        elapsed=$(( elapsed + 3 ))
    done

    echo "$exec_status"
    return 1
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

main() {
    echo ""
    echo "============================================"
    echo "  Liquidity Market Service — E2E Test"
    echo "============================================"
    echo ""

    check_deps
    check_server

    # ------------------------------------------------------------------
    # Step 0: Resolve tester wallet
    # ------------------------------------------------------------------
    if [ -z "$PRIVATE_KEY_TESTER" ]; then
        log_error "PRIVATE_KEY_TESTER is not set"
        exit 1
    fi

    USER_ADDR=$(derive_address "$PRIVATE_KEY_TESTER")
    if [ "$USER_ADDR" == "null" ] || [ -z "$USER_ADDR" ]; then
        log_error "Failed to derive address from PRIVATE_KEY_TESTER"
        exit 1
    fi
    log_info "Tester wallet: $USER_ADDR"

    USER_AMOUNT=1298
    MAX_WAIT=$(( (MATCH_INTERVAL_MS / 1000) * 3 + 2 ))

    SRC_KEY=$(chain_key_for "$SEPOLIA")
    DES_KEY=$(chain_key_for "$BASE_SEPOLIA")

    # ------------------------------------------------------------------
    # Step 1: Approve USDC on source chain
    # ------------------------------------------------------------------
    log_info "Approving USDC on source chain ($SRC_KEY)..."
    approve_usdc "$SRC_KEY" "$PRIVATE_KEY_TESTER"
    echo ""

    # ------------------------------------------------------------------
    # Step 2: Record balances BEFORE submitting the order
    # ------------------------------------------------------------------
    log_info "Fetching USDC balances before order submission..."

    SRC_BALANCE_BEFORE=$(get_balance "$SRC_KEY" "$USER_ADDR")
    DES_BALANCE_BEFORE=$(get_balance "$DES_KEY" "$USER_ADDR")

    log_info "Source ($SRC_KEY)      balance before: $SRC_BALANCE_BEFORE"
    log_info "Destination ($DES_KEY) balance before: $DES_BALANCE_BEFORE"

    if [ "$SRC_BALANCE_BEFORE" == "0" ]; then
        log_warn "Source balance is 0 — tester wallet may not be funded with USDC on $SRC_KEY"
    fi
    echo ""

    # ------------------------------------------------------------------
    # Step 3: Submit a user intent order
    # ------------------------------------------------------------------
    log_info "Submitting user intent: Sepolia -> Base Sepolia, amount=$USER_AMOUNT"

    ORDER_ID=$(submit_order "$SEPOLIA" "$BASE_SEPOLIA" "$USER_AMOUNT" "$USER_ADDR")
    log_info "Order created: $ORDER_ID"
    echo ""

    # Verify order is QUEUED
    status=$(curl -s "$API_BASE/orders/$ORDER_ID" | jq -r '.order.status')
    assert_eq "$status" "QUEUED" "Order starts as QUEUED"

    # ------------------------------------------------------------------
    # Step 4: Wait for matching engine tick
    # ------------------------------------------------------------------
    log_info "Waiting up to ${MAX_WAIT}s for matching..."

    final_status=$(poll_order_status "$ORDER_ID" "MATCHED" "$MAX_WAIT") || true
    assert_eq "$final_status" "MATCHED" "User order (amount=$USER_AMOUNT) is MATCHED by LP liquidity"

    # ------------------------------------------------------------------
    # Step 5: Verify match result in /matches
    # ------------------------------------------------------------------
    matches=$(curl -s "$API_BASE/matches")
    match_count=$(echo "$matches" | jq '[.data[].orders[] | select(.orderId == "'"$ORDER_ID"'")] | length')
    assert_eq "$([ "$match_count" -gt 0 ] && echo 'yes' || echo 'no')" "yes" "Order appears in /matches results"

    # Show matched amount
    matched_amount=$(echo "$matches" | jq -r '[.data[].orders[] | select(.orderId == "'"$ORDER_ID"'")] | first | .matchedAmount')
    log_info "Matched amount: $matched_amount (expected: $USER_AMOUNT)"

    # Extract matchId for the match containing our order
    MATCH_ID=$(echo "$matches" | jq -r '[.data[] | select(.orders[] | .orderId == "'"$ORDER_ID"'")] | first | .matchId')
    log_info "Match ID: $MATCH_ID"
    echo ""

    # ------------------------------------------------------------------
    # Step 6: Wait for on-chain execution (HTLC bridge + withdraw)
    # ------------------------------------------------------------------
    EXEC_TIMEOUT=300
    log_info "Waiting up to ${EXEC_TIMEOUT}s for on-chain execution..."

    exec_result=$(poll_execution_done "$MATCH_ID" "$EXEC_TIMEOUT") || true
    assert_eq "$exec_result" "done" "On-chain execution completed (HTLC bridge + withdraw)"
    echo ""

    # ------------------------------------------------------------------
    # Step 7: Check balances AFTER settlement
    # ------------------------------------------------------------------
    log_info "Fetching USDC balances after settlement..."

    SRC_BALANCE_AFTER=$(get_balance "$SRC_KEY" "$USER_ADDR")
    DES_BALANCE_AFTER=$(get_balance "$DES_KEY" "$USER_ADDR")

    log_info "Source ($SRC_KEY)      balance after: $SRC_BALANCE_AFTER"
    log_info "Destination ($DES_KEY) balance after: $DES_BALANCE_AFTER"
    echo ""

    # Source chain: user should have spent funds (balance decreased)
    src_decreased=$(echo "$SRC_BALANCE_AFTER < $SRC_BALANCE_BEFORE" | bc -l)
    assert_eq "$src_decreased" "1" "Source balance decreased after bridge (spent USDC)"
    log_info "Source balance delta: -$(echo "$SRC_BALANCE_BEFORE - $SRC_BALANCE_AFTER" | bc -l)"

    # Destination chain: user should have received funds (balance increased)
    des_increased=$(echo "$DES_BALANCE_AFTER > $DES_BALANCE_BEFORE" | bc -l)
    assert_eq "$des_increased" "1" "Destination balance increased after bridge (received USDC)"
    log_info "Destination balance delta: +$(echo "$DES_BALANCE_AFTER - $DES_BALANCE_BEFORE" | bc -l)"
    echo ""

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Results: $PASS passed, $FAIL failed"
    echo "============================================"
    echo ""

    if [ "$FAIL" -gt 0 ]; then
        exit 1
    fi
}

main
