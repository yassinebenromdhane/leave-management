---
description: End-to-end feature workflow for the leave app, from shared schema/rules through server, web and tests, tied to the functional spec
argument-hint: "<feature description or spec section, e.g. '1.2 balance preview' or 'withdraw pending request from portal'>"
---

# Implement a feature

Feature: **$ARGUMENTS**

## 0. Frame it (no code yet)

1. Find the spec sections that define this feature (quote them briefly) and confirm it is **MVP** per `CLAUDE.md`. If it is V2, say so and ask before continuing.
2. List what it touches: shared schemas/rules, tables, endpoints (method, path, role), UI surfaces (operator / portal / both), events, i18n keys, audit entries.
3. Name the invariants at risk (ledger append-only, portal isolation, rules-in-shared, warn-don't-block, i18n) and how you will respect each.
4. If the spec is ambiguous, state your interpretation in one line and continue. Ask only if the choice would change data already stored.

Show this plan in ≤ 15 lines, then proceed.

## 1. shared/

- Zod schemas for the request and response payloads (portal schemas never contain `employeeId`; responses `.strict()` where privacy matters).
- New or changed rules with **Vitest tests written first**. Load `ledger-and-calculation-engine` if days or balances are involved.
- `pnpm --filter @leave/shared test` green before moving on.

## 2. server/

Delegate to the `backend-architect` agent, or follow `.claude/rules/backend-hono-drizzle.md` directly:
- Schema change? Run `/add-migration` first.
- Domain function in `server/src/domain/` with a transaction + audit + post-commit event.
- Thin route with `zValidator(sharedSchema)`; the typed `AppType` is still exported.
- Integration tests against real PostgreSQL (happy path, each blocking rule, audit row, and for portal routes an isolation test).

## 3. web/

Delegate to the `frontend-builder` agent, or follow `.claude/rules/frontend-react-ui.md` directly, loading `operator-command-ui` and/or `mobile-portal-ui`:
- Query hooks and keys in `common/api/`; shared widgets props-only in `common/components/`.
- Live previews via `@leave/shared`; optimistic mutation + 6 s Undo; invalidate on SSE events.
- Strings in both `fr.json` and `en.json`.

## 4. Tests and checks

Run the `domain-test-engineer` agent for any change to calculation, ledger or transaction behaviour. Then:

```bash
pnpm typecheck && pnpm lint && pnpm test
```

If the feature touches `/api/me`, auth, attachments or SSE, run the `security-privacy-auditor` agent on the changed files.

## 5. Report

Summarise: spec sections implemented, files changed (grouped shared / server / web), migration names, endpoints, translation keys added, test results (with counts), interpretations made, and anything left for V2.
