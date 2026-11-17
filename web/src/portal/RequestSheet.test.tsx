import { addIsoDays, isoWeekday } from "@leave/shared";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { portalApi } from "@/common/api/portal";
import type * as PortalModule from "@/common/api/portal";
import { todayIso } from "@/common/lib/date";
import { SICK, TRAINING, reference, renderPortal } from "@/test/portalFixtures";
import { outbox } from "./offline/outbox";
import { useOutboxFlush } from "./offline/useOutbox";
import RequestSheet from "./RequestSheet";

const preview = vi.hoisted(() => ({ result: null as unknown }));
vi.mock("@/common/api/portal", async (orig) => ({
  ...(await orig<typeof PortalModule>()),
  usePortalPreview: (input: unknown) => ({ data: input ? preview.result : undefined, isPlaceholderData: false }),
}));

const issue = (code: string, severity: "blocking" | "warning", params: Record<string, unknown> = {}) => ({ code, severity, params });
const result = (over: { blocking?: unknown[]; warnings?: unknown[]; balance?: unknown } = {}) => ({
  days: 2,
  weekendDays: 0,
  holidayDays: 0,
  balance: over.balance ?? null,
  conflicts: { blocking: over.blocking ?? [], warnings: over.warnings ?? [] },
  team: { scope: "department", people: [] },
});

const monday = addIsoDays(todayIso(), -(isoWeekday(todayIso()) - 1));
const tuesday = addIsoDays(monday, 1);
const tap = (iso: string) => fireEvent.click(document.querySelector(`[data-date="${iso}"]`) as HTMLElement);
const submitBtn = () => screen.getByRole("button", { name: "Submit request" }) as HTMLButtonElement;

function open() {
  return renderPortal(<RequestSheet reference={reference} onClose={vi.fn()} />);
}
async function pickTwoDays() {
  tap(monday);
  tap(tuesday);
  await screen.findByText(/2 working days/);
}

describe("RequestSheet", () => {
  beforeEach(() => {
    preview.result = result();
    outbox.reset();
    vi.spyOn(portalApi, "submit").mockResolvedValue({ id: "new" } as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("counts the days live with the shared rule after two taps", async () => {
    open();
    expect(submitBtn().disabled).toBe(true);
    await pickTwoDays();
    await waitFor(() => expect(submitBtn().disabled).toBe(false));
  });

  it("disables Submit on a blocking conflict and shows the message", async () => {
    preview.result = result({ blocking: [issue("conflicts.outsideEmployment", "blocking", { hireDate: "2030-01-01" })] });
    open();
    await pickTwoDays();
    expect(await screen.findByText(/Outside the employment period/)).toBeTruthy();
    expect(submitBtn().disabled).toBe(true);
  });

  it("requires the acknowledgement when the balance goes negative (allowed) and sends it", async () => {
    preview.result = result({ warnings: [issue("conflicts.negativeBalance", "warning", { exceeds: 1 })], balance: { available: 1, after: -1 } });
    open();
    await pickTwoDays();
    const box = await screen.findByRole("checkbox");
    expect(submitBtn().disabled).toBe(true);
    fireEvent.click(box);
    expect(submitBtn().disabled).toBe(false);
    fireEvent.click(submitBtn());
    await waitFor(() => expect(portalApi.submit).toHaveBeenCalled());
    expect(vi.mocked(portalApi.submit).mock.calls[0]![0]).toMatchObject({ acknowledgeNegative: true, startDate: monday, endDate: tuesday });
  });

  it("sick leave without a certificate is allowed and flagged", async () => {
    preview.result = result({ warnings: [issue("conflicts.attachmentMissing", "warning")] });
    open();
    fireEvent.click(screen.getByRole("button", { name: SICK.name }));
    await pickTwoDays();
    expect(await screen.findByTestId("certificate-expected")).toBeTruthy();
    expect(submitBtn().disabled).toBe(false);
  });

  it("another type that requires a document is blocked until it is attached", async () => {
    preview.result = result({ blocking: [issue("conflicts.attachmentMissing", "blocking")] });
    open();
    fireEvent.click(screen.getByRole("button", { name: TRAINING.name }));
    await pickTwoDays();
    expect(await screen.findByText(/supporting document is required/)).toBeTruthy();
    expect(submitBtn().disabled).toBe(true);
    // the attachment area opened by itself, with the camera option
    expect(screen.getByRole("button", { name: "Take a photo" })).toBeTruthy();
  });

  it("note and attachment stay collapsed for a plain type", () => {
    open();
    expect(screen.getByRole("button", { name: "Add a note" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Add a document or photo" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Take a photo" })).toBeNull();
  });

  it("calendar day cells are at least 44 x 44 px", () => {
    open();
    const cells = document.querySelectorAll<HTMLElement>("[data-date]");
    expect(cells.length).toBe(42);
    for (const c of cells) {
      expect(c.className).toContain("h-11"); // 44 px
      expect(c.className).toContain("min-w-11"); // 44 px
    }
  });
});

describe("offline submit", () => {
  const setOnline = (v: boolean) => Object.defineProperty(navigator, "onLine", { value: v, configurable: true });
  beforeEach(() => {
    preview.result = result();
    outbox.reset();
    vi.spyOn(portalApi, "submit").mockResolvedValue({ id: "new" } as never);
  });
  afterEach(() => {
    setOnline(true);
    vi.restoreAllMocks();
  });

  function Flusher({ userId = "user-a" }: { userId?: string }) {
    useOutboxFlush(userId);
    return null;
  }

  const queueAs = (userId: string) => {
    outbox.setOwner(userId);
    outbox.enqueue({ leaveTypeId: "t", startDate: monday, endDate: tuesday, startHalf: "full", endHalf: "full", note: "private note" } as never, "Sick leave", null);
  };

  it("shared device: another user's queued request is never sent and is deleted (audit fix)", async () => {
    setOnline(false);
    queueAs("user-a");
    expect(localStorage.getItem("portal.outbox")).toContain("private note");

    setOnline(true);
    renderPortal(<Flusher userId="user-b" />); // B signs in on the same device
    await waitFor(() => expect(outbox.owner()).toBe("user-b"));
    expect(portalApi.submit).not.toHaveBeenCalled();
    expect(outbox.all()).toHaveLength(0);
    expect(localStorage.getItem("portal.outbox")).not.toContain("private note");
  });

  it("sign-out (owner null) deletes everything queued", () => {
    queueAs("user-a");
    outbox.setOwner(null);
    expect(outbox.all()).toHaveLength(0);
    expect(JSON.parse(localStorage.getItem("portal.outbox")!)).toEqual([]);
  });

  it("nothing can be queued without a signed-in owner", () => {
    expect(() => outbox.enqueue({} as never, "x", null)).toThrow();
  });

  it("queues the payload while offline and sends it on the online event", async () => {
    setOnline(false);
    const onClose = vi.fn();
    const { qc } = renderPortal(
      <>
        <Flusher />
        <RequestSheet reference={reference} onClose={onClose} />
      </>,
    );
    await pickTwoDays();
    await waitFor(() => expect(submitBtn().disabled).toBe(false));
    fireEvent.click(submitBtn());

    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(portalApi.submit).not.toHaveBeenCalled();
    expect(outbox.all()).toHaveLength(1);
    expect(outbox.all()[0]!.payload).toMatchObject({ startDate: monday, endDate: tuesday });
    expect(JSON.parse(localStorage.getItem("portal.outbox")!)).toHaveLength(1); // persisted

    setOnline(true);
    window.dispatchEvent(new Event("online"));
    await waitFor(() => expect(portalApi.submit).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(outbox.all()).toHaveLength(0));
    expect(qc.isFetching()).toBe(0);
  });
});
