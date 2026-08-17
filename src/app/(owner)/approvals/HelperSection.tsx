'use client';

/**
 * Making somebody a helper — J3's missing front door.
 *
 * THE GAP THIS CLOSES. `POST /api/delegations` takes a `delegateUserId`, a raw
 * UUID no owner could possibly know, so nothing in the product could call it.
 * The approvals queue above has been reading `/api/delegations` since it
 * shipped, showing a warning about delegates that could not exist. Found by
 * writing the user manual 2026-08-12.
 *
 * ⚠️ THIS GRANTS SETUP RIGHTS OVER A VAULT, which is why the copy here works
 * harder than anywhere else in the product. What it grants and — more
 * importantly — what it does NOT grant is stated before the button, because the
 * failure mode is an owner clicking through a word they did not read.
 *
 * CONSENT IS EVIDENCE, NOT A CHECKBOX (J3-R2). A delegation is created PENDING
 * and does nothing at all until the owner records how consent was obtained. The
 * three methods are peers, deliberately: the parent being delegated for is the
 * person least likely to own a smartphone (J3-R3), so "in person" and "on paper"
 * are offered at the same weight as a link rather than hidden behind it.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R2, J3-R3, J3-R8
 */

import { useState } from 'react';

export interface Delegation {
  id: string;
  delegate_user_id: string;
  status: string;
  granted_at: string | null;
  /**
   * Carried on the delegation itself, because a person is removed from
   * `candidates` the moment they become one — so a lookup built from that list
   * is empty for exactly the rows that need it. Nullable: a delegate whose
   * roster row was later deleted still has a delegation.
   */
  name: string | null;
  email: string | null;
  /**
   * How consent was given, and where the paper record is kept.
   *
   * 🔴 WRITTEN SINCE MIGRATION 009 AND READ BY NOTHING until 2026-08-17.
   * `recordConsent` inserts a `consent_artifacts` row and links it, and no query
   * anywhere ever selected it back — so the consent form's own promise, *"This is
   * kept as a record. It is what makes handing someone this help legitimate
   * rather than simply convenient,"* was kept by the database and never by the
   * product. An owner who typed "signed form in the blue folder" could not read
   * it back, and neither could anyone asking whether the delegation was
   * legitimate.
   *
   * Null while a delegation is still pending — consent has not happened yet.
   */
  consent_method?: string | null;
  consent_evidence_ref?: string | null;
  /** What they have actually done, from the audit chain (J3-R8). */
  activity?: { action: string; ts: string }[];
}

export interface Candidate {
  user_id: string;
  name: string;
  email: string;
  person_type: string;
  standby_state: string | null;
}

/**
 * A helper's actions in plain words.
 *
 * Only two exist: a delegate can create an item and can propose a person. There
 * is no delegate path to update, to trigger, or to anything else — so this map
 * is short because the capability is, not because it is unfinished. An
 * unrecognised action falls through to the raw name rather than being hidden,
 * because the point of this list is that nothing a helper does is invisible.
 */
const DELEGATE_ACTION: Record<string, string> = {
  vault_item_created: 'Added something to your vault',
  approval_requested: 'Suggested somebody who would step in',
};

/**
 * Past tense, for reading a decision back. `METHODS` below is the question; this
 * is the answer, and they are worded differently on purpose — "We did it
 * together, in person" is what you pick, "You did it together, in person" is
 * what you are later told you picked.
 */
const CONSENT_RECORD: Record<string, string> = {
  in_person: 'You did it together, in person.',
  paper_upload: 'They signed something on paper.',
  link: 'They confirmed it themselves, on a device.',
};

const METHODS = [
  {
    value: 'in_person',
    label: 'We did it together, in person',
    hint: 'You sat with them, showed them this screen, and they said yes.',
  },
  {
    value: 'paper_upload',
    label: 'They signed something on paper',
    hint: 'A signed note or form. Say where it is kept, so it can be found later.',
  },
  {
    value: 'link',
    label: 'They confirmed it themselves, on a device',
    hint: 'Only if they genuinely used it. If you clicked for them, say so above instead.',
  },
] as const;

export default function HelperSection({
  delegations,
  candidates,
  onChange,
}: {
  delegations: Delegation[];
  candidates: Candidate[];
  onChange: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [consenting, setConsenting] = useState<string | null>(null);

  async function send(url: string, method: string, body?: unknown) {
    setErr(null);
    try {
      const res = await fetch(url, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setErr(b.message ?? 'That did not work. Please try again.');
        return false;
      }
      await onChange();
      return true;
    } catch {
      setErr('We could not reach the server. Please try again.');
      return false;
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-t5 font-semibold text-ink">Someone who helps you set this up</h2>
      <p className="text-ink">
        A helper can add and tidy your information so you do not have to do it all yourself.
      </p>

      {/*
        The scopes, in plain words. DELEGATE_SCOPES is propose-level for people
        and policies and contains nothing about decrypting, triggers or release —
        that is the substance of the whole feature, and an owner deciding whether
        to hand somebody this deserves to read it before the button, not after.
      */}
      <div className="rounded-lg border border-rule bg-paper-sunken p-4">
        <p className="font-medium text-ink">A helper can:</p>
        <ul className="mt-1 list-disc pl-5 text-ink">
          <li>add and edit items in your vault</li>
          <li>import a list from elsewhere</li>
          <li><strong>suggest</strong> people and access rules — which then wait for you</li>
        </ul>
        <p className="mt-3 font-medium text-ink">A helper can never:</p>
        <ul className="mt-1 list-disc pl-5 text-ink">
          <li>open or read anything in your vault</li>
          <li>decide who gets access — every one of those comes to you first</li>
          <li>start, stop or change a release</li>
          <li>add themselves to anything</li>
        </ul>
      </div>

      {err ? <p className="text-clay">{err}</p> : null}

      {delegations.length > 0 ? (
        <ul className="space-y-3">
          {delegations.map((d) => (
            <li key={d.id} className="rounded-lg border border-rule bg-paper-raised p-4">
              <p className="font-medium text-ink">
                {d.name ?? 'Your helper'}
                {d.status === 'active' ? (
                  <span className="ml-2 text-t2 text-sage-text">· helping you now</span>
                ) : (
                  <span className="ml-2 text-t2 text-ochre-text">· not active yet</span>
                )}
              </p>

              {d.status !== 'active' ? (
                consenting === d.id ? (
                  <ConsentForm
                    busy={busy === d.id}
                    onCancel={() => setConsenting(null)}
                    onSubmit={async (method, evidenceRef) => {
                      setBusy(d.id);
                      const ok = await send(`/api/delegations/${d.id}/consent`, 'POST', {
                        method,
                        evidenceRef,
                      });
                      setBusy(null);
                      if (ok) setConsenting(null);
                    }}
                  />
                ) : (
                  <>
                    <p className="mt-1 text-ink">
                      They cannot do anything yet. Record how you agreed to this and it starts.
                    </p>
                    <button
                      type="button"
                      onClick={() => setConsenting(d.id)}
                      className="mt-2 min-h-[44px] rounded border border-rule-strong px-4 text-t3 font-medium text-ink"
                    >
                      Record how we agreed
                    </button>
                  </>
                )
              ) : null}

              {/*
                🔴 J3-R8, surfaced 2026-08-12. Placed HERE rather than on the
                audit page on purpose: this is the screen where an owner decides
                whether to keep somebody, and the evidence belongs next to the
                decision. The audit page still holds everything in order; this
                answers the narrower question an owner actually asks about a
                helper — what have they been doing.
              */}
              {d.status === 'active' ? (
                <div className="mt-3">
                  <p className="text-t2 font-medium text-ink">What they have done</p>
                  {(d.activity?.length ?? 0) === 0 ? (
                    <p className="mt-1 text-t2 text-muted">Nothing yet.</p>
                  ) : (
                    <ul className="mt-1 space-y-1">
                      {d.activity!.slice(0, 8).map((a, i) => (
                        <li key={`${a.ts}-${i}`} className="text-t2 text-ink">
                          {DELEGATE_ACTION[a.action] ?? a.action}
                          <span className="text-muted"> — {new Date(a.ts).toLocaleString()}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {(d.activity?.length ?? 0) > 8 ? (
                    <p className="mt-1 text-t2 text-muted">
                      Showing the last 8 of {d.activity!.length}. Your{' '}
                      <a href="/audit" className="underline underline-offset-2">record</a> has all of
                      them, in order.
                    </p>
                  ) : null}
                </div>
              ) : null}

              {/*
                🔴 THE RECORD THE CONSENT FORM PROMISES. That form says "This is
                kept as a record. It is what makes handing someone this help
                legitimate rather than simply convenient" — and until 2026-08-17
                the row went into `consent_artifacts` and no query anywhere read
                it back. The owner was told it mattered, then never shown it.

                Placed beside "What they have done" for the same reason that
                section sits here: this is the screen where an owner decides
                whether to keep somebody, so what they agreed to belongs next to
                what has been done with it.
              */}
              {d.status === 'active' && d.consent_method ? (
                <div className="mt-3">
                  <p className="text-t2 font-medium text-ink">How you agreed</p>
                  <p className="mt-1 text-t2 text-ink">
                    {CONSENT_RECORD[d.consent_method] ?? d.consent_method}
                    {d.granted_at ? (
                      <span className="text-muted"> — {new Date(d.granted_at).toLocaleDateString()}</span>
                    ) : null}
                  </p>
                  {d.consent_evidence_ref ? (
                    <p className="mt-1 text-t2 text-muted">Record kept: {d.consent_evidence_ref}</p>
                  ) : null}
                </div>
              ) : null}

              <button
                type="button"
                disabled={busy === d.id}
                onClick={async () => {
                  setBusy(d.id);
                  await send('/api/delegations', 'DELETE', { delegationId: d.id });
                  setBusy(null);
                }}
                // Ochre: stopping a helper is reversible (appoint them again). Clay would
                // say it cannot be undone, which is false and cries wolf.
                className="mt-3 block min-h-[44px] text-t3 text-ochre-text underline underline-offset-4 disabled:opacity-50"
              >
                Stop them helping
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {candidates.length > 0 ? (
        <div className="rounded-lg border border-rule bg-paper-raised p-4">
          <p className="font-medium text-ink">People you could ask</p>
          {/*
            Only people already in the circle who have accepted. Delegation is an
            ELEVATION of somebody known, not an introduction — so there is no
            invite-by-email path here, which also means no way to discover
            whether an address has a Relay account.
          */}
          <p className="mt-1 text-t2 text-muted">
            Only people you have already named, who have accepted. If someone is missing, add them
            to your circle first.
          </p>
          <ul className="mt-3 space-y-2">
            {candidates.map((c) => (
              <li key={c.user_id} className="flex items-center justify-between gap-3">
                <span className="text-ink">
                  {c.name} <span className="text-t2 text-muted">· {c.email}</span>
                </span>
                <button
                  type="button"
                  disabled={busy === c.user_id}
                  onClick={async () => {
                    setBusy(c.user_id);
                    await send('/api/delegations', 'POST', { delegateUserId: c.user_id });
                    setBusy(null);
                  }}
                  className="min-h-[44px] shrink-0 rounded bg-ink px-4 text-t3 font-medium text-paper disabled:opacity-50"
                >
                  {busy === c.user_id ? 'Adding…' : 'Ask them to help'}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        delegations.length === 0 && (
          <p className="text-muted">
            Nobody to ask yet — people appear here once you have named them and they have accepted.
          </p>
        )
      )}
    </section>
  );
}

/**
 * How consent was obtained (J3-R2), with the no-smartphone routes as peers of
 * the link rather than beneath it (J3-R3).
 *
 * The link option is worded to discourage the lie it invites: an owner who
 * clicked through on the other person's behalf and picked "they confirmed it
 * themselves" has recorded a false artifact, and the artifact is the only thing
 * making the delegation legitimate.
 */
function ConsentForm({
  busy,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  onSubmit: (method: string, evidenceRef: string | null) => Promise<void>;
  onCancel: () => void;
}) {
  const [method, setMethod] = useState<string>('in_person');
  const [ref, setRef] = useState('');

  return (
    <form
      className="mt-3 rounded-lg bg-paper-sunken p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (busy) return;
        await onSubmit(method, ref.trim() || null);
      }}
    >
      <p className="font-medium text-ink">How did you agree to this?</p>
      <p className="mt-1 text-t2 text-muted">
        This is kept as a record. It is what makes handing someone this help legitimate rather than
        simply convenient.
      </p>

      <div className="mt-3 space-y-3">
        {METHODS.map((m) => (
          <label key={m.value} className="flex gap-3">
            <input
              type="radio"
              name="consent-method"
              value={m.value}
              checked={method === m.value}
              onChange={() => setMethod(m.value)}
              className="mt-1.5 h-5 w-5 shrink-0"
            />
            <span>
              <span className="block text-ink">{m.label}</span>
              <span className="block text-t2 text-muted">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>

      <label htmlFor="evidence" className="mt-4 block text-ink">
        Where is the record kept? <span className="text-muted">(optional)</span>
      </label>
      <input
        id="evidence"
        value={ref}
        onChange={(e) => setRef(e.target.value)}
        placeholder="e.g. signed form in the blue folder"
        className="mt-1 min-h-[48px] w-full rounded border border-rule-strong px-3 text-t3 text-ink"
      />

      <div className="mt-4 flex gap-3">
        <button
          type="submit"
          disabled={busy}
          className="min-h-[48px] rounded bg-ink px-5 text-t3 font-semibold text-paper disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Record it and start'}
        </button>
        <button type="button" onClick={onCancel} className="min-h-[48px] px-4 text-t3 text-muted">
          Not now
        </button>
      </div>
    </form>
  );
}
