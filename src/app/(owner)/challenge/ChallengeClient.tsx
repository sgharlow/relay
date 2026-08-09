'use client';

/**
 * The owner's challenge screen — "someone is asking for access".
 *
 * This is read under stress, possibly from a hospital bed, possibly by someone
 * who just wants it to stop. Both answers are one tap and neither is styled to
 * look like the "correct" one (J6-R3).
 *
 * Feature: relay-h0-mvp
 * Requirements: J6-R3, J6-R4, J6-R10, J6-R11
 */

import { useCallback, useEffect, useState } from 'react';

interface Request {
  id: string;
  trigger_type: string;
  reason: string | null;
  case_id: string;
  expires_at: string;
  recipient_name: string | null;
}

function timeLeft(iso: string): string {
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return 'no time left';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m left to answer` : `${m}m left to answer`;
}

export default function ChallengeClient() {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Record<string, 'approve' | 'deny'>>({});

  const load = useCallback(async () => {
    const res = await fetch('/api/access-requests');
    if (res.ok) setRequests(((await res.json()).requests ?? []) as Request[]);
    else setRequests([]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function respond(id: string, response: 'approve' | 'deny') {
    setBusy(id);
    const res = await fetch(`/api/access-requests/${id}/respond`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ response }),
    });
    setBusy(null);
    if (res.ok) setDone((d) => ({ ...d, [id]: response }));
  }

  if (requests === null) return <p className="text-muted">Loading…</p>;

  if (requests.length === 0) {
    return (
      <div className="mx-auto max-w-xl text-[18px]">
        <h1 className="text-t7 font-semibold text-ink">Nobody is asking for access</h1>
        <p className="mt-3 text-ink">
          If someone ever does, we will contact you here first — before anyone else is involved.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 text-[18px] leading-relaxed text-ink">
      {requests.map((r) => {
        const decided = done[r.id];

        if (decided) {
          return (
            <div key={r.id} className="rounded-lg border border-rule-strong bg-paper-raised p-6">
              <h2 className="text-t5 font-semibold">
                {decided === 'deny' ? 'Nothing was opened' : 'Access is opening'}
              </h2>
              <p className="mt-3 text-ink">
                {decided === 'deny'
                  ? 'We told them no. Nobody else was contacted, and your vault stayed closed.'
                  : 'They will be able to reach what you designated. You can close it again at any time.'}
              </p>
              <p className="mt-3 text-[16px] text-muted">Reference {r.case_id}</p>
            </div>
          );
        }

        return (
          <div key={r.id} className="rounded-lg border-2 border-ochre bg-paper-raised p-6">
            <p className="text-[16px] uppercase tracking-wide text-muted">
              Reference {r.case_id}
            </p>
            <h1 className="mt-2 text-t7 font-semibold">
              {r.recipient_name ?? 'Someone you trust'} is asking for access
            </h1>

            {r.reason && <p className="mt-3 text-ink">They said: &ldquo;{r.reason}&rdquo;</p>}

            <p className="mt-3 text-ink">{timeLeft(r.expires_at)}</p>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => respond(r.id, 'deny')}
                className="w-full rounded border-2 border-rule bg-paper-raised px-5 py-4 font-semibold text-ink hover:bg-paper-sunken disabled:opacity-50"
              >
                I&rsquo;m fine — don&rsquo;t open anything
              </button>
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => respond(r.id, 'approve')}
                className="w-full rounded border-2 border-rule bg-ink px-5 py-4 font-semibold text-paper hover:bg-ink disabled:opacity-50"
              >
                Yes — let them in
              </button>
            </div>

            <p className="mt-4 text-[16px] text-muted">
              If you don&rsquo;t answer, we will ask the people you nominated to confirm whether
              this is real.
            </p>
          </div>
        );
      })}
    </div>
  );
}
