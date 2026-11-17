// Fire-and-forget work that runs AFTER a transaction commits (decision emails). The HTTP response
// never waits on SMTP, and a failure is logged/recorded by the job itself, never thrown back.
// Tests call settleBackgroundJobs() to wait for everything queued so far.
const running = new Set<Promise<void>>();

export function runInBackground(label: string, job: () => Promise<void>): void {
  const p = job()
    .catch((err: unknown) => {
      console.error(`[job] ${label} failed: ${(err as Error)?.message?.split("\n")[0] ?? String(err)}`);
    })
    .finally(() => running.delete(p));
  running.add(p);
}

export async function settleBackgroundJobs(): Promise<void> {
  while (running.size > 0) await Promise.allSettled([...running]);
}
