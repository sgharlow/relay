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
  const [loadFailed, setLoadFailed] = useState(false);
  const [sendFailed, setSendFailed] = useState<string | null>(null);

  /*
    🔴 A FAILED LOAD USED TO RENDER THE CALMING EMPTY STATE. Any non-ok
    response became `setRequests([])`, which draws "Nobody is asking for
    access" — the one sentence on this screen that lowers someone's guard,
    shown precisely when the truth was unknowable. On the screen with a
    two-hour clock that escalates to the verifiers, a 500 must never
    impersonate an all-clear.
  */
  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/access-requests');
      if (!res.ok) throw new Error(String(res.status));
      setRequests(((await res.json()).requests ?? []) as Request[]);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /*
    🔴 AN ANSWER COULD FAIL IN SILENCE, AND WEDGE THE BUTTONS. respond() had no
    try/catch and no error state: a non-ok response did nothing at all — the
    owner taps "I'm fine — don't open anything", believes they denied, and the
    request keeps escalating — and a network throw skipped setBusy(null),
    leaving both buttons disabled forever. On the screen its own header says is
    read from a hospital bed. finally clears busy on every path; a failure now
    says so, out loud, next to the buttons that still work.
  */
  async function respond(id: string, response: 'approve' | 'deny') {
    setBusy(id);
    setSendFailed(null);
    try {
      const res = await fetch(`/api/access-requests/${id}/respond`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ response }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setDone((d) => ({ ...d, [id]: response }));
    } catch {
      setSendFailed(id);
    } finally {
      setBusy(null);
    }
  }

  if (loadFailed) {
    return (
      <div className="mx-auto max-w-xl text-[18px]">
        <h1 className="text-t7 font-semibold text-ink">We could not check just now</h1>
        <p className="mt-3 text-ink">
          This is a loading problem, not an answer — it does not mean nobody is asking. Please
          reload the page. If this keeps happening, email{' '}
          <a href="mailto:hello@relaystandby.com" className="underline underline-offset-2">
            hello@relaystandby.com
          </a>
          .
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="mt-5 rounded border-2 border-rule-strong bg-paper-raised px-5 py-3 font-semibold text-ink hover:bg-paper-sunken"
        >
          Try again
        </button>
      </div>
    );
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

            {/*
              🔴 THE RENDER CONTRADICTED THE HEADER. This file's own comment
              says "neither is styled to look like the correct one" (J6-R3) —
              and "Yes — let them in" was a filled ink button above an outlined
              deny. The same defect J7-R6 named on the verifier screen, fixed
              there on 2026-08-12, standing here the whole time. Both answers
              now share one treatment, exactly as the verifier's do: the words
              differ, nothing else does.
            */}
            <div className="mt-5 space-y-3">
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => respond(r.id, 'deny')}
                className="w-full rounded border-2 border-rule-strong bg-paper-raised px-5 py-4 font-semibold text-ink hover:bg-paper-sunken disabled:opacity-50"
              >
                I&rsquo;m fine — don&rsquo;t open anything
              </button>
              <button
                type="button"
                disabled={busy === r.id}
                onClick={() => respond(r.id, 'approve')}
                className="w-full rounded border-2 border-rule-strong bg-paper-raised px-5 py-4 font-semibold text-ink hover:bg-paper-sunken disabled:opacity-50"
              >
                Yes — let them in
              </button>
            </div>

            {sendFailed === r.id && (
              <p className="mt-3 rounded border border-ochre bg-ochre-soft px-4 py-3 text-[16px] text-ochre-text">
                Your answer did not go through — nothing was recorded either way. Please try
                again; the buttons above still work.
              </p>
            )}

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
