'use client';

/**
 * Recipient access dashboard (Requirement 7 / task 22.2).
 *
 * Reads the scoped recipient token from `?token=`, loads GET /api/access, and:
 *  - invalid/expired token → a calm error message,
 *  - not RELEASED → pending view (limited fields, "Access not yet active"),
 *  - RELEASED → a numbered step plan grouped by time-horizon bucket. Clicking an
 *    item POSTs to /api/access/[id]/decrypt and decrypts in-browser via
 *    CryptoService; the revealed value lives only in component state (cleared on
 *    navigate).
 *
 * Feature: relay-h0-mvp
 */

import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { bucketFor, BUCKET_ORDER, BUCKET_LABELS, type Bucket } from '../../../../lib/ai/buckets';
import { CryptoService, base64ToBytes, unpackIvCiphertext } from '../../../../lib/crypto/crypto-service';

interface AccessItem {
  id: string;
  title: string;
  service_name: string | null;
  url: string | null;
  category: string | null;
  type: string;
  scope?: string;
  is_root_credential?: boolean;
  importance_score?: number;
}
interface Dashboard {
  state: string;
  released: boolean;
  items: AccessItem[];
}

export default function AccessClient() {
  const urlToken = useSearchParams().get('token') ?? '';
  // A typed code becomes a token in memory. The credential never enters the
  // URL, so a forwarded email no longer carries access to a parent's accounts.
  const [token, setToken] = useState(urlToken);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closure, setClosure] = useState<ClosureSummary | null>(null);
  const [revealed, setRevealed] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!token) return; // No token yet — the code form is shown instead.
    fetch(`/api/access?token=${encodeURIComponent(token)}`)
      .then(async (res) => {
        if (res.status === 403) {
          // The graceful close (J9-R4). A 403 carrying a summary means the owner
          // re-armed — they recovered, or it was a false alarm. That is the
          // product working, and this person just helped during someone's worst
          // week; an expiry error is the wrong last word.
          const body = (await res.json().catch(() => null)) as
            | { closed?: boolean; summary?: ClosureSummary }
            | null;
          if (body?.closed && body.summary) {
            setClosure(body.summary);
            return;
          }
          throw new Error('This access link is invalid or has expired.');
        }
        if (!res.ok) throw new Error('Unable to load your access right now.');
        setData((await res.json()) as Dashboard);
      })
      .catch((e) => setError(String(e.message)));
  }, [token]);

  const decrypt = useCallback(
    async (item: AccessItem) => {
      try {
        const res = await fetch(`/api/access/${item.id}/decrypt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) throw new Error('denied');
        const { plaintext_data_key, ciphertext } = (await res.json()) as { plaintext_data_key: string; ciphertext: string };
        const { iv, ciphertext: ct } = unpackIvCiphertext(base64ToBytes(ciphertext));
        const value = await new CryptoService().decryptItem(ct, iv, plaintext_data_key);
        setRevealed((r) => ({ ...r, [item.id]: value }));
      } catch {
        setRevealed((r) => ({ ...r, [item.id]: '⚠️ Could not decrypt (the item may be demo/seed data).' }));
      }
    },
    [token],
  );

  if (closure) {
    return <ClosedGracefully summary={closure} />;
  }
  if (!token) {
    return (
      <AccessCodeEntry
        onToken={setToken}
        // A code whose release was re-armed cannot produce a token, so the full
        // graceful close (which needs one) is unreachable here. Say the same
        // thing in the same voice rather than reporting a failure: this person
        // did nothing wrong and the good outcome happened.
        onClosed={() =>
          setError(
            'Access has been closed — the person who arranged it has checked in and is fine. ' +
              'Nothing is wrong, and there is nothing you need to do. Thank you for stepping in.',
          )
        }
      />
    );
  }
  if (error) {
    return <p className="rounded-lg border border-amber-300 bg-amber-50 px-5 py-4 text-stone-700">{error}</p>;
  }
  if (!data) {
    return <p className="text-stone-500">Loading your access…</p>;
  }

  if (!data.released) {
    return (
      <div>
        <h1 className="text-2xl font-bold">Access not yet active</h1>
        <p className="mt-2 text-stone-600">
          You have access to the items below, but the release is still pending. You can see what is
          covered, but not the contents yet.
        </p>
        <ul className="mt-6 space-y-3">
          {data.items.map((item) => (
            <li key={item.id} className="rounded-lg border border-stone-200 px-5 py-3">
              <div className="font-semibold">{item.title}</div>
              <div className="text-sm text-stone-500">
                {item.service_name ?? item.type}
                {item.url ? ` · ${item.url}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  // RELEASED — group into time-horizon buckets, number steps across the plan.
  const grouped: Record<Bucket, AccessItem[]> = { do_today: [], this_week: [], within_30_days: [] };
  for (const item of data.items) {
    grouped[bucketFor({ importance_score: item.importance_score ?? 0, is_root_credential: !!item.is_root_credential })].push(item);
  }
  let step = 0;

  return (
    <div>
      <h1 className="text-2xl font-bold">Your access plan</h1>
      <p className="mt-2 text-stone-600">Work top to bottom — the most consequential items come first.</p>

      <div className="mt-8 space-y-8">
        {BUCKET_ORDER.filter((b) => grouped[b].length > 0).map((bucket) => (
          <section key={bucket}>
            <h2 className="mb-3 text-sm font-bold uppercase tracking-widest text-amber-700">{BUCKET_LABELS[bucket]}</h2>
            <ol className="space-y-3">
              {grouped[bucket].map((item) => {
                step += 1;
                const value = revealed[item.id];
                return (
                  <li key={item.id} className="rounded-lg border border-stone-200 px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-amber-600 text-sm font-bold text-white">
                            {step}
                          </span>
                          <span className="font-semibold">{item.title}</span>
                          {item.scope ? (
                            <span className="rounded bg-stone-100 px-1.5 py-0.5 text-xs font-medium text-stone-600">{item.scope}</span>
                          ) : null}
                        </div>
                        <div className="ml-8 text-sm text-stone-500">{item.service_name ?? item.type}</div>
                      </div>
                      <button
                        onClick={() => decrypt(item)}
                        className="shrink-0 rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700"
                      >
                        Reveal
                      </button>
                    </div>
                    {value !== undefined ? (
                      <pre className="ml-8 mt-3 whitespace-pre-wrap break-all rounded bg-stone-900 px-3 py-2 text-sm text-amber-100">{value}</pre>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}

interface ClosureSummary {
  grantedCount: number;
  opened: Array<{ title: string; openedAt: string }>;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  hoursOfAccess: number;
}

/**
 * The graceful close (J9-R4) — the last screen Relay ever shows a recipient.
 *
 * It used to say "This access link is invalid or has expired," which reads as a
 * malfunction, or worse as an accusation, to someone who dropped everything to
 * help during a family emergency. What actually happened is the good outcome:
 * the person recovered, and the product closed access exactly as promised. That
 * is the story worth telling, and this is the moment a family decides whether to
 * recommend Relay.
 *
 * Access-mode voice: warm, larger type, no chrome, no next step demanded.
 */
function ClosedGracefully({ summary }: { summary: ClosureSummary }) {
  const { grantedCount, opened, hoursOfAccess } = summary;

  // "under an hour" is both friendlier and more accurate than "0 hours" for the
  // common case of a single short visit.
  const duration =
    hoursOfAccess < 1
      ? 'under an hour'
      : hoursOfAccess === 1
        ? 'about an hour'
        : `about ${hoursOfAccess} hours`;

  return (
    <div className="mx-auto max-w-xl">
      <div className="rounded-2xl border border-stone-200 bg-white px-6 py-7">
        <p className="text-[15px] uppercase tracking-wide text-stone-500">Access closed</p>
        <h1 className="mt-3 text-[26px] font-semibold leading-snug text-stone-900">
          Everything is back to normal.
        </h1>
        <p className="mt-4 text-[18px] leading-relaxed text-stone-700">
          The vault has been re-armed, so this link no longer opens anything. That is the system
          working as intended — access was temporary, and it has now closed.
        </p>

        <div className="mt-6 rounded-xl bg-stone-50 px-5 py-4">
          <p className="text-[17px] leading-relaxed text-stone-700">
            You were trusted with{' '}
            <span className="font-semibold text-stone-900">
              {grantedCount} {grantedCount === 1 ? 'item' : 'items'}
            </span>{' '}
            for {duration}.
          </p>

          {opened.length > 0 ? (
            <>
              <p className="mt-3 text-[17px] text-stone-700">
                You opened {opened.length} of them:
              </p>
              <ul className="mt-2 space-y-1">
                {opened.map((o) => (
                  <li key={`${o.title}-${o.openedAt}`} className="text-[17px] text-stone-800">
                    · {o.title}
                  </li>
                ))}
              </ul>
              {grantedCount > opened.length ? (
                <p className="mt-3 text-[16px] leading-relaxed text-stone-600">
                  {grantedCount - opened.length === 1
                    ? 'The other one was never opened.'
                    : `The other ${grantedCount - opened.length} were never opened.`}{' '}
                  The owner can see this too — it is on their permanent record, exactly as it
                  happened.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-[17px] leading-relaxed text-stone-700">
              You did not need to open any of them. That is recorded too.
            </p>
          )}
        </div>

        <p className="mt-6 text-[18px] leading-relaxed text-stone-700">
          Thank you for stepping in. If they need help again, you will get a new link.
        </p>
      </div>

      <p className="mt-4 px-2 text-[15px] leading-relaxed text-stone-500">
        Nothing you saw is stored on this device, and this page holds no vault contents.
      </p>
    </div>
  );
}

/**
 * Code entry — the recipient's front door.
 *
 * Replaces a signed token in the URL for the higher-value of the two
 * credentials: this one opens the vault. Forwarding the email to a sibling used
 * to hand over access to a parent's accounts.
 *
 * A code whose release has been re-armed reports `closed` rather than a
 * failure, because that recipient did nothing wrong and the good outcome
 * happened — the owner recovered.
 */
function AccessCodeEntry({ onToken, onClosed }: { onToken: (t: string) => void; onClosed: () => void }) {
  const [code, setCode] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch('/api/access/code', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      const body = (await res.json().catch(() => ({}))) as { token?: string; reason?: string; message?: string };
      if (res.ok && body.token) {
        onToken(body.token);
        return;
      }
      if (body.reason === 'closed') {
        onClosed();
        return;
      }
      setErr(body.message ?? 'That code was not recognised.');
    } catch {
      setErr('We could not reach the server. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md rounded-2xl border border-stone-200 bg-white px-6 py-7">
      <h1 className="text-[26px] font-semibold leading-snug text-stone-900">Enter your code</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-stone-700">
        Someone arranged for you to reach their accounts, and that access is open. Type the code
        from the email we sent you.
      </p>

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="acode" className="block text-sm font-medium text-stone-700">
          Code from your email
        </label>
        <input
          id="acode"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          placeholder="7K4M-P2XW"
          className="mt-2 min-h-[52px] w-full rounded-md border border-stone-400 px-4 text-center font-mono text-2xl tracking-[0.2em] text-stone-900 placeholder:text-stone-300 focus:border-stone-900 focus:outline-none"
        />

        {err ? <p className="mt-3 text-[16px] text-red-700">{err}</p> : null}

        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="mt-5 min-h-[52px] w-full rounded-md bg-stone-900 px-6 text-[17px] font-semibold text-white hover:bg-stone-800 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>

      <p className="mt-6 text-[15px] leading-relaxed text-stone-500">
        Relay will never send you a link that signs you in.
      </p>
    </div>
  );
}
