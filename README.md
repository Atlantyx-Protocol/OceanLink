# OceanLink Monorepo

A monorepo containing the OceanLink frontend, backend, and smart contracts.

## Project Structure
```
OceanLink/
├── packages/
│   ├── frontend/       # Next.js frontend application
│   ├── backend/        # TypeScript/Fastify backend API
│   └── contracts/      # Foundry smart contracts
├── package.json
└── pnpm-workspace.yaml
```

## Prerequisites

- Node.js >= 18
- pnpm >= 8
- Foundry (for smart contracts)

## Getting Started

### Install dependencies
```bash
pnpm install
```

### Development

Run all packages in development mode:
```bash
pnpm dev
```

Or run individually:
```bash
# Frontend only
pnpm --filter @ocean-link/frontend dev

# Backend only
pnpm --filter @ocean-link/backend dev

# Contracts
pnpm --filter @ocean-link/contracts test
```

### Build

Build all packages:
```bash
pnpm build
```

## Packages

### Frontend (`@ocean-link/frontend`)
- Next.js 14
- React 18
- Wagmi & Viem for Web3
- TailwindCSS

**Dev**: `http://localhost:3000`

### Backend (`@ocean-link/backend`)
- Fastify
- TypeScript
- Viem for blockchain interaction

**Dev**: `http://localhost:3001`

### Contracts (`@ocean-link/contracts`)
- Foundry
- Solidity smart contracts

## Scripts

- `pnpm dev` - Run all packages in dev mode
- `pnpm build` - Build all packages
- `pnpm lint` - Lint all packages
- `pnpm test` - Test all packages
- `pnpm clean` - Clean build artifacts

## License

MIT
```

---

## **Checkpoint:**

Your root should now have:
```
OceanLink/
├── packages/
├── tsconfig.json      ✓
├── .gitignore         ✓
├── README.md          ✓
├── package.json
└── pnpm-workspace.yaml