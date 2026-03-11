#!/bin/bash

# E2E Full Flow Test Script
# Tests: Submit intent orders → Match cycles → (Orchestrator creates bridge) → Withdraw → Verify
#
# Flow:
#   1. Submit 4 intent orders (A: 1→2 1000, B: 2→1 500, C: 2→1 300, D: 2→1 200)
#   2. Wait for matching engine to produce cycles
#   3. Wait for orchestrator to create HTLC orders on-chain (automatic)
#   4. Withdraw using execution details from API
#   5. Verify balances for all 4 users

set -e

# Load .env from project root if available
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
if [ -f "$PROJECT_ROOT/.env" ]; then
    set -a
    source "$PROJECT_ROOT/.env"
    set +a
fi

# Configuration
API_BASE="http://localhost:3001/api"
MATCH_INTERVAL_MS="${MATCH_INTERVAL_MS:-5000}"

# Chain IDs (Sepolia & Base Sepolia)
CHAIN_1=11155111
CHAIN_2=84532
CHAIN_1_KEY="sepolia"
CHAIN_2_KEY="baseSepolia"

# Amounts: intent uses human-readable
AMOUNT_1000="1000"
AMOUNT_500="500"
AMOUNT_300="300"
AMOUNT_200="200"

# Minimum balances required (6 decimals)
MIN_BALANCE_A=1000000000   # 1000 USDC on chain1
MIN_BALANCE_B=500000000    # 500 USDC on chain2
MIN_BALANCE_C=300000000    # 300 USDC on chain2
MIN_BALANCE_D=200000000    # 200 USDC on chain2

# User addresses
USER_A_ADDRESS="0x9B55124d945B6E61c521adD7aA213433b3b1c8a2"
USER_B_ADDRESS="0x3ACa6E32BD6268ba2b834e6F23405e10575d19B2"
USER_C_ADDRESS="0x7CB386178D13e21093FDc988C7e77102D6464F3E"
USER_D_ADDRESS="0xE08745df99d3563821b633aA93Ee02F7F883F25c"

# Deadline: 10 minutes from now
DEADLINE=$(( $(date +%s) + 600 ))

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_info()    { echo -e "${BLUE}[INFO]${NC} $1" >&2; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1" >&2; }
log_warn()    { echo -e "${YELLOW}[WARN]${NC} $1" >&2; }
log_error()   { echo -e "${RED}[ERROR]${NC} $1" >&2; }

# Get private key for address (case-insensitive match)
get_private_key() {
    local addr=$1
    local addr_lower=$(echo "$addr" | tr '[:upper:]' '[:lower:]')
    if [ "$addr_lower" = "$(echo "$USER_A_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]; then echo "$PRIVATE_KEY_A"; return; fi
    if [ "$addr_lower" = "$(echo "$USER_B_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]; then echo "$PRIVATE_KEY_B"; return; fi
    if [ "$addr_lower" = "$(echo "$USER_C_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]; then echo "$PRIVATE_KEY_C"; return; fi
    if [ "$addr_lower" = "$(echo "$USER_D_ADDRESS" | tr '[:upper:]' '[:lower:]')" ]; then echo "$PRIVATE_KEY_D"; return; fi
    log_error "Unknown address for private key: $addr"
    exit 1
}

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

check_env() {
    log_info "Checking environment variables..."
    for key in PRIVATE_KEY_A PRIVATE_KEY_B PRIVATE_KEY_C PRIVATE_KEY_D; do
        if [ -z "${!key}" ]; then
            log_error "$key is not set"
            exit 1
        fi
    done
    log_success "Environment variables are set"
}

# Get USDC balance (returns raw value)
get_balance() {
    local chain=$1
    local address=$2

    response=$(curl -s "$API_BASE/usdc/balance/$chain?address=$address")
    balance=$(echo "$response" | jq -r '.balance')

    if [ "$balance" == "null" ] || [ -z "$balance" ]; then
        log_error "Failed to get balance for $address on $chain: $response"
        exit 1
    fi
    echo "$balance"
}

# Check balance meets minimum
check_balance() {
    local chain=$1
    local address=$2
    local min_balance=$3
    local label=$4

    log_info "Checking USDC balance for $label ($address) on $chain..."
    balance=$(get_balance "$chain" "$address")
    log_info "  Balance: $balance (minimum required: $min_balance)"

    if [ "$balance" -lt "$min_balance" ]; then
        log_error "Insufficient balance for $label! Need $min_balance but have $balance"
        exit 1
    fi
    log_success "Balance check passed for $label"
    echo "$balance"
}

# Submit intent order (with privateKey and userAddress)
submit_order() {
    local src=$1 des=$2 amount=$3 private_key=$4 user_address=$5 label=$6

    log_info "Submitting order: $label (${src} -> ${des}, amount ${amount})..."

    response=$(curl -s -X POST "$API_BASE/intent" \
        -H "Content-Type: application/json" \
        -d "{
            \"srcChain\": $src,
            \"desChain\": $des,
            \"amount\": \"$amount\",
            \"deadline\": $DEADLINE,
            \"privateKey\": \"$private_key\",
            \"userAddress\": \"$user_address\"
        }")

    order_id=$(echo "$response" | jq -r '.order.orderId')

    if [ "$order_id" == "null" ] || [ -z "$order_id" ]; then
        log_error "Failed to submit order ($label): $response"
        exit 1
    fi

    log_success "Order submitted ($label) — orderId: $order_id"
    echo "$order_id"
}

# Withdraw from order fill
withdraw_order() {
    local private_key=$1
    local order_id=$2
    local fill_id=$3
    local preimage=$4
    local chain=$5
    local label=$6

    log_info "$label withdrawing from order on $chain..."

    response=$(curl -s -X POST "$API_BASE/bridge/withdraw" \
        -H "Content-Type: application/json" \
        -d "{
            \"privateKey\": \"$private_key\",
            \"orderId\": \"$order_id\",
            \"fillId\": \"$fill_id\",
            \"preimage\": \"$preimage\",
            \"chain\": \"$chain\"
        }")

    success=$(echo "$response" | jq -r '.success')
    if [ "$success" != "true" ]; then
        log_error "Failed to withdraw ($label): $response"
        exit 1
    fi

    tx_hash=$(echo "$response" | jq -r '.data.txHash')
    log_success "$label withdrew successfully (tx: $tx_hash)"
}

# --------------------------------------------------------------------------
# Main
# --------------------------------------------------------------------------

main() {
    echo ""
    echo "============================================"
    echo "  E2E Full Flow Test"
    echo "  Intent → Match → (Orchestrator) → Withdraw → Verify"
    echo "============================================"
    echo ""

    check_deps
    check_env
    echo ""

    # ------------------------------------------------------------------
    # Step 0: Check initial balances (all 4 users)
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 0: Check Initial Balances"
    echo "============================================"

    BALANCE_A_CHAIN1_BEFORE=$(check_balance "$CHAIN_1_KEY" "$USER_A_ADDRESS" "$MIN_BALANCE_A" "User A (chain1)")
    BALANCE_A_CHAIN2_BEFORE=$(get_balance "$CHAIN_2_KEY" "$USER_A_ADDRESS")
    log_info "User A chain2 (before): $BALANCE_A_CHAIN2_BEFORE"
    echo ""
    BALANCE_B_CHAIN2_BEFORE=$(check_balance "$CHAIN_2_KEY" "$USER_B_ADDRESS" "$MIN_BALANCE_B" "User B (chain2)")
    echo ""
    BALANCE_C_CHAIN2_BEFORE=$(check_balance "$CHAIN_2_KEY" "$USER_C_ADDRESS" "$MIN_BALANCE_C" "User C (chain2)")
    echo ""
    BALANCE_D_CHAIN2_BEFORE=$(check_balance "$CHAIN_2_KEY" "$USER_D_ADDRESS" "$MIN_BALANCE_D" "User D (chain2)")
    echo ""

    # ------------------------------------------------------------------
    # Step 1: Submit intent orders
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 1: Submit Intent Orders"
    echo "============================================"

    ORDER_1=$(submit_order "$CHAIN_1" "$CHAIN_2" "$AMOUNT_1000" "$PRIVATE_KEY_A" "$USER_A_ADDRESS" "Order 1 (A: 1→2, 1000)")
    echo ""
    ORDER_2=$(submit_order "$CHAIN_2" "$CHAIN_1" "$AMOUNT_500" "$PRIVATE_KEY_B" "$USER_B_ADDRESS" "Order 2 (B: 2→1, 500)")
    echo ""
    ORDER_3=$(submit_order "$CHAIN_2" "$CHAIN_1" "$AMOUNT_300" "$PRIVATE_KEY_C" "$USER_C_ADDRESS" "Order 3 (C: 2→1, 300)")
    echo ""
    ORDER_4=$(submit_order "$CHAIN_2" "$CHAIN_1" "$AMOUNT_200" "$PRIVATE_KEY_D" "$USER_D_ADDRESS" "Order 4 (D: 2→1, 200)")
    echo ""

    # ------------------------------------------------------------------
    # Step 2: Wait for matching engine tick (cycles)
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 2: Wait for Match Cycles"
    echo "============================================"

    MAX_WAIT_SECS=$(( (MATCH_INTERVAL_MS / 1000) * 3 ))
    POLL_INTERVAL=2
    elapsed=0

    log_info "Polling /api/matches (timeout ${MAX_WAIT_SECS}s)..."

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
        log_error "No match results after ${MAX_WAIT_SECS}s"
        echo "$matches_response" | jq . >&2
        exit 1
    fi

    MATCH_ID=$(echo "$matches_response" | jq -r '.data[0].matchId')
    log_success "Found match: $MATCH_ID"
    echo ""
    echo "Cycle breakdown:"
    echo "$matches_response" | jq -r '
      .data[0] |
      (.cycles | to_entries[] |
        "  Cycle \(.key + 1) — matched amount: \(.value.matchedAmount)",
        (.value.orders[] |
          "    Order \(.orderId | .[0:8])…  \(.srcChain) -> \(.desChain)  amount: \(.matchedAmount)"
        )
      )
    ' >&2
    echo ""

    # ------------------------------------------------------------------
    # Step 3: Wait for orchestrator to create HTLC orders
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 3: Wait for Orchestrator (HTLC Orders)"
    echo "============================================"

    EXEC_WAIT_SECS=30
    elapsed=0

    log_info "Polling /api/match-execution/$MATCH_ID (timeout ${EXEC_WAIT_SECS}s)..."

    while [ "$elapsed" -lt "$EXEC_WAIT_SECS" ]; do
        exec_response=$(curl -s "$API_BASE/match-execution/$MATCH_ID")
        success=$(echo "$exec_response" | jq -r '.success')

        if [ "$success" = "true" ]; then
            break
        fi

        log_info "Orchestrator not done yet (${elapsed}s elapsed), retrying in ${POLL_INTERVAL}s..."
        sleep "$POLL_INTERVAL"
        elapsed=$(( elapsed + POLL_INTERVAL ))
    done

    if [ "$success" != "true" ]; then
        log_error "Match execution not available after ${EXEC_WAIT_SECS}s"
        echo "$exec_response" | jq . >&2
        exit 1
    fi

    log_success "Orchestrator created HTLC orders"
    echo ""

    # ------------------------------------------------------------------
    # Step 4: Verify balances after lock
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 4: Verify Balances After Lock"
    echo "============================================"

    BALANCE_A_CHAIN1_AFTER_LOCK=$(get_balance "$CHAIN_1_KEY" "$USER_A_ADDRESS")
    BALANCE_B_CHAIN2_AFTER_LOCK=$(get_balance "$CHAIN_2_KEY" "$USER_B_ADDRESS")
    BALANCE_C_CHAIN2_AFTER_LOCK=$(get_balance "$CHAIN_2_KEY" "$USER_C_ADDRESS")
    BALANCE_D_CHAIN2_AFTER_LOCK=$(get_balance "$CHAIN_2_KEY" "$USER_D_ADDRESS")

    log_info "User A chain1: $BALANCE_A_CHAIN1_BEFORE -> $BALANCE_A_CHAIN1_AFTER_LOCK (locked 1000)"
    log_info "User B chain2: $BALANCE_B_CHAIN2_BEFORE -> $BALANCE_B_CHAIN2_AFTER_LOCK (locked 500)"
    log_info "User C chain2: $BALANCE_C_CHAIN2_BEFORE -> $BALANCE_C_CHAIN2_AFTER_LOCK (locked 300)"
    log_info "User D chain2: $BALANCE_D_CHAIN2_BEFORE -> $BALANCE_D_CHAIN2_AFTER_LOCK (locked 200)"
    echo ""

    # ------------------------------------------------------------------
    # Step 5: Withdraw (using execution data)
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 5: Withdraw"
    echo "============================================"

    # A withdraws on chain2 from responding orders (B, C, D)

    exec_data=$(echo "$exec_response" | jq -c '.data')
    responding_count=$(echo "$exec_data" | jq '.respondingWithdraws | length')

    for i in $(seq 0 $((responding_count - 1))); do
        order_id=$(echo "$exec_data" | jq -r ".respondingWithdraws[$i].orderId")
        fill_id=$(echo "$exec_data" | jq -r ".respondingWithdraws[$i].fillId")
        chain=$(echo "$exec_data" | jq -r ".respondingWithdraws[$i].chain")
        secret=$(echo "$exec_data" | jq -r ".respondingWithdraws[$i].secret")
        receiver=$(echo "$exec_data" | jq -r ".respondingWithdraws[$i].receiverAddress")
        pk=$(get_private_key "$receiver")
        withdraw_order "$pk" "$order_id" "$fill_id" "$secret" "$chain" "User A (from responding $((i+1)))"
        echo ""
    done

    # B, C, D withdraw on chain1 from presiding order
    presiding_order_id=$(echo "$exec_data" | jq -r '.presidingOrder.orderId')
    presiding_chain=$(echo "$exec_data" | jq -r '.presidingOrder.chain')
    presiding_count=$(echo "$exec_data" | jq '.presidingOrder.withdraws | length')

    for i in $(seq 0 $((presiding_count - 1))); do
        fill_id=$(echo "$exec_data" | jq -r ".presidingOrder.withdraws[$i].fillId")
        secret=$(echo "$exec_data" | jq -r ".presidingOrder.withdraws[$i].secret")
        receiver=$(echo "$exec_data" | jq -r ".presidingOrder.withdraws[$i].receiverAddress")
        pk=$(get_private_key "$receiver")
        withdraw_order "$pk" "$presiding_order_id" "$fill_id" "$secret" "$presiding_chain" "User (presiding fill $((i+1)))"
        echo ""
    done

    # ------------------------------------------------------------------
    # Step 6: Verify final balances
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Step 6: Verify Final Balances"
    echo "============================================"

    BALANCE_A_CHAIN1_FINAL=$(get_balance "$CHAIN_1_KEY" "$USER_A_ADDRESS")
    BALANCE_A_CHAIN2_FINAL=$(get_balance "$CHAIN_2_KEY" "$USER_A_ADDRESS")
    BALANCE_B_CHAIN1_FINAL=$(get_balance "$CHAIN_1_KEY" "$USER_B_ADDRESS")
    BALANCE_B_CHAIN2_FINAL=$(get_balance "$CHAIN_2_KEY" "$USER_B_ADDRESS")
    BALANCE_C_CHAIN1_FINAL=$(get_balance "$CHAIN_1_KEY" "$USER_C_ADDRESS")
    BALANCE_C_CHAIN2_FINAL=$(get_balance "$CHAIN_2_KEY" "$USER_C_ADDRESS")
    BALANCE_D_CHAIN1_FINAL=$(get_balance "$CHAIN_1_KEY" "$USER_D_ADDRESS")
    BALANCE_D_CHAIN2_FINAL=$(get_balance "$CHAIN_2_KEY" "$USER_D_ADDRESS")

    log_info "User A: chain1=$BALANCE_A_CHAIN1_FINAL (sent 1000), chain2=$BALANCE_A_CHAIN2_FINAL (received 1000)"
    log_info "User B: chain1=$BALANCE_B_CHAIN1_FINAL (received 500), chain2=$BALANCE_B_CHAIN2_FINAL (sent 500)"
    log_info "User C: chain1=$BALANCE_C_CHAIN1_FINAL (received 300), chain2=$BALANCE_C_CHAIN2_FINAL (sent 300)"
    log_info "User D: chain1=$BALANCE_D_CHAIN1_FINAL (received 200), chain2=$BALANCE_D_CHAIN2_FINAL (sent 200)"

    # Verify expected changes (allow small tolerance for rounding)
    TOLERANCE=1000
    EXPECTED_A_CHAIN1=$((BALANCE_A_CHAIN1_BEFORE - 1000000000))
    EXPECTED_A_CHAIN2=$((BALANCE_A_CHAIN2_BEFORE + 1000000000))

    if [ "$BALANCE_A_CHAIN1_FINAL" -lt $((EXPECTED_A_CHAIN1 - TOLERANCE)) ]; then
        log_error "User A chain1: expected ~$EXPECTED_A_CHAIN1, got $BALANCE_A_CHAIN1_FINAL"
        exit 1
    fi
    if [ "$BALANCE_A_CHAIN2_FINAL" -lt $((EXPECTED_A_CHAIN2 - TOLERANCE)) ]; then
        log_error "User A chain2: expected ~$EXPECTED_A_CHAIN2 (received 1000), got $BALANCE_A_CHAIN2_FINAL"
        exit 1
    fi
    if [ "$BALANCE_B_CHAIN1_FINAL" -lt $((500000000 - TOLERANCE)) ]; then
        log_error "User B chain1 should have received ~500 USDC, got $BALANCE_B_CHAIN1_FINAL"
        exit 1
    fi
    if [ "$BALANCE_C_CHAIN1_FINAL" -lt $((300000000 - TOLERANCE)) ]; then
        log_error "User C chain1 should have received ~300 USDC, got $BALANCE_C_CHAIN1_FINAL"
        exit 1
    fi
    if [ "$BALANCE_D_CHAIN1_FINAL" -lt $((200000000 - TOLERANCE)) ]; then
        log_error "User D chain1 should have received ~200 USDC, got $BALANCE_D_CHAIN1_FINAL"
        exit 1
    fi

    log_success "All balance verifications passed!"
    echo ""

    # ------------------------------------------------------------------
    # Summary
    # ------------------------------------------------------------------
    echo "============================================"
    echo "  Test Summary"
    echo "============================================"
    echo ""
    echo "Intent Orders:"
    echo "  Order 1 (A, 1→2, 1000): $ORDER_1"
    echo "  Order 2 (B, 2→1,  500): $ORDER_2"
    echo "  Order 3 (C, 2→1,  300): $ORDER_3"
    echo "  Order 4 (D, 2→1,  200): $ORDER_4"
    echo ""
    echo "Match ID: $MATCH_ID"
    echo "Presiding order: $presiding_order_id"
    echo ""
    log_success "E2E Full Flow Test Completed Successfully!"
    echo ""
}

main
