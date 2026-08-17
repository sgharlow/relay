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
import {
  decodeSecretPayload,
  recoveryCodesOf,
  KIND_LABELS,
  MASKED_KINDS,
  type SecretField,
} from '../../../../lib/crypto/secret-payload';
import { parseOtpauth, generateTotp } from '../../../../lib/crypto/totp';
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
  /**
   * The owner's own words about this item. Present only on the RELEASED
   * dashboard — `toLimited` withholds it while a release is still pending, on
   * purpose (see lib/access/dashboard.ts).
   */
  backup_note?: string | null;
}
interface Dashboard {
  state: string;
  released: boolean;
  items: AccessItem[];
  ownerLabel: string;
  acknowledgedLimits: boolean;
}
/** One open release, when a contact is standing by for more than one person. */
interface OwnerChoice {
  ownerId: string;
  ownerLabel: string;
  state: string;
  released: boolean;
}

export default function AccessClient() {
  const urlToken = useSearchParams().get('token') ?? '';
  // A typed code becomes a token in memory. The credential never enters the
  // URL, so a forwarded email no longer carries access to a parent's accounts.
  const [token, setToken] = useState(urlToken);
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [closure, setClosure] = useState<ClosureSummary | null>(null);
  /*
    A DISCRIMINATED UNION, not a bare string, since 2026-08-17. The failure path
    used to store its apology in the same slot as the secret — which was harmless
    while everything was rendered into a `<pre>`, and became wrong the moment the
    payload started being PARSED: "This one could not be opened just now" would
    have been decoded and displayed under the label "Password".
  */
  const [revealed, setRevealed] = useState<Record<string, { ok: true; plaintext: string } | { ok: false; message: string }>>({});
  // Mirrors data.acknowledgedLimits, so pressing the button reveals the plan
  // immediately rather than waiting on a round trip somebody is standing in.
  const [acknowledged, setAcknowledged] = useState(false);
  // A CLAIMED recipient is signed in and has no token at all. Until this existed
  // they were shown the code-entry form — asked for a credential the whole
  // architecture was built to stop sending them — because this component
  // returned early whenever `token` was empty. `null` means "not asked yet".
  const [signedIn, setSignedIn] = useState<boolean | null>(null);
  /*
    More than one person this contact stands by for needs them at once.

    🔴 THIS USED TO COLLAPSE SILENTLY. The server resolved with `LIMIT 1` and no
    tiebreak, so an adult child standing by for both parents saw one plan and had
    nothing on the page suggesting the other existed. Rare — and exactly the
    situation this product is for, which is why rarity was never the answer.

    `owner` is the choice once made; `choices` is the list while it has not been.
  */
  const [choices, setChoices] = useState<OwnerChoice[] | null>(null);
  const [owner, setOwner] = useState<string | null>(null);

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
    // `owner` carries the choice when this contact stands by for more than one.
    const url = token
      ? `/api/access?token=${encodeURIComponent(token)}`
      : owner
        ? `/api/access?owner=${encodeURIComponent(owner)}`
        : '/api/access';
    fetch(url)
      .then(async (res) => {
        if (res.status === 403) {
          // The graceful close (J9-R4). A 403 carrying a summary means the owner
          // re-armed — they recovered, or it was a false alarm. That is the
          // product working, and this person just helped during someone's worst
          // week; an expiry error is the wrong last word.
          const body = (await res.json().catch(() => null)) as
            | {
                closed?: boolean;
                pending?: boolean;
                choose?: boolean;
                releases?: OwnerChoice[];
                message?: string;
                summary?: ClosureSummary | null;
              }
            | null;
          // Checked FIRST. Two people needing this contact at once is not an
          // error, a close, or a wait — it is a question, and every branch below
          // would answer it with the wrong screen.
          if (body?.choose && body.releases?.length) {
            setChoices(body.releases);
            return;
          }
          /*
            A release that is PENDING or in GRACE is not an expired link and not
            a closed one — it is the wait. This branch used to fall through to
            "This access link is invalid or has expired", telling a family member
            that the product was broken at the exact moment it was working: the
            owner had been asked and had not yet answered. The server's sentence
            is the true one, so it is shown rather than replaced.
          */
          if (body?.pending) {
            throw new Error(
              body.message ??
                'Nothing is open yet. You do not need to do anything.',
            );
          }
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
  }, [token, signedIn, owner]);

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
        if (!res.ok) {
          /*
            🔴 THE SERVER'S ANSWER WAS THROWN AWAY, AND IT WAS THE ONLY USEFUL
            ONE. dashboard.ts computes "Not open yet — this one was set to open
            on Tue Sep 02 2026." with a comment saying why it matters: a
            recipient who was promised something needs to know it is COMING, not
            conclude the plan is broken. The client discarded it and rendered
            "could not be opened just now. Try again — if it keeps happening,
            tell us" — instructing somebody to retry forever and report a bug
            against a staged delay working exactly as the owner configured it.

            Only `explainable` messages are surfaced. The other denials say
            "Session is stale (release version changed)" and "Item not in scope",
            which are for us, not for a family in an emergency.
          */
          const body = (await res.json().catch(() => null)) as
            | { message?: string; explainable?: boolean }
            | null;
          if (body?.explainable && body.message) {
            // An explainable denial is a message, not a secret — same slot, and
            // the discriminant is what keeps it from being decoded as one.
            setRevealed((r) => ({ ...r, [item.id]: { ok: false, message: body.message as string } }));
            return;
          }
          throw new Error('denied');
        }
        const { plaintext_data_key, ciphertext } = (await res.json()) as { plaintext_data_key: string; ciphertext: string };
        const { iv, ciphertext: ct } = unpackIvCiphertext(base64ToBytes(ciphertext));
        const value = await new CryptoService().decryptItem(ct, iv, plaintext_data_key);
        setRevealed((r) => ({ ...r, [item.id]: { ok: true, plaintext: value } }));
      } catch {
        // Family words, not developer words — and never a guess that blames the
        // data. If a real item fails here, being told it "may be demo data" is
        // worse than no message at all.
        setRevealed((r) => ({ ...r, [item.id]: { ok: false, message: 'This one could not be opened just now. Try again — if it keeps happening, tell us at hello@relaystandby.com so a person can look.' } }));
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
    return <p style={{ fontSize: 'var(--t4)', color: '#6b6257' }}>Loading…</p>;
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
  /*
    Two people need this contact at once.

    Placed BEFORE the error and loading branches: it arrives as a 403, and every
    branch below would render it as a failure. It is the opposite of a failure —
    it is the product noticing something a single-owner screen would have hidden.

    Names, not identifiers, and the state of each in plain words. Somebody
    reading this is deciding which parent to attend to first; "released" and
    "grace" are our vocabulary, not theirs.
  */
  if (choices && !owner) {
    return (
      <div>
        <h1 className="text-t7 font-semibold">Two people need you</h1>
        <p className="mt-2 text-muted">
          You stand by for more than one person, and more than one of them has something happening
          right now. Choose who to help first — the other will still be here.
        </p>
        <ul className="mt-6 space-y-3">
          {choices.map((c) => (
            <li key={c.ownerId}>
              {/*
                `flex-col items-start` is LOAD-BEARING, not decoration. globals.css
                gives every button `display: inline-flex; align-items: center;
                justify-content: center` under `(max-width: 720px), (pointer:
                coarse)` — the touch-target rule — so on the phone this screen is
                specified for, two stacked spans become two flex items IN A ROW.
                The name and the sentence about it sat side by side, the name
                wrapped mid-word into a narrow column, and it looked broken on
                exactly the device J8 describes. Found by screenshotting it; no
                assertion in this file's E2E walk noticed, because every one of
                them passed on the text being present.
              */}
              <button
                type="button"
                onClick={() => setOwner(c.ownerId)}
                className="flex w-full min-h-[44px] flex-col items-start justify-center rounded-lg border border-rule-strong px-5 py-4 text-left hover:bg-ochre-soft"
              >
                <span className="block text-t4 font-semibold text-ink">{c.ownerLabel}</span>
                <span className="mt-1 block text-t2 text-muted">
                  {c.released
                    ? 'Open now — you can see what they left you.'
                    : 'Being confirmed. Nothing is open yet, and you do not need to do anything.'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <p className="rounded-lg border border-ochre bg-ochre-soft px-5 py-4 text-ink">{error}</p>
        {/* Only after a choice was made: the way back to the other person. */}
        {choices && owner ? (
          <button
            type="button"
            onClick={() => {
              setOwner(null);
              setError(null);
            }}
            className="mt-4 min-h-[44px] rounded-lg border border-rule-strong px-5 text-t2 text-ink hover:bg-ochre-soft"
          >
            Someone else you stand by for
          </button>
        ) : null}
      </div>
    );
  }
  if (!data) {
    return <p className="text-muted">Loading your access…</p>;
  }

  /*
    The way back, once a choice has been made.

    Quiet and at the bottom of every branch below — a switcher at the TOP of a
    dashboard invites somebody mid-emergency to wonder whether they are looking
    at the right person's plan. The heading already says whose it is. This is for
    when they have finished here.

    Rendered only when a choice was actually offered; a contact standing by for
    one person never sees it.
  */
  const otherOwner =
    choices && choices.length > 1 ? (
      <button
        type="button"
        onClick={() => {
          setOwner(null);
          setData(null);
        }}
        className="mt-10 min-h-[44px] rounded-lg border border-rule px-5 text-t2 text-muted hover:bg-ochre-soft"
      >
        Someone else you stand by for
      </button>
    ) : null;

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
        {otherOwner}
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

  /*
    🔴 R7.2's PAGE DID NOT EXIST. The requirement is explicit: "IF the Recipient
    has no Access_Rules for the RELEASED trigger_type, THEN THE Access_Dashboard
    SHALL display a pending-status page with a message indicating no items are
    scoped to this Recipient." What actually rendered was the normal plan
    heading — "Your access plan… Work top to bottom, the most consequential
    items come first" — above nothing at all.

    That lands on somebody who has just been told an emergency is real and that
    something was left for them. An empty list under a confident heading reads
    as "it broke" or "someone took it", at the moment they are least able to
    absorb either. It is reachable without anything being wrong: the owner
    scoped their rules to a different trigger type, or removed the last rule
    after naming the person.

    The words avoid blame in both directions — nothing is broken, and nobody
    did anything wrong — and point at the only useful next step, which is a
    conversation with the family rather than with us.
  */
  if (data.items.length === 0) {
    return (
      <div>
        <h1 className="text-t7 font-semibold">Nothing was set aside for you here</h1>
        <p className="mt-4 text-t4 leading-relaxed">
          {data.ownerLabel} named you, and access is open — but none of their items are scoped to
          you for this situation. That is not a fault, and nothing has been taken away: it usually
          means what they arranged for you sits under a different circumstance than the one that
          opened.
        </p>
        <p className="mt-4 text-t4 leading-relaxed">
          There is nothing for you to do here. If you were expecting something, the people around{' '}
          {data.ownerLabel} are the right place to ask — we cannot see what is inside their vault,
          only that none of it is pointed at you.
        </p>
        {otherOwner}
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
                        {/*
                          The owner's own note, and the reason the field exists at
                          all: detectGaps calls it out as "a recipient may not know
                          where the original is kept or how to recover it". Until
                          2026-08-17 nothing could write it and nothing showed it.

                          Shown WITHOUT clicking Reveal, deliberately. It is
                          non-secret metadata, and it is most useful exactly when
                          the secret turns out not to work — which is the moment a
                          person is least inclined to go hunting for another
                          button. Italic because these are a person's words, not
                          the product's.
                        */}
                        {item.backup_note ? (
                          <p className="ml-8 mt-2 max-w-prose text-t2 italic text-ink">{item.backup_note}</p>
                        ) : null}
                      </div>
                      <button
                        onClick={() => decrypt(item)}
                        className="shrink-0 rounded bg-ink px-3 py-1.5 text-t2 font-semibold text-paper hover:bg-ink"
                      >
                        Reveal
                      </button>
                    </div>
                    {value === undefined ? null : value.ok ? (
                      <RevealedItem plaintext={value.plaintext} />
                    ) : (
                      <p className="ml-8 mt-3 text-t2 text-muted">{value.message}</p>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
      {otherOwner}
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
        <p className="text-t3 uppercase tracking-wide text-muted">Access closed</p>
        <h1 className="mt-3 text-t7 font-semibold leading-snug text-ink">
          Everything is back to normal.
        </h1>
        <p className="mt-4 text-t4 leading-relaxed text-ink">
          The vault has been re-armed, so this link no longer opens anything. That is the system
          working as intended — access was temporary, and it has now closed.
        </p>

        <div className="mt-6 rounded-xl bg-paper-sunken px-5 py-4">
          <p className="text-t4 leading-relaxed text-ink">
            You were trusted with{' '}
            <span className="font-semibold text-ink">
              {grantedCount} {grantedCount === 1 ? 'item' : 'items'}
            </span>{' '}
            for {duration}.
          </p>

          {opened.length > 0 ? (
            <>
              <p className="mt-3 text-t4 text-ink">
                You opened {opened.length} of them:
              </p>
              <ul className="mt-2 space-y-1">
                {opened.map((o) => (
                  <li key={`${o.title}-${o.openedAt}`} className="text-t4 text-ink">
                    · {o.title}
                  </li>
                ))}
              </ul>
              {grantedCount > opened.length ? (
                <p className="mt-3 text-t3 leading-relaxed text-muted">
                  {grantedCount - opened.length === 1
                    ? 'The other one was never opened.'
                    : `The other ${grantedCount - opened.length} were never opened.`}{' '}
                  The owner can see this too — it is on their permanent record, exactly as it
                  happened.
                </p>
              ) : null}
            </>
          ) : (
            <p className="mt-3 text-t4 leading-relaxed text-ink">
              You did not need to open any of them. That is recorded too.
            </p>
          )}
        </div>

        <p className="mt-6 text-t4 leading-relaxed text-ink">
          Thank you for stepping in. If they need help again, you will get a new link.
        </p>
      </div>

      <p className="mt-4 px-2 text-t3 leading-relaxed text-muted">
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
      <p className="mt-3 text-t4 leading-relaxed text-ink">
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

        {err ? <p className="mt-3 text-t3 text-clay">{err}</p> : null}

        <button
          type="submit"
          disabled={busy || !code.trim()}
          className="mt-5 min-h-[52px] w-full rounded-md bg-ink px-6 text-t4 font-semibold text-paper hover:bg-ink disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </form>

      <ExpiredCodeHelp />

      <p className="mt-6 text-t3 leading-relaxed text-muted">
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
      <p className="mt-6 rounded-md bg-paper-sunken px-4 py-3 text-t3 leading-relaxed text-ink">
        If that address has active access, a new code is on its way. It can take a minute to arrive.
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-5 text-t3 text-muted underline underline-offset-4 hover:text-ink"
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
      <label htmlFor="resend" className="block text-t3 font-medium text-ink">
        Your email address
      </label>
      <input
        id="resend"
        type="email"
        required
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="mt-2 min-h-[48px] w-full rounded-md border border-rule-strong px-4 text-t4"
        placeholder="you@example.com"
      />
      <button
        type="submit"
        disabled={busy}
        className="mt-3 min-h-[48px] w-full rounded-md border border-rule-strong bg-paper-raised px-4 text-t3 font-medium text-ink hover:bg-paper-sunken disabled:opacity-50"
      >
        {busy ? 'Sending…' : 'Send me a new code'}
      </button>
      <p className="mt-2 text-t2 leading-relaxed text-muted">
        We send it to the address already on file, so this only works if you are the person who was
        given access.
      </p>
    </form>
  );
}

/**
 * What a recipient actually sees when they open an item.
 *
 * 🔴 THIS WAS `<pre>{value}</pre>` UNTIL 2026-08-17, and it was already wrong for
 * every imported item. The CSV import encrypted `JSON.stringify({username,
 * password})`, so somebody at the worst moment of their life was shown
 *
 *     {"username":"steve@example.com","password":"hunter2"}
 *
 * The fix needed no migration and touched no stored row: the server cannot read
 * plaintext, so nothing could have been rewritten anyway. `decodeSecretPayload`
 * understands that legacy shape, and this renders whatever comes back.
 */
function RevealedItem({ plaintext }: { plaintext: string }) {
  const fields = decodeSecretPayload(plaintext);
  if (fields.length === 0) return null;

  return (
    <div className="ml-8 mt-3 space-y-2">
      {fields.map((field, i) =>
        field.kind === 'totp' ? (
          <TotpField key={i} value={field.value} />
        ) : field.kind === 'recovery_codes' ? (
          <RecoveryCodesField key={i} codes={recoveryCodesOf([field])} />
        ) : (
          <PlainField key={i} field={field} />
        ),
      )}
    </div>
  );
}

/** A labelled value, masked if it is the kind of thing shoulder-surfers read. */
function PlainField({ field }: { field: SecretField }) {
  const [shown, setShown] = useState(!MASKED_KINDS.has(field.kind));
  return (
    <div className="rounded bg-ink px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-t1 uppercase tracking-wide text-paper opacity-70">
          {field.label ?? KIND_LABELS[field.kind]}
        </span>
        <div className="flex shrink-0 gap-2">
          {MASKED_KINDS.has(field.kind) ? (
            <button
              type="button"
              onClick={() => setShown((s) => !s)}
              className="text-t1 text-paper underline opacity-80"
            >
              {shown ? 'Hide' : 'Show'}
            </button>
          ) : null}
          <CopyButton value={field.value} />
        </div>
      </div>
      <p className="mt-1 whitespace-pre-wrap break-all font-mono text-t2 text-ochre-text">
        {shown ? field.value : '•'.repeat(Math.min(field.value.length, 24))}
      </p>
    </div>
  );
}

/**
 * The live six-digit code.
 *
 * ⚠️ THIS IS THE WHOLE POINT OF STORING A SECOND FACTOR. Handing somebody
 * `JBSWY3DPEHPK3PXP` is very nearly useless — they are not going to install an
 * authenticator app and enrol a seed during the worst week of their life. The
 * six digits, now, with a countdown, is the difference between a plan that works
 * and one that only looks like it does.
 *
 * The seed is already decrypted in this browser; nothing here reaches the
 * network, and no new dependency is involved.
 */
function TotpField({ value }: { value: string }) {
  const params = parseOtpauth(value);
  const [code, setCode] = useState<{ code: string; secondsRemaining: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!params) return;
    let live = true;
    const tick = () => {
      generateTotp(params, Date.now())
        .then((c) => {
          if (live) setCode(c);
        })
        .catch(() => {
          if (live) setFailed(true);
        });
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => {
      live = false;
      clearInterval(id);
    };
    // `value` rather than `params`: parseOtpauth returns a fresh object each
    // render, which would restart the interval every second.
  }, [value]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!params || failed) {
    /*
      An unreadable seed still gets shown raw. It is not useful to most people,
      but somebody technical may be helping — and silently dropping a field the
      owner deliberately stored would be worse than showing something puzzling.
    */
    return <PlainField field={{ kind: 'note', label: 'Two-factor secret', value }} />;
  }

  return (
    <div className="rounded bg-ink px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-t1 uppercase tracking-wide text-paper opacity-70">
          {KIND_LABELS.totp}
        </span>
        {code ? <CopyButton value={code.code} /> : null}
      </div>
      {code ? (
        <>
          <p className="mt-1 font-mono text-t5 tracking-[0.2em] text-ochre-text">{code.code}</p>
          <p className="text-t1 text-paper opacity-70">
            {/*
              The countdown is not decoration. RFC 6238 is a function of the
              device clock, and nobody here can check it — a recipient whose
              laptop is wrong gets codes the service rejects and will blame
              Relay. Showing the window at least gives the failure a visible
              cause.
            */}
            New code in {code.secondsRemaining}s · type it straight after the password
          </p>
        </>
      ) : (
        <p className="mt-1 text-t2 text-paper opacity-70">Working it out…</p>
      )}
    </div>
  );
}

/** One-time codes, with the warning that makes them usable by two people. */
function RecoveryCodesField({ codes }: { codes: string[] }) {
  if (codes.length === 0) return null;
  return (
    <div className="rounded bg-ink px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <span className="text-t1 uppercase tracking-wide text-paper opacity-70">
          {KIND_LABELS.recovery_codes}
        </span>
        <CopyButton value={codes.join('\n')} />
      </div>
      <ul className="mt-1 grid grid-cols-2 gap-x-4 font-mono text-t2 text-ochre-text">
        {codes.map((c, i) => (
          <li key={i}>{c}</li>
        ))}
      </ul>
      {/*
        Relay cannot mark one as spent: that would mean this browser re-encrypting
        the item, and a recipient holds no key-wrapping permission — giving them
        one would open a server path over a secret. So the only honest control is
        telling both people. Q9 of the design QA, stated rather than hidden.
      */}
      <p className="mt-2 text-t1 text-paper opacity-70">
        Each of these works once. If more than one of you has access, agree who uses which.
      </p>
    </div>
  );
}

function CopyButton({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard
          ?.writeText(value)
          .then(() => {
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          })
          // A browser that refuses the clipboard must not look broken — the value
          // is on screen and can be typed.
          .catch(() => {});
      }}
      className="text-t1 text-paper underline opacity-80"
    >
      {done ? 'Copied' : 'Copy'}
    </button>
  );
}
