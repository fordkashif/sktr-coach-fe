# PaceLab Supabase Data Access Conventions

Last updated: March 20, 2026

## Purpose

Define a consistent frontend data-access architecture for staged migration from mocks to Supabase.

## Directory Convention

- `src/lib/supabase/client.ts`
  - browser-safe Supabase client factory
- `src/lib/data/types.ts`
  - shared domain DTOs and query result types
- `src/lib/data/result.ts`
  - shared `Result<T>` envelope and error shape
- `src/lib/data/<feature>/*.ts`
  - feature-specific query/command modules
  - examples: `session`, `test-week`, `training-plan`

## Module Boundaries

- Route/page components should not call raw Supabase table queries directly.
- Components consume feature-level functions only.
- Query and command logic is isolated in `src/lib/data/*`.

## Result Contract

Use a normalized result envelope:

```ts
type DataErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "VALIDATION"
  | "UNKNOWN";

type DataError = {
  code: DataErrorCode;
  message: string;
  cause?: unknown;
};

type Result<T> =
  | { ok: true; data: T }
  | { ok: false; error: DataError };
```

Rules:
- Never throw raw Supabase errors across feature boundaries.
- Convert database/client errors into `Result<T>`.
- Preserve enough metadata for UI decisions (`code`, `message`).

## Query vs Command Pattern

- Queries:
  - read-only functions
  - return `Result<T>`
- Commands:
  - write functions (`insert`, `update`, `delete`)
  - return `Result<T>` with persisted payload or mutation summary

Naming examples:
- `getAthleteSessions(athleteId)`
- `completeSession(sessionId, athleteId, completionDate)`
- `getLatestTestResults(athleteId)`

## Typed Models Strategy

- Source of truth: generated Supabase DB types (recommended).
- App-level DTOs should be mapped from DB rows:
  - avoid leaking raw column names across UI layers
- Keep mapper functions close to feature data module.

Example:
- DB row: `completion_date`
- App DTO: `completionDate`

## Backend Mode / Fallback Strategy

Use `VITE_BACKEND_MODE`:
- `mock`:
  - existing mock/local behavior remains active
- `supabase`:
  - use real data-access modules

Rules:
- Feature migration is slice-based:
  - if a slice is incomplete, keep it on `mock`
- Avoid mixed data sources inside one feature screen.

## Auth and Tenant Context Rules

- Every query/command assumes auth session exists.
- Tenant scoping is enforced by RLS in DB.
- Do not pass tenant IDs from UI as trust boundary overrides.
- Only pass IDs required by domain workflow (session/test/team), not security intent.

## Testing Conventions

- Unit tests:
  - mapper functions
  - result envelope conversion
- Integration tests:
  - RLS-sensitive query paths
  - actor behavior (athlete vs coach vs admin)
- E2E:
  - critical migrated slices only (start with sessions)

## Logging and Observability

- Log sanitized data-access failures at feature boundary.
- Never log secrets or full tokens.
- Include feature + operation tags in errors for triage.

## PR Checklist for Data Layer Changes

- [ ] No raw table queries from UI route/component files
- [ ] Uses `Result<T>` envelope
- [ ] Mapper functions included for DTO shaping
- [ ] Handles `mock` vs `supabase` mode explicitly
- [ ] Tests added/updated for changed query/command behavior

