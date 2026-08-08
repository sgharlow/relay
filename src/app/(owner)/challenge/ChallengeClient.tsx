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

  if (requests === null) return <p className="text-stone-600">Loading…</p>;

  if (requests.length === 0) {
    return (
      <div className="mx-auto max-w-xl text-[18px]">
        <h1 className="text-2xl font-semibold text-stone-900">Nobody is asking for access</h1>
        <p className="mt-3 text-stone-700">
          If someone ever does, we will contact you here first — before anyone else is involved.
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-6 text-[18px] leading-relaxed text-stone-900">
      {requests.map((r) => {
        const decided = done[r.id];

        if (decided) {
          return (
            <div key={r.id} className="rounded-lg border border-stone-300 bg-white p-6">
              <h2 className="text-xl font-semibold">
                {decided === 'deny' ? 'Nothing was opened' : 'Access is opening'}
              </h2>
              <p className="mt-3 text-stone-800">
                {decided === 'deny'
                  ? 'We told them no. Nobody else was contacted, and your vault stayed closed.'
                  : 'They will be able to reach what you designated. You can close it again at any time.'}
              </p>
              <p className="mt-3 text-[16px] text-stone-600">Reference {r.case_id}</p>
            </div>
          );
        }

        return (
          <div key={r.id} className="rounded-lg border-2 border-amber-400 bg-white p-6">
            <p className="text-[16px] uppercase tracking-wide text-stone-500">
              Reference {r.case_id}
            </p>
            <h1 className="mt-2 text-2xl font-semibold">
              {r.recipient_name ?? 'Someone you trust'} is asking for access
            </h1>

            {r.reason && <p className="mt-3 text-stone-800">They said: &ldquo;{r.reason}&rdquo;</p>}

            <p className="mt-3 text-stone-700">{timeLeft(r.expires_at)}</p>

            <div className="mt-5 space-y-3">
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => respond(r.id, 'deny')}
                className="w-full rounded border-2 border-stone-800 bg-white px-5 py-4 font-semibold text-stone-900 hover:bg-stone-100 disabled:opacity-50"
              >
                I&rsquo;m fine — don&rsquo;t open anything
              </button>
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => respond(r.id, 'approve')}
                className="w-full rounded border-2 border-stone-800 bg-stone-800 px-5 py-4 font-semibold text-white hover:bg-stone-900 disabled:opacity-50"
              >
                Yes — let them in
              </button>
            </div>

            <p className="mt-4 text-[16px] text-stone-600">
              If you don&rsquo;t answer, we will ask the people you nominated to confirm whether
              this is real.
            </p>
          </div>
        );
      })}
    </div>
  );
}
