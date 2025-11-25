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

echo "Deployment completed!"

