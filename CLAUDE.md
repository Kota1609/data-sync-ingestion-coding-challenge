# DataSync Forge — Project Standards

## Project Overview

Production-ready data ingestion system that extracts 3,000,000 events from the DataSync Analytics API into PostgreSQL. Uses cursor forging for parallel partitions, per-worker pipelining, and UNNEST bulk inserts.

## Tech Stack

- **Language:** TypeScript (strict mode, ES2022 target)
- **Runtime:** Node.js 20
- **Database:** PostgreSQL 16
- **HTTP:** undici (keep-alive, gzip)
- **Logging:** Pino (structured JSON, credential redaction)
- **Testing:** Vitest
- **Containerization:** Docker Compose, 4-stage multi-stage build

## Coding Standards

### TypeScript

- Strict mode enabled (`"strict": true` in tsconfig)
- **No `any`** — use `unknown` with type guards, or specific types
- All functions must have **explicit return types**
- Named exports only — no `default export`
- No barrel exports (`index.ts` re-exporting everything) — import directly from source files
- Use `const` by default; `let` only when mutation is necessary
- No `enum` — use `as const` objects with inferred types:
  ```typescript
  const Status = { RUNNING: 'running', COMPLETED: 'completed' } as const;
  type Status = (typeof Status)[keyof typeof Status];
  ```
- No classes unless managing mutable state with a clear lifecycle (prefer plain functions + closures)

### Naming

- `camelCase` for variables, functions, and parameters
- `PascalCase` for types, interfaces, and type aliases
- `UPPER_SNAKE_CASE` for constants and `as const` objects
- `kebab-case` for file names (e.g., `cursor-forge.ts`, `http-client.ts`)

### Imports

- Use Node.js `node:` protocol for built-in modules: `import { createServer } from 'node:http'`
- Group imports: node builtins first, then external packages, then local modules
- No circular imports

## Architecture Rules

### Dependency Flow

```
index.ts → core/ → api/ and db/
```

Never import backward (api/ must not import from core/, db/ must not import from core/).

### Boundaries

- **Configuration:** All `process.env` reads happen in `config.ts` only. Every other module receives config as a parameter.
- **Logging:** All logging through `logger.ts`. No `console.log`, `console.error`, or `console.warn` anywhere.
- **SQL:** All raw SQL queries live in `db/` directory only. No SQL strings outside `db/`.
- **HTTP:** All external HTTP calls go through `http-client.ts` and the middleware chain.

### External I/O

All external I/O (HTTP requests, database queries) must be behind interfaces or function signatures that can be swapped in tests. No direct `fetch()` or `pool.query()` calls in business logic.

## Error Handling

- Custom error classes for each domain:
  - `HttpError` — HTTP request failures (with `status`, `method`, `url`)
  - `ApiError` — API-level errors (with error type and message from response body)
  - `DbError` — Database operation failures
- Errors must be **categorizable**: retry-eligible (5xx, 429, timeouts) vs. fatal (4xx except 429, schema errors)
- Never swallow errors silently — always log at minimum
- Async functions must not produce floating promises — always `await` or explicitly handle

## Database

- Table names: `snake_case`
- Column names: `snake_case`
- All table creation is idempotent (`CREATE TABLE IF NOT EXISTS`)
- Bulk inserts use `UNNEST()` arrays, not multi-row `VALUES`
- All checkpoint + insert operations happen in a single transaction (`BEGIN`/`COMMIT`)
- Use `ON CONFLICT (pk) DO NOTHING` for idempotent writes

## Testing

- Test file naming: `<module-name>.test.ts` (unit) or `<module-name>.integration.test.ts` (integration)
- Framework: Vitest with `describe`/`it`/`expect`
- Unit tests mock all external dependencies (HTTP, DB) — never hit real services
- Integration tests use `.integration.test.ts` suffix and may require running services
- Each test file tests one module only

## Git Conventions

- **Conventional commits:** `feat:`, `fix:`, `test:`, `docs:`, `refactor:`, `chore:`
- Each commit must be buildable — `npm run typecheck` must pass
- Incremental commits showing logical progression (not one giant commit)
- Never commit `.env` files, `node_modules/`, or `dist/`

## Docker

- 4-stage multi-stage build: `deps` → `prod-deps` → `build` → `runtime`
- `.dockerignore` excludes: `node_modules`, `dist`, `.git`, `coverage`, `test/`, `*.test.ts`, `.env`
- `EXPOSE 8080` for health server
- `container_name: assignment-ingestion` (required by `run-ingestion.sh`)
- Log `"ingestion complete"` (exact string, case-sensitive) when done

## Key File Paths

- Entry point: `packages/ingestion/src/index.ts`
- Config: `packages/ingestion/src/config.ts`
- Types: `packages/ingestion/src/types.ts`
- Database: `packages/ingestion/src/db/`
- API client: `packages/ingestion/src/api/`
- Core engine: `packages/ingestion/src/core/`
- Tests: `packages/ingestion/test/`
