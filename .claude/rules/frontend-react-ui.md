---
paths:
  - "web/**"
---

# web/: React + Vite + Tailwind + shadcn/ui + TanStack Query

## Two surfaces, one app

```text
web/src/
├── App.tsx        # React Router: "/" → operator (lazy), "/me/*" → portal (lazy)
├── operator/      # desktop-first workspace (spec 2.1–2.4)
├── portal/        # mobile-first /me (spec 2.5)
├── common/
│   ├── components/   # DateRangePicker, HalfDayToggle, BalancePreview, AttachmentDrop,
│   │                 # StatusPill, LeaveTypeChip, EmptyState, UndoToast
│   ├── api/          # hono/client instance + TanStack Query hooks + query keys
│   ├── realtime/     # useLeaveEvents (EventSource → invalidate)
│   └── i18n/         # fr.json, en.json
└── ui/            # shadcn/ui primitives (generated; restyle via tokens, don't fork)
```

Boundary rules, enforced by the guard hook:
1. `operator/` and `portal/` **never import each other**. Anything both need moves to `common/`.
2. `common/components/` are **props-only**: no `useQuery`, no API client, no router data loaders. `LeaveDrawer` (operator) and `RequestSheet` (portal) fetch, then pass data into `DateRangePicker` and `BalancePreview`.
3. `@leave/server` is imported **only** as `import type { AppType }`.
4. The portal bundle is a separate lazy route chunk so `/me` loads in under 2 s on 4G. Never import operator-only libraries into it.

## Data and state

- All server state goes through TanStack Query using the typed `hono/client`. Query keys live in `common/api/keys.ts`, with one factory per resource.
- **Optimistic saves:** `onMutate` inserts the bar, `onError` rolls back with a clear toast, `onSettled` invalidates. Every mutation shows `UndoToast` for **6 s**. Undo calls the inverse server action (cancel or restore). It never only reverts the cache.
- **Never patch balances on the client.** After any mutation or SSE event, invalidate the `balances` / `ledger` keys and let the server's ledger sum come back.
- SSE: `useLeaveEvents` opens one `EventSource('/api/events')`, which reconnects by itself. On an event it invalidates the affected keys (KPIs, timeline rows, pending list, my requests, balances). Set `refetchInterval: 30_000` as the polling fallback.
- Live previews (days counted, balance after, conflicts) call `@leave/shared` functions directly on every change. There is no save round trip.
- Persistence: filters in `sessionStorage` (per session). Last leave type, zoom, export format and remembered defaults in `localStorage`. Wrap every access in `try/catch`.

## i18n

- Every visible string is `t('key')` from react-i18next. Add the key to **both** `fr.json` and `en.json` in the same change. No hardcoded copy, including `aria-label`, toasts, empty states and validation messages (Zod issues carry i18n keys).
- Dates and numbers are formatted with the current locale (`Intl` / date-fns locale). Day counts show one decimal only when needed (`4.5`, `5`).
- Keep layouts RTL-safe (`ms-` / `me-` / `ps-` / `pe-` logical utilities), even though Arabic is deferred.

## Visual system (spec 2.3)

- Status pills: Pending amber, Approved green, Rejected red, Cancelled grey, **dot + text label** always.
- Leave-type colour: one hue per type from a fixed 8-colour palette, the same in bars, chips and reports. **Status is fill pattern** (solid approved / hatched pending), never hue.
- Type scale: 13 px tables, 12 px meta, 24 px KPI figures, `tabular-nums` wherever numbers align.
- Density: 36 px table rows, 32 px timeline rows (28 px compact is V2).
- Chrome: neutral greys, one accent, 1 px borders, shadows only on drawers and popovers. Dark theme is V2, but use CSS variable tokens from day one.
- Empty states: one sentence + one action (spec copy). Skeleton rows while loading, never full-screen spinners.
- Confirmation dialogs only for destructive or locked-period actions. Everything else uses Undo.

## Accessibility

Focus is trapped in drawers and sheets and returned on close. `Esc` closes. Every icon button has an `aria-label`. Colour is never the only signal. Touch targets are ≥ 44 px on any touch layout.

Load `operator-command-ui` before working in `operator/`, and `mobile-portal-ui` before working in `portal/`.
