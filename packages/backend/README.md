# Ocean Link Backend

Backend service for interacting with HTLC contracts across multiple chains.

## Setup

```bash
# Install dependencies
pnpm install

# Copy env file and configure
cp .env.example .env

# Start development server
pnpm dev
```

## Environment Variables

```env
PRIVATE_KEY=0x...                    # Wallet private key
PRIVATE_KEY_A=0x...                  # Wallet A private key (for bridge)
SEPOLIA_RPC_URL=https://...          # Ethereum Sepolia RPC
ARBITRUM_SEPOLIA_RPC_URL=https://... # Arbitrum Sepolia RPC
BASE_SEPOLIA_RPC_URL=https://...     # Base Sepolia RPC
```

## Scripts

```bash
# Approve USDC for all chains
pnpm approve

# Approve for specific chain
pnpm approve:sepolia
pnpm approve:arbitrum
pnpm approve:base
```

## API Endpoints

### Health

| Method | Endpoint      | Description  |
| ------ | ------------- | ------------ |
| GET    | `/api/health` | Health check |
| GET    | `/api/ping`   | Ping         |

### Approval

| Method | Endpoint                   | Description                    |
| ------ | -------------------------- | ------------------------------ |
| POST   | `/api/approval/all`        | Approve USDC on all chains     |
| POST   | `/api/approval/:chain`     | Approve USDC on specific chain |
| GET    | `/api/approval/allowances` | Get current allowances         |
| GET    | `/api/approval/chains`     | List available chains          |

### HTLC

| Method | Endpoint                  | Description                  |
| ------ | ------------------------- | ---------------------------- |
| GET    | `/api/htlc/generate-hash` | Generate preimage + hashlock |
| POST   | `/api/htlc/new`           | Create new HTLC              |
| POST   | `/api/htlc/withdraw`      | Withdraw with preimage       |
| POST   | `/api/htlc/refund`        | Refund after timelock        |
| GET    | `/api/htlc/:chain/:id`    | Get HTLC details             |

### Bridge

| Method | Endpoint                      | Description                                     |
| ------ | ----------------------------- | ----------------------------------------------- |
| POST   | `/api/bridge/create`          | Approve USDC + create HTLC (uses PRIVATE_KEY_A) |
| GET    | `/api/bridge/generate-secret` | Generate 256-bit secret + hashlock              |

## Usage Examples

### Create HTLC

```bash
# Generate hash pair
curl http://localhost:3001/api/htlc/generate-hash

# Create HTLC
curl -X POST http://localhost:3001/api/htlc/new \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "sepolia",
    "receiver": "0x...",
    "hashlock": "0x...",
    "timelock": 1234567890,
    "amount": "1000000"
  }'
```

### Withdraw

```bash
curl -X POST http://localhost:3001/api/htlc/withdraw \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "sepolia",
    "contractId": "0x...",
    "preimage": "0x..."
  }'
```

### Refund

```bash
curl -X POST http://localhost:3001/api/htlc/refund \
  -H "Content-Type: application/json" \
  -d '{
    "chain": "sepolia",
    "contractId": "0x..."
  }'
```

### Create Bridge (Approve + HTLC)

```bash
# Create bridge with defaults (receiver = sender A, amount = 700 USDC, timelock = 2h)
curl -X POST http://localhost:3001/api/bridge/create

# Create bridge with custom receiver and amount
curl -X POST http://localhost:3001/api/bridge/create \
  -H "Content-Type: application/json" \
  -d '{
    "receiver": "0x...",
    "amount": "1000000000"
  }'
```

Response:

```json
{
  "success": true,
  "data": {
    "approvalTxHash": "0x...",
    "htlcTxHash": "0x...",
    "contractId": "0x...",
    "secret": "0x...",
    "hashlock": "0x...",
    "sender": "0x...",
    "receiver": "0x...",
    "amount": "700000000",
    "timelock": 1234567890
  }
}
```

## Supported Chains

| Chain            | Key               |
| ---------------- | ----------------- |
| Ethereum Sepolia | `sepolia`         |
| Arbitrum Sepolia | `arbitrumSepolia` |
| Base Sepolia     | `baseSepolia`     |
