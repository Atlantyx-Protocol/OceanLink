# feeder

Minimal feeder demo for the OceanLink cross-chain stablecoin netting protocol.

## What it does

- Mints 1B mock USDC for the maker addresses on Base:
  - **B** `0x3aca6e32bd6268ba2b834e6f23405e10575d19b2`
  - **C** `0x7cb386178d13e21093fdc988c7e77102d6464f3e`
  - **D** `0xe08745df99d3563821b633aa93ee02f7f883f25c`
- Preloads three maker intents (500k / 300k / 200k) from Base → Sepolia using those addresses.
- Exposes REST endpoints so taker **A** (`0x9b55124d945b6e61c521add7aa213433b3b1c8a2`) can:
  - Simulate a deposit on Sepolia.
  - Submit an order intent (Sepolia → Base).
  - Trigger the fixed matching engine that nets A against B/C/D.
- Returns a hard-coded six-transfer netting plan when A provides at least 1M USDC.

## Run locally

```bash
cd feeder
cargo run
```

Server listens on `http://127.0.0.1:8081`.

## API

All payloads are JSON.

### `POST /deposit`

```json
{
  "user": "0x9b55124d945b6e61c521add7aa213433b3b1c8a2",
  "chain": "Sepolia",
  "amount": 1000000,
  "recipient_on_other_chain": "0x9b55124d945b6e61c521add7aa213433b3b1c8a2"
}
```

Adds USDC to the in-memory balance map.

### `POST /order`

```json
{
  "user": "0x9b55124d945b6e61c521add7aa213433b3b1c8a2",
  "from_chain": "Sepolia",
  "to_chain": "Base",
  "amount": 1000000,
  "signature": "0x123"
}
```

Stores A's intent in the orderbook.

### `POST /match`

Returns the six-transfer plan once A's total taker size is ≥ 1,000,000 USDC.

### `GET /orderbook`

Inspect the in-memory orderbook.

### `GET /balances`

Inspect current balances per chain/user.

## Demo flow

1. `POST /deposit` (A deposits 1,000,000 on Sepolia).
2. `POST /order` (A submits Sepolia → Base order).
3. `POST /match` (returns the netting plan that nets A against the three maker addresses).

This crate is intentionally simplified: no signature checks, no actual blockchain, and maker intents remain forever.

