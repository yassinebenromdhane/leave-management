---
name: mobile-portal-ui
description: Spec 1.7 and 2.5 employee self-service portal UI at /me. Covers the mobile-first layout with a 480 px desktop column, the password login screen and its auth UX, the Home / My leaves / Team tabs, balance cards, decision banner, the 15-second request flow in a full-height bottom sheet with 44 px calendar cells, half-day toggles, live day count and balance preview, team availability strip, withdraw with Undo, offline queueing and the first-login empty state. Use when building anything under web/src/portal.
---

# Mobile portal UI (`/me`)

Employees get three things only: **their own balances, a fast way to ask for leave, and a view of who is away.** The target is a request submitted in **under 15 seconds** on a phone.

## Shell

- `PortalShell`: phone-first; on desktop a **centred 480 px column**, no separate desktop design.
- Bottom tab bar: **Home · My leaves · Team**. Settings (from the header) are limited to language, change password and sign out.
- The same `StatusPill`, `LeaveTypeChip`, colours and type scale as the operator view, so both feel like one product.
- Touch targets ≥ 44 px; calendar day cells ≥ 44 × 44 px. Safe-area insets for the pinned button and tab bar.
- Lazy-loaded route chunk; no operator code. Loads in under 2 s on 4G.

## Login (`PortalLogin`, spec 2.5)

- Two fields (email, password), show-password toggle, "Keep me signed in", "Forgot password?". Use `autocomplete="username"` / `"current-password"` so password managers work.
- An alternative identifier field accepts the **employee code** (for temporary-password accounts).
- No sign-up link, no magic link, no OTP.
- Errors are generic ("Email or password is incorrect"). The same message covers a locked account; never reveal whether the email exists.
- First login with a temporary password → forced "choose a new password" screen (min 8 characters; server rejects common passwords and the UI shows the i18n reason).
- Set-password (invite, 48 h) and reset (30 min, single use) pages show a clear expired-link state with a "ask HR for a new link" hint.

## Home

1. **Decision banner** (`DecisionBanner`): the latest approval or rejection (with reason) at the top until dismissed.
2. **Balance cards** (`BalanceCards`): a horizontal scroll row, one card per entitled type. Main figure = available; below it "taken 8 · pending 2". Tap → that type's ledger, read-only (date, entry type, days, running balance, note).
3. **Pending requests** first, each with dates, days, status pill and **Withdraw**.
4. **Upcoming** approved leaves, marked "added by HR" or "changed by HR" where relevant.
5. **Next three public holidays.**
6. A full-width **Request leave** button pinned to the bottom, in thumb reach.

Empty state on first login: "You have 18 days of paid leave. Tap Request leave to plan your first one." (the number comes from the live balance).

## Request flow (`RequestSheet`)

A full-height bottom sheet that reuses `DateRangePicker`, `HalfDayToggle`, `BalancePreview` and `AttachmentDrop` from `common/`.

| Step | What happens |
| --- | --- |
| 1 | Tap **Request leave**. The type is preselected (paid leave); a chip row switches type. |
| 2 | One calendar opens on the current month, today highlighted. **Two taps** select first and last day. Half-day toggles appear on both ends. Live under the calendar: "4.5 working days (1 weekend, 1 public holiday excluded)", "Paid leave: 12 → 7.5 days", and the **team strip** ("2 of 5 in Logistics away: Sami (12 to 16), Ines (14)"). |
| 3 | Tap **Submit**. Note and attachment are **collapsed by default** and expand only when needed or required. Attachment from camera (`capture="environment"`) or files. |

Submit behaviour:
- Blocking issues (self-overlap with a link, zero days, outside employment, negative when disabled, missing attachment for non-sick types) disable Submit with an inline i18n message.
- Negative balance when allowed: an acknowledgement checkbox is required before Submit enables.
- Sick leave without a certificate: allowed, flagged "certificate expected".
- On success: haptic feedback (`navigator.vibrate?.(10)`), the sheet closes, the new **Pending** request appears at the top of Home, and `UndoToast` for 6 s (Undo = withdraw).
- Day counts use the same `@leave/shared` functions as the operator drawer, so both sides show identical numbers.

## Offline

The request sheet works from cached TanStack Query data (types, holidays, balances). If the connection drops at Submit, queue the submit (persisted mutation, retried on `online`), show it as "Sending…", and never fake a Pending status from the server's side.

## My leaves

History grouped by year: dates, type, days counted, status pill, rejection reason, "changed by HR" note. Withdraw is available only while Pending. Changing an approved leave goes through HR, so show a hint instead of a button.

## Team

A two-week availability view: **names and "Away" only**. No type colours, no notes, no statuses. The strip and tab are hidden when the operator turns visibility off. The data comes from the server projection (see the `portal-privacy-and-sse-sync` skill). Never derive it client-side from richer data.

## Live updates

`useLeaveEvents` on `employee:<id>`: on `leave.decided` / `leave.changed`, refetch the requests and balances, then show the decision banner. Never subtract days on the client.

## Done means

From a warm session: Home → Request leave → tap two dates → Submit in ≤ 15 s on a mid-range phone. Every string exists in fr and en, and every tap target is ≥ 44 px.
