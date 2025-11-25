# OceanLink - Cross-Chain Stablecoin Netting Protocol MVP

OceanLink is an MVP for a cross-chain stablecoin netting protocol that allows users to create intents to bridge USDC between chains, with an off-chain solver finding netting opportunities and an executor performing local transfers on Vault contracts.

## Architecture

- **Contracts**: Vault.sol deployed on each chain (Base, Arbitrum) managing internal balances
- **Orderbook API**: Receives and stores user intents with EIP-712 signatures
- **Solver**: Background worker that finds netting opportunities between opposite flows
- **Executor**: Background worker that executes transfers on Vault contracts
- **Frontend**: Next.js dApp for creating intents and viewing status

## Prerequisites

- Node.js 18+
- pnpm 8+
- Foundry (for contracts)
- PostgreSQL 15+ (or use Docker Compose)
- Two local anvil instances OR testnet RPCs (Base Sepolia, Arbitrum Sepolia)

## Quick Start

### 1. Install Dependencies

```bash
pnpm install
```

### 2. Set Up Database

Using Docker Compose:

```bash
cd docker
docker-compose up -d
```

Or use your own PostgreSQL instance and set `DATABASE_URL` in backend services.

### 3. Set Up Database Schema

Run migrations for each backend service (they share the same schema):

```bash
cd backend/orderbook
pnpm db:generate
pnpm db:migrate
```

### 4. Deploy Contracts

#### Local Development (Anvil)

Start two anvil instances:

```bash
# Terminal 1 - Base (chain ID 31337)
anvil --port 8545 --chain-id 31337

# Terminal 2 - Arbitrum (chain ID 31338)
anvil --port 8546 --chain-id 31338
```

Deploy Vault contracts:

```bash
cd contracts

# Deploy to Base (anvil)
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url http://localhost:8545 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --env-file .env.base

# Deploy to Arbitrum (anvil)
forge script script/Deploy.s.sol:DeployScript \
  --rpc-url http://localhost:8546 \
  --broadcast \
  --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 \
  --env-file .env.arbitrum
```

Create `.env.base` and `.env.arbitrum` files:

```bash
# .env.base
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
TOKEN_ADDRESS=0x... # Deploy a mock USDC or use existing
EXECUTOR_ADDRESS=0x... # Your executor address
```

#### Testnet Deployment

For Base Sepolia and Arbitrum Sepolia, update the RPC URLs and deploy similarly.

### Deployed Contracts

#### Base Sepolia

- **RPC URL**: `https://base-sepolia.g.alchemy.com/v2/iJNCam89D3waZumSzuSgR`
- **Token Address**: `0xCdBb9C109Da8FF1423C753A9D4cEb85d680DC0fa`
- **Executor Address**: `0x9b55124d945b6e61c521add7aa213433b3b1c8a2`
- **Vault Address**: `0xAa7A0f08cF8E7456DEb46A09a9C77b531C278f3c`

#### Sepolia

- **RPC URL**: `https://eth-sepolia.g.alchemy.com/v2/iJNCam89D3waZumSzuSgR`
- **Token Address**: `0xDB6676239269Ae5b8665d9eF9656D6b272A8C7A8`
- **Executor Address**: `0x9b55124d945b6e61c521add7aa213433b3b1c8a2`
- **Vault Address**: `0x3A0568585d83cb3c5349B9aB0F957Ec054177dB0`

### 5. Configure Backend Services

Create `.env` files for each backend service:

**backend/orderbook/.env**:
```env
DATABASE_URL="postgresql://oceanlink:oceanlink@localhost:5432/oceanlink?schema=public"
PORT=3001
```

**backend/solver/.env**:
```env
DATABASE_URL="postgresql://oceanlink:oceanlink@localhost:5432/oceanlink?schema=public"
SOLVER_INTERVAL_MS=5000
```

**backend/executor/.env**:
```env
DATABASE_URL="postgresql://oceanlink:oceanlink@localhost:5432/oceanlink?schema=public"
EXECUTOR_INTERVAL_MS=10000
EXECUTOR_PRIVATE_KEY=0x... # Private key of executor wallet
BASE_RPC_URL=http://localhost:8545
ARBITRUM_RPC_URL=http://localhost:8546
BASE_VAULT_ADDRESS=0x... # Deployed Vault address on Base
ARBITRUM_VAULT_ADDRESS=0x... # Deployed Vault address on Arbitrum
```

For testnet deployment, use:
```env
BASE_RPC_URL=https://base-sepolia.g.alchemy.com/v2/iJNCam89D3waZumSzuSgR
SEPOLIA_RPC_URL=https://eth-sepolia.g.alchemy.com/v2/iJNCam89D3waZumSzuSgR
BASE_VAULT_ADDRESS=0xAa7A0f08cF8E7456DEb46A09a9C77b531C278f3c
SEPOLIA_VAULT_ADDRESS=0x3A0568585d83cb3c5349B9aB0F957Ec054177dB0
```

### 6. Start Services

In separate terminals:

```bash
# Terminal 1: Orderbook API
pnpm dev:orderbook

# Terminal 2: Solver
pnpm dev:solver

# Terminal 3: Executor
pnpm dev:executor

# Terminal 4: Frontend
pnpm dev:frontend
```

### 7. Use the Frontend

1. Open http://localhost:3000
2. Connect your wallet
3. Create an intent:
   - Select source and destination chains
   - Enter amount in USDC
   - Sign the EIP-712 message
4. View your intents in the "My Intents" section

## Project Structure

```
ocean-link/
├── contracts/          # Foundry project
│   ├── src/
│   │   └── Vault.sol
│   ├── test/
│   └── script/
├── backend/
│   ├── orderbook/      # HTTP API for intents
│   ├── solver/         # Netting solver worker
│   └── executor/       # Execution worker
├── frontend/           # Next.js dApp
├── docker/             # Docker Compose setup
└── README.md
```

## Testing

### Contracts

```bash
cd contracts
forge test
```

### Backend

Backend tests are not yet implemented. You can test manually via the API:

```bash
# Create an intent
curl -X POST http://localhost:3001/intents \
  -H "Content-Type: application/json" \
  -d '{
    "intent": {
      "user": "0x...",
      "srcChainId": "84532",
      "dstChainId": "421614",
      "token": "0x...",
      "amount": "1000000",
      "minAmountOut": "1000000",
      "expiry": "1735689600",
      "nonce": "1234567890"
    },
    "signature": "0x..."
  }'

# List intents
curl http://localhost:3001/intents?user_address=0x...
```

## Environment Variables

### Orderbook
- `DATABASE_URL`: PostgreSQL connection string
- `PORT`: API server port (default: 3001)

### Solver
- `DATABASE_URL`: PostgreSQL connection string
- `SOLVER_INTERVAL_MS`: Solver run interval in milliseconds (default: 5000)

### Executor
- `DATABASE_URL`: PostgreSQL connection string
- `EXECUTOR_INTERVAL_MS`: Executor run interval in milliseconds (default: 10000)
- `EXECUTOR_PRIVATE_KEY`: Private key of executor wallet
- `BASE_RPC_URL`: RPC URL for Base chain
- `SEPOLIA_RPC_URL`: RPC URL for Sepolia chain
- `ARBITRUM_RPC_URL`: RPC URL for Arbitrum chain
- `BASE_VAULT_ADDRESS`: Vault contract address on Base
- `SEPOLIA_VAULT_ADDRESS`: Vault contract address on Sepolia
- `ARBITRUM_VAULT_ADDRESS`: Vault contract address on Arbitrum

### Frontend
- `NEXT_PUBLIC_ORDERBOOK_API_URL`: Orderbook API URL (default: http://localhost:3001)

## Development Notes

- The MVP uses a simple greedy netting algorithm. More sophisticated solvers can be implemented later.
- For local development, you can use two anvil instances with different chain IDs.
- The executor requires sufficient gas tokens on both chains.
- Intent expiry is validated before execution.

## License

MIT

