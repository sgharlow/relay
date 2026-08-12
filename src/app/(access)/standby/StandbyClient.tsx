'use client';

/**
 * The standby dashboard — rung 0.
 *
 * [A6]: a contact who claims and then experiences nothing for years will not come
 * back, and three-to-five free accounts per owner only become a beachhead if
 * those people return. So this page has a job on day one even when nothing is
 * happening: it tells them who they stand by for, what they would be asked to do,
 * that nothing is open right now — and offers them the same protection for their
 * own family.
 *
 * The reassuring case is the common one and is treated as the design centre, not
 * an empty state. "Nothing is open" is the answer someone came here hoping for.
 *
 * Access mode: warm, large type, minimal chrome — this is read by someone who may
 * be having the worst week of their life.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R10, J4-R11
 */

import { useCallback, useEffect, useState } from 'react';

import StandbyPasskeyCard from './StandbyPasskeyCard';
import LeaveControl from './LeaveControl';

interface Grant {
  itemCount: number;
  categories: Record<string, number>;
  triggerTypes: string[];
}

interface Relationship {
  ownerId: string;
  ownerLabel: string;
  /** The roster row this person fills — what leaving unbinds. */
  personId: string;
  personType: 'recipient' | 'verifier';
  state: string;
  grant?: Grant;
  openRelease: { releaseStateId: string; state: string; caseId: string | null } | null;
  /** Verifiers only: is their answer still outstanding? */
  awaitingDecision?: boolean;
}

/**
 * What is open, and what this person does about it.
 *
 * TWO DEFECTS THIS CLOSES, both found in the 2026-08-12 beta reassessment.
 *
 * 1. THERE WAS NO ACTION. This rendered "Open now · case RLY-XXXX" as text, with
 *    no link anywhere. Core principle 5 says *every participant can do their job
 *    by visiting the site*, and §4.4 rests its whole derive-on-read argument on a
 *    verifier loading this page and finding lapsed requests actionable here — so
 *    escalation ran on load (it is invoked from `resolveStandbyFor`) and then
 *    stranded the person it had just made responsible.
 *
 * 2. "OPEN NOW" WAS OFTEN FALSE. `openRelease` covers pending, grace AND
 *    released, so a recipient was told "Open now" while a release was merely
 *    being confirmed and nothing was open at all. In a product whose entire claim
 *    is that access is controlled, saying it is open when it is not is the worst
 *    available error.
 *
 * The action is a LINK, not an inline form. J7-R3 requires the decision surface
 * to state who is asking, why now, what has been attempted, and what confirming
 * will and will not cause, with deny at equal prominence (J7-R6) — a real screen,
 * already built and carefully worded. Reproducing it here would duplicate it and
 * invite the two copies to drift.
 */
function OpenRelease({ rel }: { rel: Relationship }) {
  const open = rel.openRelease;
  if (!open) return null;

  const caseRef = open.caseId ? ` · case ${open.caseId}` : '';
  // Resolved server-side (`standby-resolve.ts`) so this card and /api/verify
  // cannot disagree about whether an answer is still wanted. Defaults to false
  // when absent: silence is better than asking someone twice.
  const awaitingDecision = rel.awaitingDecision === true;

  // A verifier is asked to decide while the release is pending or in grace —
  // matching `submitConfirmation`'s own guard, so the button is never offered
  // for a decision the server would refuse.
  if (rel.personType === 'verifier') {
    return awaitingDecision ? (
      <div style={{ marginTop: 12 }}>
        <p style={{ fontSize: 17, fontWeight: 600 }}>They need your answer{caseRef}</p>
        <a
          href={`/verify?release=${encodeURIComponent(open.releaseStateId)}`}
          style={{
            display: 'inline-block',
            marginTop: 10,
            minHeight: 48,
            lineHeight: '48px',
            padding: '0 20px',
            borderRadius: 6,
            background: '#211d18',
            color: '#fffdf9',
            fontSize: 17,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Answer now
        </a>
      </div>
    ) : (
      <p style={{ fontSize: 16, marginTop: 12, color: '#6b6257' }}>
        Answered — nothing more is needed from you{caseRef}.
      </p>
    );
  }

  // A recipient can open nothing until the release is actually RELEASED.
  return open.state === 'released' ? (
    <div style={{ marginTop: 12 }}>
      <p style={{ fontSize: 17, fontWeight: 600 }}>Open now{caseRef}</p>
      <a
        href="/access"
        style={{
          display: 'inline-block',
          marginTop: 10,
          minHeight: 48,
          lineHeight: '48px',
          padding: '0 20px',
          borderRadius: 6,
          background: '#211d18',
          color: '#fffdf9',
          fontSize: 17,
          fontWeight: 600,
          textDecoration: 'none',
        }}
      >
        Open what they left you
      </a>
    </div>
  ) : (
    <p style={{ fontSize: 16, marginTop: 12, color: '#6b6257' }}>
      Being confirmed now{caseRef}. Nothing is open yet, and there is nothing for you to do.
    </p>
  );
}

export default function StandbyClient() {
  const [data, setData] = useState<{
    relationships: Relationship[];
    anythingOpen: boolean;
    hasOwnVault: boolean;
    hasPasskey?: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Extracted so leaving a circle can re-read it: the card must disappear when
  // somebody steps down, or they are left looking at a relationship they have
  // just ended and wondering whether it worked.
  const load = useCallback(() => {
    fetch('/api/standby', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(setData)
      .catch(() => setError('We could not load this just now.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (error) return <p style={{ fontSize: 18 }}>{error}</p>;
  if (!data) return <p style={{ fontSize: 18, color: '#6b6257' }}>Loading…</p>;

  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em' }}>You are on standby</h1>

      {data.relationships.length === 0 ? (
        <p style={{ fontSize: 18, lineHeight: 1.6, marginTop: 12 }}>
          Nobody has named you yet. If someone told you they would, ask them to send you their code.
        </p>
      ) : (
        <p style={{ fontSize: 18, lineHeight: 1.6, marginTop: 12, color: '#6b6257' }}>
          {data.anythingOpen
            ? 'Something needs your attention below.'
            : 'Nothing is open. There is nothing you need to do today.'}
        </p>
      )}

      {data.relationships.map((rel) => (
        <section
          key={`${rel.personType}-${rel.ownerId}`}
          style={{
            marginTop: 24,
            padding: 20,
            borderRadius: 10,
            border: `1px solid ${rel.openRelease ? '#b26a00' : '#e4ded4'}`,
            background: rel.openRelease ? '#fdf6ea' : '#fffdf9',
          }}
        >
          <h2 style={{ fontSize: 21, fontWeight: 600 }}>{rel.ownerLabel}</h2>

          <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 8 }}>
            {rel.personType === 'verifier'
              ? 'If an emergency is claimed, you will be asked one question: is this real? You will never see anything inside their vault — not now, and not after you answer.'
              : 'If an emergency is confirmed by the people they trust, what they set aside for you opens. Until then it stays sealed, and it closes again when they check back in.'}
          </p>

          {rel.grant && rel.grant.itemCount > 0 ? (
            <p style={{ fontSize: 16, marginTop: 10, color: '#6b6257' }}>
              Set aside for you: {rel.grant.itemCount} item
              {rel.grant.itemCount === 1 ? '' : 's'}
              {Object.keys(rel.grant.categories).length > 0
                ? ` — ${Object.entries(rel.grant.categories)
                    .map(([c, n]) => `${n} ${c}`)
                    .join(', ')}`
                : ''}
              . You cannot see what they are, and neither can we.
            </p>
          ) : null}

          {rel.openRelease ? (
            <OpenRelease rel={rel} />
          ) : (
            <p style={{ fontSize: 16, marginTop: 12, color: '#6b6257' }}>Nothing open.</p>
          )}

          <LeaveControl
            personId={rel.personId}
            personType={rel.personType}
            ownerLabel={rel.ownerLabel}
            somethingOpen={rel.openRelease !== null}
            onLeft={load}
          />
        </section>
      ))}

      {/* Only for someone who is actually covering a person, and only if they
          have not already done it. `=== false` rather than `!`: if the field is
          ever absent the card stays hidden, because the failure mode of a
          deferrable prompt is nagging somebody who already complied. */}
      {data.relationships.length > 0 && data.hasPasskey === false ? <StandbyPasskeyCard /> : null}

      {!data.hasOwnVault ? (
        <section
          style={{
            marginTop: 32,
            padding: 20,
            borderRadius: 10,
            border: '1px solid #e4ded4',
          }}
        >
          <h2 style={{ fontSize: 19, fontWeight: 600 }}>Who would step in for you?</h2>
          <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 8, color: '#6b6257' }}>
            You are covering someone else. The same thing can be set up for your own family, and the
            first ten items are free.
          </p>
          <a
            href="/start"
            style={{
              display: 'inline-block',
              marginTop: 14,
              minHeight: 48,
              lineHeight: '48px',
              padding: '0 20px',
              borderRadius: 6,
              background: '#211d18',
              color: '#fffdf9',
              fontSize: 17,
              fontWeight: 600,
              textDecoration: 'none',
            }}
          >
            Start your own plan
          </a>
        </section>
      ) : null}
    </div>
  );
}
