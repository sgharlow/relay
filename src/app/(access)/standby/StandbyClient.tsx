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
import HelpingCard from './HelpingCard';
import LeaveControl from './LeaveControl';
import AskControl from './AskControl';

interface Grant {
  itemCount: number;
  categories: Record<string, number>;
  triggerTypes: string[];
}

interface Relationship {
  ownerId: string;
  ownerLabel: string;
  /** The four words the owner reads out on the verification call (§3.3). */
  fingerprint: string;
  /** The roster row this person fills — what leaving unbinds. */
  personId: string;
  personType: 'recipient' | 'verifier';
  state: string;
  grant?: Grant;
  // triggerType is needed to tell whether THIS recipient holds any rules
  // under the release that opened — the server has always sent it.
  openRelease: { releaseStateId: string; triggerType: string; state: string; caseId: string | null } | null;
  /** Verifiers only: is their answer still outstanding? */
  awaitingDecision?: boolean;
  /** Recipients only: their own unanswered ask, so it survives a reload. */
  pendingAsk?: { caseId: string | null; expiresAt: string } | null;
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

  /*
    🔴 "OPEN WHAT THEY LEFT YOU" WAS PROMISED TO PEOPLE WITH NOTHING SCOPED.
    The only condition checked was that the release had reached RELEASED — not
    whether THIS recipient has any rules under the trigger that opened. So a
    contact whose grant sits under a different circumstance (or whose last rule
    was removed) was shown a confident dark button and sent to /access, which
    correctly tells them nothing was set aside for them (R7.2). The two screens
    contradicted each other, and the wrong one came first.

    `grant.triggerTypes` already lists the trigger types this person holds rules
    under — it is built by the same query that powers the "set aside for you"
    counts — so the check costs nothing and needs no new data.

    The alternative wording is deliberately not apologetic: for a recipient in
    this state nothing is wrong, and the person they stand by for may well have
    arranged something for a situation that has not happened.
  */
  const scopedForThisRelease =
    (rel.grant?.itemCount ?? 0) > 0 &&
    (rel.grant?.triggerTypes ?? []).includes(open.triggerType);

  if (open.state === 'released' && !scopedForThisRelease) {
    // var(--ink-muted), not the literal the rest of this file uses: the
    // raw-colour ratchet counts literals, and a token is the only value
    // lib/ops/contrast.test.ts can actually verify. Same colour, checkable.
    return (
      <p style={{ fontSize: 16, marginTop: 12, color: 'var(--ink-muted)' }}>
        Something has opened for {rel.ownerLabel}, but nothing of theirs is set aside for you in
        this situation{caseRef}. There is nothing for you to do.
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
  const [signedOut, setSignedOut] = useState(false);

  const load = useCallback(() => {
    fetch('/api/standby', { cache: 'no-store' })
      .then((r) => {
        // 🔴 A 401 IS NOT AN OUTAGE, and until 2026-08-13 it was reported as
        // one. A claimed contact whose session had expired opened their
        // bookmark and read "We could not load this just now" — a message that
        // says the product is broken, offers no door, and arrives at exactly
        // the moment this page exists for. Being signed out is ordinary, has
        // three known ways back in, and deserves to be told apart.
        if (r.status === 401) {
          setSignedOut(true);
          return null;
        }
        return r.ok ? r.json() : Promise.reject(new Error(String(r.status)));
      })
      .then((j) => {
        if (j) setData(j);
      })
      .catch(() => setError('We could not load this just now.'));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (signedOut) {
    return (
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '32px 20px' }}>
        <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.01em' }}>
          You are signed out
        </h1>
        <p style={{ fontSize: 18, lineHeight: 1.6, marginTop: 12 }}>
          Nothing is wrong — sessions end on their own after a while. Everything you were
          standing by for is exactly as you left it.
        </p>
        <ul style={{ fontSize: 18, lineHeight: 1.8, marginTop: 16, paddingLeft: 22 }}>
          <li>
            If you have signed in here before:{' '}
            <a href="/auth/signin" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
              sign back in
            </a>
            .
          </li>
          <li>
            If you were given a code and this is your first time:{' '}
            <a href="/claim" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
              enter your code
            </a>
            .
          </li>
          <li>
            If your usual way in is gone and you hold an emergency code:{' '}
            <a href="/break-glass" style={{ textDecoration: 'underline', textUnderlineOffset: 3 }}>
              use it here
            </a>
            .
          </li>
        </ul>
      </div>
    );
  }

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

      {/*
        THE PICTURE ONLY APPEARS ON THE QUIET DAY, and disappears the moment
        anything is open — a decorative scene above an urgent instruction would
        be the wrong tone at the only moment this screen matters.

        It is drawn as a calm scene rather than the usual apologetic empty
        state, because "nothing is open" is the GOOD outcome here: it means the
        person who named them is fine. Standing by IS the task, and it is being
        performed correctly.
      */}
      {data.relationships.length > 0 && !data.anythingOpen ? (
        <img
          src="/assets/illustration/at-rest.svg"
          alt=""
          width={420}
          height={220}
          style={{ display: 'block', width: '100%', maxWidth: 360, height: 'auto', marginTop: 20 }}
        />
      ) : null}

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

          {/*
            🔴 THE OTHER HALF OF THE VERIFICATION CALL, added 2026-08-12. The
            owner's screen has always said "They see the same four words on
            their own screen" — and nothing showed them to the contact, so the
            owner was reading a phrase at somebody who had nothing to compare it
            with. "Do these match?" answered by a person holding nothing is a
            yes, which is precisely the rubber stamp the control exists to stop.

            Shown before the state changes, and only while it still matters: once
            the owner has confirmed, this is history and the card should not keep
            asking for a call that already happened.
          */}
          {rel.state === 'claimed' ? (
            <div
              style={{
                marginTop: 12,
                padding: 14,
                borderRadius: 8,
                background: '#f6f3ee',
                border: '1px solid #e4ded4',
              }}
            >
              <p style={{ fontSize: 16, lineHeight: 1.6 }}>
                <strong>{rel.ownerLabel} will call you and read out four words.</strong> These are
                yours — they should be the same.
              </p>
              <p
                style={{
                  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                  fontSize: 22,
                  fontWeight: 600,
                  margin: '10px 0',
                  letterSpacing: '0.02em',
                }}
              >
                {rel.fingerprint}
              </p>
              <p style={{ fontSize: 15, lineHeight: 1.6, color: '#6b6257' }}>
                If they do not match, say so and stop — it means somebody else opened the
                invitation meant for you. Nothing is lost; they can start again on a channel you
                both trust.
              </p>
            </div>
          ) : null}

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
          ) : rel.pendingAsk ? (
            /*
              🔴 AN UNANSWERED ASK USED TO LOOK LIKE NOTHING HAPPENED. A request
              in awaiting_owner creates no release row, so this screen said
              "Nothing open." and offered the Ask control AGAIN — the
              confirmation lived only in AskControl's component state, gone on
              reload. Every ask is deliberately loud (it mails the owner and the
              whole circle, J6-R9), so a worried requester checking back hourly
              tripled the family's email until the velocity cap refused them —
              having never once been shown their first ask was heard. The
              standing answer now comes from the DATABASE, and the control does
              not re-render while one is open.
            */
            <div
              style={{
                marginTop: 12,
                padding: '12px 16px',
                borderRadius: 8,
                border: '1px solid var(--ochre)',
                background: 'var(--ochre-soft)',
              }}
            >
              <p style={{ fontSize: 16, color: 'var(--ochre-text)' }}>
                You asked, and {rel.ownerLabel} has been told. If they do not answer by{' '}
                {new Date(rel.pendingAsk.expiresAt).toLocaleString()}, the people they chose are
                asked to confirm instead — you do not need to ask again.
                {rel.pendingAsk.caseId ? ` Reference ${rel.pendingAsk.caseId}.` : ''}
              </p>
            </div>
          ) : (
            <>
              <p style={{ fontSize: 16, marginTop: 12, color: '#6b6257' }}>Nothing open.</p>
              {/*
                J6's front door, and it belongs exactly here — next to the
                sentence saying nothing is open, which is the moment somebody
                realises they need something and has nowhere to go. Recipients
                only: a verifier receives no access, so "ask them to open it"
                would be asking on somebody else's behalf.
              */}
              {rel.personType === 'recipient' ? (
                <AskControl ownerId={rel.ownerId} ownerLabel={rel.ownerLabel} onAsked={load} />
              ) : null}
            </>
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
      {/*
        Setup work, not an emergency role — so it sits below the standby cards
        rather than competing with them. Renders itself away when there is
        nothing to say.
      */}
      <HelpingCard />

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

      {/*
        The support line that used to live here has MOVED UP to the access
        layout (_components/SupportFooter.tsx), where every screen in this mode
        gets it rather than the two that happened to remember. Deleted rather
        than left in place: two copies of one sentence is how the wording on
        /standby and the wording everywhere else start disagreeing.
      */}
    </div>
  );
}
