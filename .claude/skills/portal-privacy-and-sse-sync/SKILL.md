---
name: portal-privacy-and-sse-sync
description: Spec 1.7 and 4.3 employee-portal access rules and live sync. Covers session-scoped /api/me queries, the "Away"-only teammate projection, team-visibility scope setting, portal submit and withdraw transactions, notifications and decision emails, and Server-Sent Events with Hono streamSSE, an in-memory bus, EventSource and TanStack Query invalidation with a 30 s polling fallback. Use when building or reviewing any /api/me route, the team availability strip or tab, the SSE endpoint, or operator/portal sync behaviour.
---

# Portal privacy and SSE sync

The portal reads and writes **the same tables** as the operator through a narrower API. There is no second copy of any data.

## Access matrix (spec 4.3), enforced on the server

| Resource | Employee may |
| --- | --- |
| Own `employee` row | Read name, department, hire date. No writes. |
| Own `leave_request` | Read all. Create with `source='portal'`, `status='pending'`. Set `cancelled` only while Pending. |
| Own `ledger_entry` | Read. |
| Own `attachment` | Create and read. Delete only while the request is Pending. |
| Teammates' leaves | **Projection of Approved leaves only:** `employeeId, fullName, startDate, endDate, startHalf, endHalf`. |
| `holiday`, `leave_type` | Read. |
| Everything else | No access (settings, other employees, audit, notifications of others, exports). |

### Implementation rules

1. `requireEmployee` middleware resolves `session.user.employeeId` and the employee's `status` / `portal_access`. Archived or disabled → 401 and sessions revoked.
2. Every portal query has `WHERE employee_id = :sessionEmployeeId`, through a repository helper (`portalScope(c)`), not ad-hoc. Never read an employee id from the URL, query or body. The guard hook blocks the obvious forms.
3. The teammate projection is a **dedicated SQL select of the allowed columns only**. Never select `*` and strip later. Never return `leave_type_id`, `note`, `status`, `reject_reason`, attachment info, balances or `has_warning`. Label it "Away" in the UI.
4. Include only `status = 'approved' AND deleted_at IS NULL`. Other people's pending requests are invisible.
5. Scope comes from a company setting: `department` (default) | `company` | `off`. With `off`, the endpoint returns `[]` and the UI hides the strip and the Team tab.
6. Response shapes are Zod schemas in `shared/src/schemas/portal/`. Parse responses in tests to prove no extra keys (`.strict()`).
7. Attachment download checks ownership (or operator role) on every request. No public URLs, and no guessable keys.

### Portal submit checks (spec 1.7)

| Check | Portal |
| --- | --- |
| Overlaps own leave | Block, with a link to the existing leave |
| Zero working days / outside employment | Block |
| Exceeds available balance | Block if negatives are disabled; otherwise a warning that must be acknowledged (`acknowledgeNegative: true` in payload) |
| Teammates away | Informational only |
| Required attachment missing | Sick leave: allowed, flagged "certificate expected"; other types: block |

## Sync rules (spec 4.3)

1. **Submit**, in one transaction: recompute `workingDays` + blocking checks on the server → insert `leave_request` (pending, portal) → `has_warning` from `conflictChecker` → `notification` (recipient operator, kind `submitted`) → audit. **After commit**, publish `leave.submitted`.
2. **Operator screen** on `leave.submitted`: invalidate KPIs, the affected timeline rows and the pending list. Within 2 s: Pending KPI +1, a hatched bar, and the item in the pending list with a "from portal" marker.
3. **Decision:** approve writes the ledger entry, sets `decided_at`, writes a notification for the employee and publishes `leave.decided`. Reject does the same without a ledger entry (optional reason saved).
4. **Employee screen** on `leave.decided`: refetch the request and the balances. The new balance is the server's ledger sum. In parallel an email goes out (Brevo SMTP) for employees who are offline. Email failure never rolls back the decision.
5. **Stale requests:** an operator date edit or a holiday-driven recount shows on the portal with a "changed by HR" note (`leave.changed`).
6. **Concurrency:** withdraw and approve both run `SELECT … FOR UPDATE` + status check. The first wins; the loser gets `409` with an i18n message.
7. Operator-logged leaves appear in the employee's list marked "added by HR" (`source = 'operator'`).

## SSE plumbing

Server (`server/src/realtime/bus.ts` + `routes/events.ts`):

```ts
// bus: in-process, single Node instance by design (stack §2)
type LeaveEvent =
  | { type: 'leave.submitted' | 'leave.decided' | 'leave.changed' | 'leave.withdrawn';
      leaveRequestId: string; employeeId: string };
// channels: 'operator' and `employee:${id}`
```

```ts
app.get('/api/events', requireAnyRole, (c) =>
  streamSSE(c, async (stream) => {
    const channels = role === 'operator' ? ['operator'] : [`employee:${employeeId}`];
    const off = bus.subscribe(channels, (e) => stream.writeSSE({ event: e.type, data: JSON.stringify(e) }));
    stream.onAbort(off);
    while (!stream.aborted) { await stream.writeSSE({ event: 'ping', data: '' }); await stream.sleep(25_000); }
  }));
```

- Payloads carry **ids only**. A teammate never receives events about other employees' requests. The portal Team view refreshes by polling or refocus, not by events.
- Heartbeat every ~25 s keeps Caddy and proxies from closing the stream. Caddy needs no special config (`flush_interval -1` is optional).
- The cookie session authenticates `EventSource` automatically (same origin).

Client (`web/src/common/realtime/useLeaveEvents.ts`): one `EventSource` per tab → `queryClient.invalidateQueries` for the mapped keys. Plus `refetchInterval: 30_000` on the affected queries as the fallback. Never write event data into the cache.

## Review checklist

- [ ] No `/api/me` handler accepts an employee id from the client
- [ ] Teammate endpoint selects only the six allowed columns, approved and non-deleted only, respects the scope setting
- [ ] Strict Zod response schema + a test proving forbidden fields are absent
- [ ] Events published after commit; payloads have ids only; per-employee channel isolation tested
- [ ] Withdraw-vs-approve race test returns 409 to the loser
