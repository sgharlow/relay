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
import { LimitsNotice, LimitsReminder } from './LimitsNotice';

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
  ownerLabel: string;
  acknowledgedLimits: boolean;
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
  // Mirrors data.acknowledgedLimits, so pressing the button reveals the plan
  // immediately rather than waiting on a round trip somebody is standing in.
  const [acknowledged, setAcknowledged] = useState(false);
  // A CLAIMED recipient is signed in and has no token at all. Until this existed
  // they were shown the code-entry form — asked for a credential the whole
  // architecture was built to stop sending them — because this component
  // returned early whenever `token` was empty. `null` means "not asked yet".
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  useEffect(() => {
    if (token) return; // A token wins: unclaimed recipients keep the old path.
    fetch('/api/auth/session')
      .then((r) => (r.ok ? r.json() : null))
      .then((s) => setSignedIn(Boolean(s?.user)))
      .catch(() => setSignedIn(false));
  }, [token]);

  useEffect(() => {
    // Either a token, or a session to resolve from. Neither yet → the code form.
    if (!token && !signedIn) return;
    // No token: the server resolves membership from the row (§3.7 rule 1).
    const url = token ? `/api/access?token=${encodeURIComponent(token)}` : '/api/access';
    fetch(url)
      .then(async (res) => {
        if (res.status === 403) {
          // The graceful close (J9-R4). A 403 carrying a summary means the owner
          // re-armed — they recovered, or it was a false alarm. That is the
          // product working, and this person just helped during someone's worst
          // week; an expiry error is the wrong last word.
          const body = (await res.json().catch(() => null)) as
            | { closed?: boolean; summary?: ClosureSummary | null }
            | null;
          if (body?.closed) {
            // `closed` alone is enough. Requiring a summary too meant a missing
            // one fell through to "invalid or has expired" — the sentence this
            // screen exists to replace — and a recipient who looked but opened
            // nothing legitimately has little to summarise. Zeroes are truthful.
            setClosure(
              body.summary ?? {
                grantedCount: 0,
                opened: [],
                firstSeenAt: null,
                lastSeenAt: null,
                hoursOfAccess: 0,
              },
            );
            return;
          }
          throw new Error('This access link is invalid or has expired.');
        }
        if (res.status === 401 && signedIn) {
          // Signed in, but nothing here is theirs — an owner who wandered in, a
          // verifier, a recipient whose owner has no release. Nothing is wrong,
          // and an outage-shaped sentence would say something is.
          throw new Error(
            'Nothing here is waiting for this account. If someone gave you a code, enter it below; if you were checking on someone you stand by for, that lives at /standby.',
          );
        }
        if (!res.ok) throw new Error('Unable to load your access right now.');
        setData((await res.json()) as Dashboard);
      })
      .catch((e) => setError(String(e.message)));
  }, [token, signedIn]);

  const decrypt = useCallback(
    async (item: AccessItem) => {
      try {
        const res = await fetch(`/api/access/${item.id}/decrypt`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          // Omitted entirely when signed in — an empty string is a token the
          // server would reject, which is how Reveal used to 401 on the session
          // path while the plan above it rendered perfectly well.
          body: JSON.stringify(token ? { token } : {}),
        });
        if (!res.ok) throw new Error('denied');
        const { plaintext_data_key, ciphertext } = (await res.json()) as { plaintext_data_key: string; ciphertext: string };
        const { iv, ciphertext: ct } = unpackIvCiphertext(base64ToBytes(ciphertext));
        const value = await new CryptoService().decryptItem(ct, iv, plaintext_data_key);
        setRevealed((r) => ({ ...r, [item.id]: value }));
      } catch {
        // Family words, not developer words — and never a guess that blames the
        // data. If a real item fails here, being told it "may be demo data" is
        // worse than no message at all.
        setRevealed((r) => ({ ...r, [item.id]: 'This one could not be opened just now. Try again — if it keeps happening, tell us at hello@relaystandby.com so a person can look.' }));
      }
    },
    [token],
  );

  if (closure) {
    return <ClosedGracefully summary={closure} />;
  }
  // Still asking whether they are signed in. Showing the code form here would
  // flash "type your code" at somebody who never received one.
  if (!token && signedIn === null) {
    return <p style={{ fontSize: 18, color: '#6b6257' }}>Loading…</p>;
  }
  if (!token && !signedIn) {
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
    return <p className="rounded-lg border border-ochre bg-ochre-soft px-5 py-4 text-ink">{error}</p>;
  }
  if (!data) {
    return <p className="text-muted">Loading your access…</p>;
  }

  if (!data.released) {
    return (
      <div>
        <h1 className="text-t7 font-semibold">Access not yet active</h1>
        <p className="mt-2 text-muted">
          You have access to the items below, but the release is still pending. You can see what is
          covered, but not the contents yet.
        </p>
        <ul className="mt-6 space-y-3">
          {data.items.map((item) => (
            <li key={item.id} className="rounded-lg border border-rule px-5 py-3">
              <div className="font-semibold">{item.title}</div>
              <div className="text-t2 text-muted">
                {item.service_name ?? item.type}
                {item.url ? ` · ${item.url}` : ''}
              </div>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  /*
    RELEASED, but not yet told what this is. The statement comes BEFORE the plan
    — after it, the reader has already seen the credentials and the disclosure is
    decoration. Shown once per recipient; lib/access/acknowledgement.ts explains
    why the record matters more than the render, and why a failed write still
    lets them through.
  */
  if (!data.acknowledgedLimits && !acknowledged) {
    return (
      <LimitsNotice
        ownerLabel={data.ownerLabel}
        token={token || undefined}
        onAcknowledged={() => setAcknowledged(true)}
      />
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
      <h1 className="text-t7 font-semibold">Your access plan</h1>
      <LimitsReminder ownerLabel={data.ownerLabel} />
      <p className="mt-2 text-muted">Work top to bottom — the most consequential items come first.</p>

      <div className="mt-8 space-y-8">
        {BUCKET_ORDER.filter((b) => grouped[b].length > 0).map((bucket) => (
          <section key={bucket}>
            <h2 className="mb-3 text-t5 font-semibold uppercase tracking-widest text-ochre-text">{BUCKET_LABELS[bucket]}</h2>
            <ol className="space-y-3">
              {grouped[bucket].map((item) => {
                // A render-local display counter, reset on every render — see its
                // declaration. The rule is right that it is a mutation during
                // render; it is bounded to numbering the list a reader sees, and
                // rewriting the recipient access plan is not a pre-beta change.
                // eslint-disable-next-line react-hooks/immutability
                step += 1;
                const value = revealed[item.id];
                return (
                  <li key={item.id} className="rounded-lg border border-rule px-5 py-4">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-t2 font-bold text-paper">
                            {step}
                          </span>
                          <span className="font-semibold">{item.title}</span>
                          {item.scope ? (
                            <span className="rounded bg-paper-sunken px-1.5 py-0.5 text-t1 font-medium text-muted">{item.scope}</span>
                          ) : null}
                        </div>
                        <div className="ml-8 text-t2 text-muted">{item.service_name ?? item.type}</div>
                      </div>
                      <button
                        onClick={() => decrypt(item)}
                        className="shrink-0 rounded bg-ink px-3 py-1.5 text-t2 font-semibold text-paper hover:bg-ink"
                      >
                        Reveal
                      </button>
                    </div>
                    {value !== undefined ? (
                      <pre className="ml-8 mt-3 whitespace-pre-wrap break-all rounded bg-ink px-3 py-2 text-t2 text-ochre-text">{value}</pre>
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
      <div className="rounded-2xl border border-rule bg-paper-raised px-6 py-7">
        <p className="text-[15px] uppercase tracking-wide text-muted">Access closed</p>
        <h1 className="mt-3 text-t7 font-semibold leading-snug text-ink">
          Everything is back to normal.
        </h1>
        <p className="mt-4 text-[18px] leading-relaxed text-ink">
          The vault has been re-armed, so this link no longer opens anything. That is the system
          working as intended — access was temporary, and it has now closed.
        </p>

        <div className="mt-6 rounded-xl bg-paper-sunken px-5 py-4">
          <p className="text-[17px] leading-relaxed text-ink">
            You were trusted with{' '}
            <span className="font-semibold text-ink">
              {grantedCount} {grantedCount === 1 ? 'item' : 'items'}
            </span>{' '}
            for {duration}.
          </p>

          {opened.length > 0 ? (
            <>
              <p className="mt-3 text-[17px] text-ink">
                You opened {opened.length} of them:
              </p>
              <ul className="mt-2 space-y-1">
                {opened.map((o) => (
                  <li key={`${o.title}-${o.openedAt}`} className="text-[17px] text-ink">
                    · {o.title}
                  </li>
                ))}
              </ul>
              {grantedCount > opened.length ? (
                <p className="mt-3 text-[16px] leading-relaxed text-muted">
                  {grantedCount - opened.length === 1
                    ? 'The other one was never opened.'
                    : `The other ${grantedCount - opened.length} were never opened.`}{' '}
                  The owner can see this too — it is on their permanent record, exactly as it
                  happened.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-[17px] leading-relaxed text-ink">
              You did not need to open any of them. That is recorded too.
            </p>
          )}
        </div>

        <p className="mt-6 text-[18px] leading-relaxed text-ink">
          Thank you for stepping in. If they need help again, you will get a new link.
        </p>
      </div>

      <p className="mt-4 px-2 text-[15px] leading-relaxed text-muted">
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
    <div className="mx-auto max-w-md rounded-2xl border border-rule bg-paper-raised px-6 py-7">
      <h1 className="text-t7 font-semibold leading-snug text-ink">Enter your code</h1>
      <p className="mt-3 text-[17px] leading-relaxed text-ink">
        Someone arranged for you to reach their accounts, and that access is open. Type the code
        from the email we sent you.
      </p>

      <form onSubmit={submit} className="mt-6">
        <label htmlFor="acode" className="block text-t2 font-medium text-ink">
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
          className="mt-2 min-h-[52px] w-full rounded-md border border-rule-strong px-4 text-center font-mono text-t7 tracking-[0.2em] text-ink placeholder:text-muted focus:border-rule focus:outline-none"
        />

        {err ? <p className="mt-3 text-[16px] text-clay">{err}</p> : null}

        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="mt-5 min-h-[52px] w-full rounded-md bg-ink px-6 text-[17px] font-semibold text-paper hover:bg-ink disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>

      <ExpiredCodeHelp />

      <p className="mt-6 text-[15px] leading-relaxed text-muted">
        A real message from Relay never asks you to click a link and then enter anything.
      </p>
    </div>
  );
}

/**
 * "My code expired."
 *
 * A recipient's access lasts 24 hours and the only way to re-issue it used to
 * be an owner-authenticated endpoint — the owner being, by the nature of this
 * product, the person in hospital. Hospital stays are days to weeks, so a
 * caregiver who came back on day three was locked out with nobody able to help.
 *
 * The new code goes to the address on file, never the one typed here, so this
 * cannot be used to redirect access or to discover who is named on a vault.
 */
function ExpiredCodeHelp() {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  if (sent) {
    return (
      <p className="mt-6 rounded-md bg-paper-sunken px-4 py-3 text-[16px] leading-relaxed text-ink">
        If that address has active access, a new code is on its way. It can take a minute to arrive.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 text-[16px] text-muted underline underline-offset-4 hover:text-ink"
      >
        My code has expired
      </button>
    );
  }

  return (
    <form
      className="mt-5 rounded-md bg-paper-sunken p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        try {
          await fetch('/api/access/resend', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email }),
          });
        } finally {
          setBusy(false);
          setSent(true);
        }
      }}
    >
      <label htmlFor="resend" className="block text-[15px] font-medium text-ink">
        Your email address
      </label>
      <input
        id="resend"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-2 min-h-[48px] w-full rounded-md border border-rule-strong px-4 text-[17px]"
        placeholder="you@example.com"
      />
      <button
        type="submit"
        disabled={busy}
        className="mt-3 min-h-[48px] w-full rounded-md border border-rule-strong bg-paper-raised px-4 text-[16px] font-medium text-ink hover:bg-paper-sunken disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send me a new code'}
      </button>
      <p className="mt-2 text-[14px] leading-relaxed text-muted">
        We send it to the address already on file, so this only works if you are the person who was
        given access.
      </p>
    </form>
  );
}
