#!/bin/bash

# E2E Bridge Test Script
# Tests the full HTLC bridge flow between Sepolia and Base Sepolia
# Updated for new HashedTimelockERC20 contract with orders and fills

set -e

# Configuration
API_BASE="http://localhost:3001/api"
AMOUNT="700000000" # 700 USDC (6 decimals)
MIN_BALANCE="700000000"

# User addresses
USER_A_ADDRESS="0x9B55124d945B6E61c521adD7aA213433b3b1c8a2"
USER_B_ADDRESS="0x3ACa6E32BD6268ba2b834e6F23405e10575d19B2"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_info() {
    echo -e "${BLUE}[INFO]${NC} $1" >&2
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1" >&2
}

log_warn() {
    echo -e "${YELLOW}[WARN]${NC} $1" >&2
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

# Check if required dependencies are installed
check_deps() {
    if ! command -v jq &> /dev/null; then
        log_error "jq is not installed. Please install it: brew install jq"
        exit 1
    fi

    if ! command -v curl &> /dev/null; then
        log_error "curl is not installed"
        exit 1
    fi
}

# Check if required env vars are set
check_env() {
    log_info "Checking environment variables..."

    if [ -z "$PRIVATE_KEY_A" ]; then
        log_error "PRIVATE_KEY_A is not set"
        exit 1
    fi

    if [ -z "$PRIVATE_KEY_B" ]; then
        log_error "PRIVATE_KEY_B is not set"
        exit 1
    fi

    log_success "Environment variables are set"
}

# Check USDC balance
check_balance() {
    local chain=$1
    local address=$2
    local min_balance=$3

    log_info "Checking USDC balance for $address on $chain..."

    response=$(curl -s "$API_BASE/usdc/balance/$chain?address=$address")
    balance=$(echo "$response" | jq -r '.balance')

    if [ "$balance" == "null" ] || [ -z "$balance" ]; then
        log_error "Failed to get balance: $response"
        exit 1
    fi

    log_info "Balance: $balance (minimum required: $min_balance)"

    if [ "$balance" -lt "$min_balance" ]; then
        log_error "Insufficient balance! Need at least $min_balance but have $balance"
        exit 1
    fi

    log_success "Balance check passed"
    echo "$balance"
}

# Create order (presiding - generates secret)
create_order_presiding() {
    local on_behalf_of=$1
    local receiver=$2
    local chain=$3

    log_info "Creating order on $chain (presiding - generating secret) on behalf of $on_behalf_of..."

    response=$(curl -s -X POST "$API_BASE/bridge/create" \
        -H "Content-Type: application/json" \
        -d "{
            \"receivers\": [\"$receiver\"],
            \"amounts\": [\"$AMOUNT\"],
            \"chain\": \"$chain\",
            \"isPresiding\": true,
            \"onBehalfOf\": \"$on_behalf_of\"
        }")

    success=$(echo "$response" | jq -r '.success')

    if [ "$success" != "true" ]; then
        log_error "Failed to create order: $response"
        exit 1
    fi

    order_id=$(echo "$response" | jq -r '.data.orderId')
    fill_id=$(echo "$response" | jq -r '.data.fills[0].fillId')
    secret=$(echo "$response" | jq -r '.data.fills[0].secret')
    hashlock=$(echo "$response" | jq -r '.data.fills[0].hashlock')
    tx_hash=$(echo "$response" | jq -r '.data.htlcTxHash')

    log_success "Order created on $chain"
    echo "  Order ID: $order_id" >&2
    echo "  Fill ID: $fill_id" >&2
    echo "  Secret: $secret" >&2
    echo "  Hashlock: $hashlock" >&2
    echo "  TX Hash: $tx_hash" >&2

    # Return values via global variables
    PRESIDING_ORDER_ID="$order_id"
    PRESIDING_FILL_ID="$fill_id"
    PRESIDING_SECRET="$secret"
    PRESIDING_HASHLOCK="$hashlock"
}

# Create order (responding - uses existing hashlock)
create_order_responding() {
    local on_behalf_of=$1
    local receiver=$2
    local chain=$3
    local hashlock=$4

    log_info "Creating order on $chain (responding - using existing hashlock) on behalf of $on_behalf_of..."

    response=$(curl -s -X POST "$API_BASE/bridge/create" \
        -H "Content-Type: application/json" \
        -d "{
            \"receivers\": [\"$receiver\"],
            \"amounts\": [\"$AMOUNT\"],
            \"chain\": \"$chain\",
            \"isPresiding\": false,
            \"hashlocks\": [\"$hashlock\"],
            \"onBehalfOf\": \"$on_behalf_of\"
        }")

    success=$(echo "$response" | jq -r '.success')

    if [ "$success" != "true" ]; then
        log_error "Failed to create order: $response"
        exit 1
    fi

    order_id=$(echo "$response" | jq -r '.data.orderId')
    fill_id=$(echo "$response" | jq -r '.data.fills[0].fillId')
    tx_hash=$(echo "$response" | jq -r '.data.htlcTxHash')

    log_success "Order created on $chain"
    echo "  Order ID: $order_id" >&2
    echo "  Fill ID: $fill_id" >&2
    echo "  TX Hash: $tx_hash" >&2

    # Return values via global variables
    RESPONDING_ORDER_ID="$order_id"
    RESPONDING_FILL_ID="$fill_id"
}

# Approve USDC for HTLC contract on a specific chain
approve_usdc() {
    local private_key=$1
    local chain=$2
    local amount=$3
    local user_name=$4

    log_info "Approving $amount USDC for $user_name on $chain..."

    response=$(curl -s -X POST "$API_BASE/usdc/approve/$chain" \
        -H "Content-Type: application/json" \
        -d "{
            \"privateKey\": \"$private_key\",
            \"amount\": \"$amount\"
        }")

    success=$(echo "$response" | jq -r '.success')

    if [ "$success" != "true" ]; then
        log_error "Failed to approve USDC: $response"
        exit 1
    fi

    status=$(echo "$response" | jq -r '.result.status')
    log_success "$user_name USDC approval on $chain: $status"
}

# Verify order exists on-chain
verify_order() {
    local order_id=$1
    local chain=$2
    local label=$3

    log_info "Verifying order $order_id on $chain ($label)..."

    response=$(curl -s "$API_BASE/bridge/order/$order_id?chain=$chain")
    success=$(echo "$response" | jq -r '.success')

    if [ "$success" != "true" ]; then
        log_error "Failed to get order: $response"
        exit 1
    fi

    status=$(echo "$response" | jq -r '.data.status')
    fill_count=$(echo "$response" | jq -r '.data.fillCount')
    total_amount=$(echo "$response" | jq -r '.data.totalAmount')
    sender=$(echo "$response" | jq -r '.data.sender')

    # status 1 = OPEN
    if [ "$status" != "1" ]; then
        log_error "Order $order_id is not OPEN (status=$status)"
        exit 1
    fi

    log_success "$label verified — status=OPEN, fills=$fill_count, totalAmount=$total_amount, sender=$sender"
}

# Withdraw from order fill
withdraw_order() {
    local order_id=$1
    local fill_id=$2
    local preimage=$3
    local chain=$4
    local user_name=$5

    log_info "$user_name withdrawing from order on $chain..."

    response=$(curl -s -X POST "$API_BASE/bridge/withdraw" \
        -H "Content-Type: application/json" \
        -d "{
            \"orderId\": \"$order_id\",
            \"fillId\": \"$fill_id\",
            \"preimage\": \"$preimage\",
            \"chain\": \"$chain\"
        }")

    success=$(echo "$response" | jq -r '.success')

    if [ "$success" != "true" ]; then
        log_error "Failed to withdraw: $response"
        exit 1
    fi

    tx_hash=$(echo "$response" | jq -r '.data.txHash')
    block_number=$(echo "$response" | jq -r '.data.blockNumber')

    log_success "$user_name successfully withdrew from $chain"
    echo "  TX Hash: $tx_hash" >&2
    echo "  Block: $block_number" >&2
}

# Main test flow
main() {
    echo ""
    echo "=========================================="
    echo "  HTLC Bridge E2E Test (New Contract)"
    echo "=========================================="
    echo ""

    # Step 0: Check dependencies and environment
    check_deps
    check_env
    echo ""

    # Step 1: Check initial balances
    echo "=========================================="
    echo "  Step 1: Check Initial Balances"
    echo "=========================================="

    BALANCE_A_BEFORE=$(check_balance "sepolia" "$USER_A_ADDRESS" "$MIN_BALANCE")
    echo ""
    BALANCE_B_BEFORE=$(check_balance "baseSepolia" "$USER_B_ADDRESS" "$MIN_BALANCE")
    echo ""

    # Step 1.5: Approve USDC for HTLC contract
    echo "=========================================="
    echo "  Step 1.5: Approve USDC for HTLC"
    echo "=========================================="

    approve_usdc "$PRIVATE_KEY_A" "sepolia" "$AMOUNT" "User A"
    echo ""
    approve_usdc "$PRIVATE_KEY_B" "baseSepolia" "$AMOUNT" "User B"
    echo ""

    # Step 2: User A creates order on Sepolia (presiding)
    echo "=========================================="
    echo "  Step 2: User A Creates Order on Sepolia"
    echo "=========================================="

    create_order_presiding "$USER_A_ADDRESS" "$USER_B_ADDRESS" "sepolia"
    echo ""

    # Store important values
    echo -e "${YELLOW}>>> IMPORTANT: Store these values <<<${NC}"
    echo "SEPOLIA_ORDER_ID=$PRESIDING_ORDER_ID"
    echo "SEPOLIA_FILL_ID=$PRESIDING_FILL_ID"
    echo "SECRET=$PRESIDING_SECRET"
    echo "HASHLOCK=$PRESIDING_HASHLOCK"
    echo ""

    # Step 3: User B creates order on Base Sepolia (responding)
    echo "=========================================="
    echo "  Step 3: User B Creates Order on Base Sepolia"
    echo "=========================================="

    create_order_responding "$USER_B_ADDRESS" "$USER_A_ADDRESS" "baseSepolia" "$PRESIDING_HASHLOCK"
    echo ""

    echo "BASE_SEPOLIA_ORDER_ID=$RESPONDING_ORDER_ID"
    echo "BASE_SEPOLIA_FILL_ID=$RESPONDING_FILL_ID"
    echo ""

    # Step 3.5: Verify orders on-chain
    echo "=========================================="
    echo "  Step 3.5: Verify Orders On-Chain"
    echo "=========================================="

    verify_order "$PRESIDING_ORDER_ID" "sepolia" "Sepolia order (presiding)"
    echo ""
    verify_order "$RESPONDING_ORDER_ID" "baseSepolia" "Base Sepolia order (responding)"
    echo ""

    # Step 4: Re-check balances
    echo "=========================================="
    echo "  Step 4: Verify Balances After Lock"
    echo "=========================================="

    BALANCE_A_AFTER_LOCK=$(check_balance "sepolia" "$USER_A_ADDRESS" "0")
    echo "User A balance change: $BALANCE_A_BEFORE -> $BALANCE_A_AFTER_LOCK"
    echo ""

    BALANCE_B_AFTER_LOCK=$(check_balance "baseSepolia" "$USER_B_ADDRESS" "0")
    echo "User B balance change: $BALANCE_B_BEFORE -> $BALANCE_B_AFTER_LOCK"
    echo ""

    # Step 5: User A withdraws on Base Sepolia
    echo "=========================================="
    echo "  Step 5: User A Withdraws on Base Sepolia"
    echo "=========================================="

    withdraw_order "$RESPONDING_ORDER_ID" "$RESPONDING_FILL_ID" "$PRESIDING_SECRET" "baseSepolia" "User A"
    echo ""

    # Step 6: User B withdraws on Sepolia (using revealed secret)
    echo "=========================================="
    echo "  Step 6: User B Withdraws on Sepolia"
    echo "=========================================="

    withdraw_order "$PRESIDING_ORDER_ID" "$PRESIDING_FILL_ID" "$PRESIDING_SECRET" "sepolia" "User B"
    echo ""

    # Step 7: Final balance check
    echo "=========================================="
    echo "  Step 7: Final Balance Check"
    echo "=========================================="

    BALANCE_A_FINAL=$(check_balance "baseSepolia" "$USER_A_ADDRESS" "0")
    log_info "User A received on Base Sepolia: $BALANCE_A_FINAL"
    echo ""

    BALANCE_B_FINAL=$(check_balance "sepolia" "$USER_B_ADDRESS" "0")
    log_info "User B received on Sepolia: $BALANCE_B_FINAL"
    echo ""

    # Summary
    echo "=========================================="
    echo "  Test Summary"
    echo "=========================================="
    echo ""
    log_success "E2E Bridge Test Completed Successfully!"
    echo ""
    echo "Sepolia Order ID: $PRESIDING_ORDER_ID"
    echo "Sepolia Fill ID: $PRESIDING_FILL_ID"
    echo "Base Sepolia Order ID: $RESPONDING_ORDER_ID"
    echo "Base Sepolia Fill ID: $RESPONDING_FILL_ID"
    echo "Secret (preimage): $PRESIDING_SECRET"
    echo "Hashlock: $PRESIDING_HASHLOCK"
    echo ""
}

# Run main
main
