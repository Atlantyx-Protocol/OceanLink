# OceanLink

OceanLink is a cross-chain USDC bridge that works with intents. Most bridges lock
your money in one big contract. OceanLink does it in another way. You send a
transfer request, called an _intent_, and an off-chain matching engine looks for
other transfers that go the opposite way. When it finds a good match, it completes
the transfers using HTLC contracts and liquidity providers. It runs on three
testnets: Ethereum Sepolia, Arbitrum Sepolia, and Base Sepolia.

This repo holds the code for my bachelor thesis on cross-chain bridge design. The
full thesis is in [`docs/thesis/`](docs/thesis/).

---

## Project structure

```
ocean-link/
├── packages/
│   ├── backend/        # Fastify + TypeScript API, matching engine, orchestrator
│   └── frontend/       # Next.js 16 app (wallet UI, bridge flow, activity)
├── docs/               # Notes about the code + the LaTeX thesis
│   ├── CODEBASE_BACKEND.md
│   ├── CODEBASE_MATCHING_ALGORITHM.md
│   └── thesis/
├── references/         # Papers and sources used in the thesis (see references/README.md)
├── Makefile            # Short commands to run the database and the apps
├── .env.example        # All the environment variables, with notes
├── package.json        # pnpm workspace root
└── pnpm-workspace.yaml
```

> **Note:** the smart contracts (HTLC, USDC) are deployed on the testnets on their
> own. You set their addresses through environment variables. This repo has the
> off-chain part of the bridge (backend and frontend), not the Solidity code.

---

## What you need

| Tool        | Version | Why                                               |
| ----------- | ------- | ------------------------------------------------- |
| **Node.js** | >= 20   | Runs the backend (tsx) and the frontend (Next 16) |
| **pnpm**    | >= 8    | Package manager for the workspace                 |
| **Docker**  | any     | Runs the Postgres 16 database on your machine     |
| **make**    | any     | Runs the dev commands (nice to have, not a must)  |

You also need:

- **RPC URLs** for Ethereum Sepolia, Arbitrum Sepolia, and Base Sepolia. You can
  get free ones from Alchemy or Infura.
- **Test wallets with some funds.** You need one user wallet and a few liquidity
  provider wallets. Each one needs some test ETH for gas and some test USDC to
  send.

---

## 1. Install

```bash
# clone the repo, then from the root folder:
pnpm install        # or: make install
```

## 2. Set up the environment

Copy the example file and fill in your own values:

```bash
cp .env.example .env
```

There is one `.env` file in the root folder, and both apps read from it. These
are the values you have to set before the bridge can work on-chain:

| Variable                                                                | What it is                                                         |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `SEPOLIA_RPC_URL` / `ARBITRUM_SEPOLIA_RPC_URL` / `BASE_SEPOLIA_RPC_URL` | RPC URL for each chain                                             |
| `PRIVATE_KEY_A`                                                         | The user wallet that creates the bridge orders                     |
| `PRIVATE_KEY_ADMIN`                                                     | A read-only key the chain provider uses                            |
| `NEXT_PUBLIC_USDC_ADDRESS_*` / `NEXT_PUBLIC_HTLC_ADDRESS_*`             | The contract addresses on each chain                               |
| `DATABASE_URL`                                                          | The Postgres connection string (the default works with `make dev`) |

`PRIVATE_KEY_B`, `PRIVATE_KEY_C`, and `PRIVATE_KEY_D` are the liquidity provider
wallets (Ethereum / Base / Arbitrum). They are optional. You only need them if you
want to run the matching engine with real liquidity, approve the LP wallets, or
run the full end-to-end flow.

The rest of the settings (matching speed, match threshold, timelock, ports, CORS)
already have default values, so you can leave them as they are for now. Each one
has a short note in [`.env.example`](.env.example).

> **Warning:** a private key gives full control over a wallet. Only use test
> wallets here. The `.env` file is in `.gitignore`, so do not commit real keys.

## 3. Run

The easiest way starts the database and both apps at the same time:

```bash
make dev
```

`make dev` does a few things in order. It starts a Postgres 16 container in
Docker, waits until the database is ready, loads the schema with Drizzle, and then
runs the frontend and backend together.

### Other ways to run

```bash
make dev-app          # run the frontend and backend only (Postgres already running)
make backend          # backend only
make frontend         # frontend only

# without make:
pnpm dev              # frontend and backend together
pnpm dev:frontend     # frontend only
pnpm dev:backend      # backend only
```

Database commands:

```bash
make db-up            # start the Postgres container
make db-push          # load the Drizzle schema
make db-studio        # open Drizzle Studio in the browser
make db-down          # stop and remove the container
make db-reset         # rebuild the database (this deletes the data)
```

After it starts, you can open:

| Service  | URL                   |
| -------- | --------------------- |
| Frontend | http://localhost:3000 |
| Backend  | http://localhost:3001 |

## 4. Approve USDC (only the first time)

The wallets need to approve the HTLC contracts before they can move any USDC. Run
these once:

```bash
make approve-usdc-all   # approve USDC for the user wallet on every chain
make approve-lps        # approve the LP wallets (B/C/D) on their chains
```

---

## Demo

1. Run `make dev` and open **http://localhost:3000**.
2. Connect your wallet (the user wallet from `PRIVATE_KEY_A`) and switch it to one
   of the testnets.
3. On the bridge card, pick the source chain and the destination chain, type a
   USDC amount, and click submit.
4. The app shows each step as it happens (checking, approving, submitting,
   tracking) with a small message:
   - if you have not approved enough USDC yet, it sends an approve transaction
     first and waits for it to confirm;
   - then it sends the intent to the backend (`POST /api/intent`).
5. On its next tick, the matching engine on the backend picks up your intent. It
   matches it against other waiting orders and the liquidity providers, then the
   orchestrator finishes everything through the HTLC contracts on each chain.
6. The frontend listens for Server-Sent Events, so the status updates live
   (`QUEUED → MATCHED → COMPLETED`). Open the Activity page (`/activity`) to see
   all the past orders.

### Run the flow without the UI

You can also test the matching engine and the full path from the command line:

```bash
make e2e-matching-test     # matching engine only (no wallets needed)
make e2e-bridge-test       # one HTLC bridge round-trip       (needs A, B)
make e2e-liquidity-test    # liquidity market service         (needs the TESTER key)
make e2e-full-flow-test    # intent → match → bridge → check  (needs A, B, C, D)
```

---

## Tests and code style

```bash
pnpm test            # run the unit tests in every package
pnpm lint            # lint every package
pnpm format          # format the code with Prettier
pnpm build           # build every package
```

The backend tests use the built-in Node.js test runner through `tsx --test`. They
cover the matching algorithm, the matching engine, and the liquidity service.

---

## Docs

- [`docs/CODEBASE_BACKEND.md`](docs/CODEBASE_BACKEND.md) — a tour of the backend.
- [`docs/CODEBASE_MATCHING_ALGORITHM.md`](docs/CODEBASE_MATCHING_ALGORITHM.md) — how the matching algorithm works.
- [`packages/backend/README.md`](packages/backend/README.md) / [`packages/frontend/README.md`](packages/frontend/README.md) — notes for each package.
- [`docs/thesis/`](docs/thesis/) — the full LaTeX thesis.
- [`references/`](references/) — the papers and sources used in the thesis.

---

## License

MIT
