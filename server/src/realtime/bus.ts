// In-process event bus for live sync (stack §2: one Node process by design).
// Channels: "operator" and `employee:${employeeId}`. Payloads are SIGNALS carrying ids only
// (no names, dates, balances or notes): clients refetch through the normal access-checked API.
// Publish only AFTER the transaction commits (never from inside db.transaction).
import { EventEmitter } from "node:events";
import type { LeaveEventType } from "@leave/shared";

export type LeaveEvent = { type: LeaveEventType; leaveRequestId: string; employeeId: string };
export type Channel = "operator" | `employee:${string}`;

const emitter = new EventEmitter();
emitter.setMaxListeners(0); // one listener per open SSE tab

export const employeeChannel = (employeeId: string): Channel => `employee:${employeeId}`;

/** Sends the event to each channel. A failing listener never breaks the publisher. */
export function publish(event: LeaveEvent, channels: readonly Channel[]): void {
  // Rebuild the payload so no extra field can ever ride along.
  const payload: LeaveEvent = { type: event.type, leaveRequestId: event.leaveRequestId, employeeId: event.employeeId };
  for (const ch of new Set(channels)) emitter.emit(ch, payload);
}

/** Subscribes to the channels; returns the unsubscribe function. */
export function subscribe(channels: readonly Channel[], handler: (e: LeaveEvent) => void): () => void {
  const safe = (e: LeaveEvent) => {
    try {
      handler(e);
    } catch (err) {
      console.error(`[bus] listener failed: ${(err as Error).message}`);
    }
  };
  const list = [...new Set(channels)];
  for (const ch of list) emitter.on(ch, safe);
  return () => {
    for (const ch of list) emitter.off(ch, safe);
  };
}

// ---------- open SSE streams, per auth user ----------

/** Open tabs allowed per user; a new one past the cap closes that user's oldest stream. */
export const MAX_STREAMS_PER_USER = 5;

const streams = new Map<string, Array<() => void>>();

/**
 * Registers an open stream and its close function. Returns the unregister function (call it when
 * the stream ends for any reason). Past MAX_STREAMS_PER_USER, the oldest stream is closed.
 */
export function registerStream(userId: string, close: () => void): () => void {
  const list = streams.get(userId) ?? [];
  list.push(close);
  streams.set(userId, list);
  while (list.length > MAX_STREAMS_PER_USER) list.shift()!();
  return () => {
    const cur = streams.get(userId);
    if (!cur) return;
    const i = cur.indexOf(close);
    if (i >= 0) cur.splice(i, 1);
    if (cur.length === 0) streams.delete(userId);
  };
}

/** Closes every open stream of the user now (sessions revoked: archive, access removed, sign-out everywhere). */
export function closeStreamsOf(userId: string): void {
  const list = streams.get(userId);
  if (!list) return;
  streams.delete(userId);
  for (const close of list) close();
}

export const openStreamCount = (userId: string): number => streams.get(userId)?.length ?? 0;

/** A leave event goes to the operator and to the employee who owns the leave, never to teammates. */
export function publishLeaveEvent(type: LeaveEventType, leave: { id: string; employeeId: string }): void {
  publish({ type, leaveRequestId: leave.id, employeeId: leave.employeeId }, ["operator", employeeChannel(leave.employeeId)]);
}
