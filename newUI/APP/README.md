# PHICOIN Wallet — New UI

Next-generation web wallet for PHICOIN, replacing the Qt-based desktop wallet with a modern, cross-platform frontend.

## Architecture

- **Frontend**: React 18 + TypeScript + Vite
- **Styling**: Tailwind CSS
- **State Management**: Zustand + TanStack React Query
- **Backend**: `phicoind` JSON-RPC API (localhost:28966)
- **Testing**: Jest + React Testing Library + Playwright

## Quick Start

### Prerequisites

- Node.js >= 20
- `phicoind` running and accessible on `localhost:28966`

### Local Development

```bash
npm install
npm run dev
```

The dev server runs on `http://localhost:3000`.

### Docker Development

```bash
docker compose -f docker/docker-compose.yml up --build
```

### Build for Production

```bash
npm run build
```

### Testing

```bash
npm run test          # Unit tests
npm run test:e2e      # End-to-end tests (Playwright)
```

## Project Structure

```
src/
├── components/       # Reusable UI components
├── pages/            # Route-level page components
├── services/         # RPC & API communication
├── hooks/            # Custom React hooks
├── stores/           # Zustand state stores
├── types/            # TypeScript type definitions
├── utils/            # Utility functions
└── styles/           # Global CSS
```

## RPC Configuration

The wallet communicates with `phicoind` via JSON-RPC. Default connection:

- **Host**: `localhost`
- **Port**: `28966`
- **Protocol**: HTTP (localhost-only; use HTTPS + reverse proxy for production)

Override via environment variables:

```
VITE_RPC_HOST=localhost
VITE_RPC_PORT=28966
VITE_RPC_USER=rpcuser
VITE_RPC_PASSWORD=rpcpassword
```
