#!/bin/bash

# Deploy script for Vault contract
# Usage: ./deploy.sh [network]
# Example: ./deploy.sh localhost

set -e

source .env

forge script script/DeployMockUSDT.s.sol:DeployMockUSDTScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --verify


forge script script/DeployVault.s.sol:DeployVaultScript \
  --rpc-url "$SEPOLIA_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --verify

forge script script/MintUSDT.s.sol:MintUSDTScript \
  --rpc-url "$BASE_RPC_URL" \
  --private-key "$PRIVATE_KEY" \
  --broadcast \
  --verify

# verify contracts
cd contracts
forge verify-contract \
  --chain base-sepolia \
  --compiler-version 0.8.23 \
  0xAa7A0f08cF8E7456DEb46A09a9C77b531C278f3c \
  contracts/src/Vault.sol:Vault \
  --etherscan-api-key $BASESCAN_API_KEY           


echo "Deployment completed!"

