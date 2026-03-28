# OceanLink Frontend

Cross-chain token bridge UI built with Next.js 16, React 19, and shadcn/ui.

## Tech Stack

- **Framework**: Next.js 16 (App Router)
- **UI**: shadcn/ui (new-york style) + Tailwind CSS v4
- **Web3**: Wagmi v2 + Viem v2
- **State**: TanStack Query v5

## Prerequisites

- Node.js >= 18
- pnpm >= 8

## Getting Started

### 1. Install dependencies (from monorepo root)

```bash
pnpm install
```

### 2. Configure environment variables

```bash
cp packages/frontend/.env.example packages/frontend/.env.local
```

Edit `.env.local` and fill in the required values.

### 3. Run the development server

From the monorepo root:

```bash
pnpm --filter @ocean-link/frontend dev
```

Or from `packages/frontend/` directly:

```bash
pnpm dev
```

Open [http://localhost:3001](http://localhost:3001) in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `pnpm dev` | Start development server on port 3000 |
| `pnpm build` | Build for production |
| `pnpm start` | Start production server (requires build) |
| `pnpm lint` | Run ESLint |

## Project Structure

```
packages/frontend/
├── app/
│   ├── components/
│   │   ├── bridge/        # Bridge UI components
│   │   └── ui/            # App-level UI (theme provider)
│   ├── globals.css        # Global styles + Tailwind theme
│   ├── layout.tsx         # Root layout
│   └── page.tsx           # Bridge page
├── components/
│   └── ui/                # shadcn/ui components
├── hooks/
│   └── use-toast.ts       # Toast notification hook
├── lib/
│   └── utils.ts           # cn() utility
├── components.json        # shadcn/ui config
├── next.config.js
├── postcss.config.js
└── tsconfig.json
```

## Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `NEXT_PUBLIC_BACKEND_URL` | Backend API base URL | Yes |

## Adding shadcn/ui Components

```bash
pnpm dlx shadcn@latest add <component-name>
```

Example:

```bash
pnpm dlx shadcn@latest add dialog
```
