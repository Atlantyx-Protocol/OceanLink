# Ocean Link Backend

Backend service for interacting with HTLC contracts across multiple chains.

## Setup

The fastest path uses the monorepo `Makefile`, which manages Postgres
(in Docker), applies the schema, and starts both apps in one command:

```bash
# From the monorepo root
pnpm install
cp .env.example .env   # already contains a working DATABASE_URL default
make dev               # boots Postgres → applies schema → runs frontend + backend
```

That's it — no manual `DATABASE_URL` configuration needed if you stick
with the defaults.

### Manual flow (without `make`)

```bash
pnpm install
cp .env.example .env

# Start Postgres yourself (see "Database" below), then:
pnpm --filter @ocean-link/backend db:push
pnpm --filter @ocean-link/backend dev
```

## Environment Variables

```env
PRIVATE_KEY=0x...                    # Wallet private key
PRIVATE_KEY_A=0x...                  # Wallet A private key (for bridge)
SEPOLIA_RPC_URL=https://...          # Ethereum Sepolia RPC
ARBITRUM_SEPOLIA_RPC_URL=https://... # Arbitrum Sepolia RPC
BASE_SEPOLIA_RPC_URL=https://...     # Base Sepolia RPC
DATABASE_URL=postgres://...          # Postgres connection string (default works with `make dev`)
```

## Database

The matching engine and orchestrator persist their state to Postgres
(intent orders, match results, execution records). In-memory caches stay
the source of truth at runtime; mutations are mirrored to the DB and
the caches are rehydrated from the DB on startup.

### Make targets (recommended)

| Target            | Description                                                          |
| ----------------- | -------------------------------------------------------------------- |
| `make dev`        | Boot Postgres + apply schema + run frontend & backend.               |
| `make dev-app`    | Run apps only (use when Postgres is already running elsewhere).      |
| `make db-up`      | Start the `oceanlink-pg` container (idempotent).                     |
| `make db-down`    | Stop & remove the container.                                         |
| `make db-logs`    | Tail container logs.                                                 |
| `make db-push`    | Apply the Drizzle schema to the running database.                    |
| `make db-studio`  | Open Drizzle Studio in the browser.                                  |
| `make db-reset`   | Drop + recreate the container + reapply schema (DESTROYS DATA).      |

Defaults can be overridden inline, e.g. `make db-up PG_PORT=5433`.
Variables: `PG_CONTAINER`, `PG_IMAGE`, `PG_PORT`, `PG_USER`,
`PG_PASSWORD`, `PG_DB`.

### Manual setup

If you'd rather not use `make`:

```bash
# 1. Start Postgres
docker run -d --name oceanlink-pg \
  -p 5432:5432 \
  -e POSTGRES_PASSWORD=postgres \
  -e POSTGRES_DB=oceanlink \
  postgres:16

# Or use a local install:
createdb oceanlink

# 2. Set DATABASE_URL in the monorepo-root .env (only needed if not using
#    the default container)
# DATABASE_URL=postgres://postgres:postgres@localhost:5432/oceanlink

# 3. Push the schema
pnpm --filter @ocean-link/backend db:push

# 4. (Optional) Browse the data
pnpm --filter @ocean-link/backend db:studio
```

### Schema overview

| Table           | Purpose                                                             |
| --------------- | ------------------------------------------------------------------- |
| `intent_orders` | One row per user intent — id, chain pair, amount, status, deadline. |
| `match_results` | Append-only log of matching events (cycles stored as JSONB).        |
| `executions`    | Per-`matchId` HTLC execution state: secrets, fillIds, status.       |

Source: [src/db/schema.ts](src/db/schema.ts).

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
