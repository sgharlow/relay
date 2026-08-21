'use client';

/**
 * Adding and removing the people you trust.
 *
 * Moved here from /recipients so that "People" is ONE destination. The audit
 * found two nav entries for one idea — "Recipients & Verifiers" and "Your
 * circle" — which asked the owner to know an internal distinction in order to
 * find anything. The assessment (who covers what, what nobody can reach) and
 * the management (add, remove) belong on the same screen, because the whole
 * reason to add someone is the gap the assessment just showed you.
 *
 * First components drawn on the design system rather than ad-hoc Tailwind:
 * tokens for every colour, size and space, ink-on-paper, and clay reserved for
 * removal — the only irreversible thing on this screen.
 *
 * Feature: relay-h0-mvp
 * Requirements: 3.1, 3.2, J4-R2
 */

import { useState } from 'react';

import { apiSend } from '../_lib/api';
import { RenameControl } from './RenameControl';
import { VALID_ROLES } from '../../../../lib/domain/enums';
import { readStandbyState, circleLight } from '../../../../lib/people/standby-state';
import InviteControl from './InviteControl';
import BreakGlassControl from './BreakGlassControl';
import FingerprintControl from './FingerprintControl';
import FallbackLine from './FallbackLine';
import DeliveryLine, { type DeliveryState } from './DeliveryLine';
import ProviderRiskLine from './ProviderRiskLine';
import SecondAddressControl from './SecondAddressControl';
import DrillLine from './DrillLine';
import FireDrillControl from './FireDrillControl';
import PaperOnlyControl from './PaperOnlyControl';
import type { DrillState } from '../../../../lib/release/drill-claim';

/**
 * The roles an owner may CHOOSE, which is narrower than the roles that exist.
 *
 * 🔴 THIS SELECT RENDERED `VALID_ROLES` RAW UNTIL 2026-08-21, so it offered
 * `executor` — one click from a Terms page reading "Relay does not offer estate
 * or inheritance services — there is no death-verified handoff, no executor
 * role". docs/user-journeys.md defines an executor as "a recipient with role =
 * executor on the estate trigger", and estate was withdrawn permanently when
 * gate g2-counsel-opinion was DECLINED on 2026-08-14. The option therefore named
 * a capability that does not exist and changed nothing when picked.
 *
 * Narrowed exactly as USER_SELECTABLE_TRIGGER_TYPES narrows VALID_TRIGGER_TYPES,
 * and for the reason recorded there: "the product offered a permanent capability
 * its own Terms disclaimed, on a surface that takes live payments". `VALID_ROLES`
 * and the DB CHECK are untouched, so a row already stored as `executor` still
 * validates and still reads back.
 *
 * ⚠️ THIS BELONGS IN lib/domain/enums.ts beside USER_SELECTABLE_TRIGGER_TYPES,
 * and does not live there yet — the helper's proposal form keeps its own copy of
 * the list, so there are two. role-options.test.ts reads BOTH files, which is
 * what holds them together until one definition exists.
 *
 * ⚠️ ONLY SAFE BECAUSE THE FORM CREATES. If a role ever becomes editable, the
 * stored value has to be added back to the list for that row, or saving an
 * existing executor would silently rewrite them as a recipient.
 *
 * ⚠️ THE SELECT ITSELF MOVED on 2026-08-21: J4-R1 folded this file's two add
 * forms into `AddPersonForm.tsx`, which imports this list. The list stays here
 * because the reasoning above is about the ROLE VOCABULARY rather than about one
 * form, and moving a narrowing out from under its own explanation is how the
 * explanation gets lost. `role-options.test.ts` reads both files so neither half
 * can widen alone.
 */
export const SELECTABLE_ROLES = VALID_ROLES.filter((r) => r !== 'executor');

/**
 * Someone who has not bound an account yet still needs a way in. `revoked` is
 * excluded: reissuing to a person the owner deliberately removed would undo the
 * removal by accident.
 */
function needsClaimCode(state?: string): boolean {
  const s = readStandbyState(state);
  return s === 'invited';
}

/**
 * Everyone except a revoked person. `redeemBreakGlass` refuses those outright —
 * revocation outranks a code in a drawer — so offering to mint one would be
 * offering something that cannot work.
 */
function canHoldBreakGlass(state?: string): boolean {
  return readStandbyState(state) !== 'revoked';
}

/** Drives only the wording: a claimed person needs this for a lost device. */
function hasClaimed(state?: string): boolean {
  const s = readStandbyState(state);
  return s === 'claimed' || s === 'confirmed';
}

/*
  Display shapes, deliberately wider than the form's. /api/circle returns role
  as a plain string and omits verification_status; the create form has its own
  strictly-typed state. Narrowing these would force a second round of fetches
  for two labels.
*/
export interface Recipient {
  id: string;
  name: string;
  email: string;
  /** Second mailbox for credential-free notices. See lib/notify/fanout.ts. */
  email_secondary?: string | null;
  relationship?: string | null;
  role: string;
  standby_state?: string;
  /** Derived per request from the binding; null until somebody has claimed. */
  fingerprint?: string | null;
  /** Could they get back in on a new device? Only meaningful once claimed. */
  has_passkey?: boolean;
  has_break_glass?: boolean;
  /** Latest provider event for their address; null = we have not heard. */
  delivery?: DeliveryState | null;
  /** §8.1: the owner has recorded that this person will never hold an account. */
  break_glass_only?: boolean | null;
}

export interface Verifier {
  id: string;
  name: string;
  email: string;
  /** Second mailbox for credential-free notices. See lib/notify/fanout.ts. */
  email_secondary?: string | null;
  /** Last rehearsal sent to them, and whether they answered it. */
  drill?: DrillState | null;
  /** @deprecated dead column — see StandbyLight below. */
  verification_status?: string;
  standby_state?: string;
  /** Derived per request from the binding; null until somebody has claimed. */
  fingerprint?: string | null;
  /** Could they get back in on a new device? Only meaningful once claimed. */
  has_passkey?: boolean;
  has_break_glass?: boolean;
  /** Latest provider event for their address; null = we have not heard. */
  delivery?: DeliveryState | null;
  /** §8.1: the owner has recorded that this person will never hold an account. */
  break_glass_only?: boolean | null;
}

/**
 * Three positions, and green is a claim about CAPABILITY.
 *
 * This replaces a chip that rendered `verification_status` — a column declared
 * NOT NULL DEFAULT 'pending' in migration 001 and written by nothing, so every
 * person in every circle showed the word "pending" forever. It looked like
 * status and carried none.
 *
 * Red is honest right now: claiming does not exist until the identity sprint, so
 * nobody has an account yet and nobody can act through one. The existing
 * invitation path still works for them meanwhile.
 */
function StandbyLight({ state, paperOnly }: { state?: string; paperOnly?: boolean | null }) {
  const s = readStandbyState(state);
  const light = circleLight(s);

  // §8.1: a red light saying "has not accepted yet" tells the owner to chase
  // somebody who is never coming. Once they have recorded that, it stops being a
  // failure and becomes a choice — so it reads as one, and in a neutral tone.
  if (paperOnly && s === 'invited') {
    return (
      <span
        title="Covered by an emergency code only — does not count towards a release"
        style={{
          marginLeft: 'var(--s2)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: 'var(--t1)',
          color: 'var(--ink-muted)',
        }}
      >
        <span
          aria-hidden
          style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--rule-strong)', display: 'inline-block' }}
        />
        Emergency code only
      </span>
    );
  }

  // Amber and red both say what is MISSING rather than only what state a row is
  // in. Since quorum tightened, an unverified person contributes nothing, so
  // "Claimed" alone would let an owner read progress where there is none.
  const tone = {
    green: { dot: 'var(--ok, #2e7d32)', label: 'Verified — their answer counts' },
    amber: { dot: 'var(--warn, #b26a00)', label: 'Accepted — not yet verified, so their answer would not count' },
    red: {
      dot: 'var(--rule-strong)',
      label: s === 'revoked' ? 'Removed' : 'Has not accepted yet — give them their code',
    },
  }[light];

  return (
    <span
      title={tone.label}
      style={{
        marginLeft: 'var(--s2)',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        fontSize: 'var(--t1)',
        color: 'var(--ink-muted)',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: tone.dot,
          display: 'inline-block',
        }}
      />
      {tone.label}
    </span>
  );
}

export const field: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--t2)',
  padding: 'var(--s2) var(--s3)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--paper-raised)',
  color: 'var(--ink)',
};

export const primaryButton: React.CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--t2)',
  fontWeight: 600,
  padding: 'var(--s2) var(--s4)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
};

export const card: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--paper-raised)',
};

function SectionHeading({ children, hint }: { children: React.ReactNode; hint: string }) {
  return (
    <div style={{ marginBottom: 'var(--s3)' }}>
      <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600, letterSpacing: '-0.01em' }}>{children}</h2>
      <p style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>{hint}</p>
    </div>
  );
}

/**
 * Removal is the one irreversible action here, so it is the one thing in clay —
 * and, until 2026-08-13, the one thing that did it in a single unguarded click.
 *
 * 🔴 WHY THIS NOW ASKS. Removing a person is not "take them off the list": it
 * cascades to their access POLICIES and RULES (`deleteRecipient`), so one click
 * could silently delete several grants and change what the plan does on the day
 * it runs. The product already treats far less consequential things with more
 * care — "Cancel permanently" is separated and confirmed precisely so that
 * somebody stopping a false alarm at speed cannot retire their whole plan by
 * reaching for the innocuous word.
 *
 * The adjacency is what makes it urgent rather than merely untidy. The user
 * manual sends an owner to THIS row during the verification call: "if the words
 * do not match... the same panel removes them". The mismatch control is
 * recoverable — the person goes back to not-yet-invited and can be re-invited.
 * `Remove` beside it is permanent and takes their rules. Two similar-looking
 * controls, one recoverable and one not, on a screen where the owner is already
 * primed to click the one that gets rid of somebody.
 *
 * The confirmation names the CONSEQUENCE rather than asking "are you sure?",
 * which is a question nobody reads. `reachCount` comes from the coverage matrix
 * the page already loads, so this costs no extra request.
 */
function RemoveButton({
  onConfirm,
  name,
  reachCount,
}: {
  onConfirm: () => void;
  name: string;
  reachCount?: number;
}) {
  const [armed, setArmed] = useState(false);

  if (!armed) {
    return (
      <button
        onClick={() => setArmed(true)}
        aria-label={`Remove ${name}`}
        style={{
          fontFamily: 'var(--font-ui)',
          fontSize: 'var(--t1)',
          color: 'var(--clay)',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          padding: 'var(--s1) var(--s2)',
        }}
      >
        Remove
      </button>
    );
  }

  return (
    <div style={{ textAlign: 'right', maxWidth: 260 }}>
      <p style={{ fontSize: 'var(--t1)', color: 'var(--ink)', marginBottom: 'var(--s1)' }}>
        Remove {name}?{' '}
        {reachCount
          ? `The ${reachCount} thing${reachCount === 1 ? '' : 's'} you set aside for them ` +
            `${reachCount === 1 ? 'goes' : 'go'} too.`
          : 'Any access you had written for them goes too.'}{' '}
        This cannot be undone.
      </p>
      <div style={{ display: 'flex', gap: 'var(--s2)', justifyContent: 'flex-end' }}>
        <button
          onClick={() => {
            setArmed(false);
            onConfirm();
          }}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--t1)',
            color: 'var(--clay)',
            background: 'none',
            border: '1px solid var(--clay)',
            borderRadius: 4,
            cursor: 'pointer',
            padding: 'var(--s1) var(--s2)',
          }}
        >
          Yes, remove them
        </button>
        <button
          onClick={() => setArmed(false)}
          style={{
            fontFamily: 'var(--font-ui)',
            fontSize: 'var(--t1)',
            color: 'var(--ink)',
            background: 'none',
            border: '1px solid var(--rule-strong)',
            borderRadius: 4,
            cursor: 'pointer',
            padding: 'var(--s1) var(--s2)',
          }}
        >
          Keep them
        </button>
      </div>
    </div>
  );
}

/**
 * The other half of the same defect: both removals swallowed their error with
 * `.catch(() => {})`. A failed DELETE left the person on screen with no
 * explanation, which reads as "the button does nothing" — and on the one screen
 * where an owner most needs to believe what they are looking at.
 */
function useRemove(
  /**
   * The full literal path, not a segment to interpolate.
   *
   * It was `/api/${path}/${id}` until 2026-08-13, which meant the string
   * `/api/recipients` appeared NOWHERE in the product even though the endpoint
   * was called constantly. A URL assembled from variables cannot be found by
   * grep, by a reachability check, or by a person asking "what calls this?" —
   * and the reachability check is now a CI gate (lib/ops/api-reachability.ts),
   * so a call site nothing can see reads as a dead endpoint.
   */
  basePath: '/api/recipients' | '/api/verifiers',
  onChange: () => Promise<void>,
) {
  const [removeError, setRemoveError] = useState<string | null>(null);

  async function remove(id: string) {
    setRemoveError(null);
    try {
      await apiSend(
        basePath === '/api/recipients' ? `/api/recipients/${id}` : `/api/verifiers/${id}`,
        'DELETE',
      );
    } catch (err) {
      setRemoveError(
        `That did not work, and nothing was removed: ${String((err as Error).message)}`,
      );
    }
    await onChange();
  }

  return { remove, removeError };
}

export function RecipientSection({
  items,
  onChange,
  reachByRecipient,
}: {
  items: Recipient[];
  onChange: () => Promise<void>;
  /** id → how many items they can reach, from the coverage matrix. */
  reachByRecipient?: Record<string, number>;
}) {
  // The create state that used to live here went with the form — see the note
  // where it stood. This section now only LISTS and removes; naming somebody is
  // AddPersonForm's job, once, for whatever they would do.
  const { remove, removeError } = useRemove('/api/recipients', onChange);

  return (
    <section>
      <SectionHeading hint="The people who would receive access. Nothing opens for them until a trigger fires and the people you named confirm it is real — and a person you have not verified cannot receive anything.">
        Who would step in
      </SectionHeading>

      {removeError ? (
        <p role="alert" style={{ fontSize: 'var(--t2)', color: 'var(--clay)', marginBottom: 'var(--s2)' }}>
          {removeError}
        </p>
      ) : null}

      <ul style={{ ...card, listStyle: 'none', padding: 0, margin: `0 0 var(--s4)` }}>
        {items.length === 0 ? (
          <li style={{ padding: 'var(--s3) var(--s4)', fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
            Nobody yet. A vault with no one named cannot open for anyone.
          </li>
        ) : null}
        {items.map((r) => (
          <li
            key={r.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--s3)',
              padding: 'var(--s3) var(--s4)',
              borderTop: '1px solid var(--rule)',
            }}
          >
            <div>
              <span style={{ fontSize: 'var(--t3)', fontWeight: 500 }}>{r.name}</span>
              <span
                style={{
                  marginLeft: 'var(--s2)',
                  fontSize: 'var(--t1)',
                  padding: '2px 6px',
                  borderRadius: 'var(--radius-owner)',
                  background: 'var(--paper-sunken)',
                  color: 'var(--ink-muted)',
                }}
              >
                {r.role}
              </span>
              <StandbyLight state={r.standby_state} paperOnly={r.break_glass_only} />
              <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>
                {r.email}
                {r.relationship ? ` · ${r.relationship}` : ''}
              </div>
              {needsClaimCode(r.standby_state) && !r.break_glass_only ? (
                <InviteControl
                  personId={r.id}
                  personType="recipient"
                  name={r.name}
                  email={r.email}
                />
              ) : null}
              {needsClaimCode(r.standby_state) ? (
                <PaperOnlyControl
                  personId={r.id}
                  personType="recipient"
                  name={r.name}
                  marked={Boolean(r.break_glass_only)}
                  onChanged={onChange}
                />
              ) : null}
              {hasClaimed(r.standby_state) ? (
                <FallbackLine
                  name={r.name}
                  hasPasskey={Boolean(r.has_passkey)}
                  hasBreakGlass={Boolean(r.has_break_glass)}
                />
              ) : null}
              {/* Renders nothing until an event actually says something. */}
              <DeliveryLine name={r.name} email={r.email} delivery={r.delivery} />
              {/* Needs no event — the address itself is the evidence. */}
              <ProviderRiskLine name={r.name} email={r.email} />
              <SecondAddressControl personType="recipient" person={r} onChanged={onChange} />
              {/* Assurance sits directly under the light it turns green. */}
              {r.fingerprint && hasClaimed(r.standby_state) ? (
                <FingerprintControl
                  personId={r.id}
                  personType="recipient"
                  name={r.name}
                  fingerprint={r.fingerprint}
                  state={readStandbyState(r.standby_state) === 'confirmed' ? 'confirmed' : 'claimed'}
                  onChanged={onChange}
                />
              ) : null}
              {canHoldBreakGlass(r.standby_state) ? (
                <BreakGlassControl
                  personId={r.id}
                  personType="recipient"
                  name={r.name}
                  hasClaimed={hasClaimed(r.standby_state)}
                />
              ) : null}
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
              <RenameControl personType="recipient" person={r} onRenamed={onChange} />
              <RemoveButton
                onConfirm={() => remove(r.id)}
                name={r.name}
                reachCount={reachByRecipient?.[r.id]}
              />
            </div>
          </li>
        ))}
      </ul>

      {/*
        🔴 THE ADD FORM WAS HERE, AND IT WAS ONE OF TWO — removed 2026-08-21 for
        J4-R1.

        This section carried its own form and the verifier section below carried
        another. That is the defect: `lib/people/people.ts` opens with "One
        people list; roles are attributes", and an owner naming their spouse as
        both had to find two forms and type the same human twice — producing two
        rows, two invitations and two claim codes for one person, and a circle
        whose headcount overstated how many people were actually standing by.

        The single entry is `AddPersonForm`, above both sections. It sits above
        rather than inside one of them because it belongs to neither: a person
        who wears both hats has no natural section to be added from, and putting
        the one form under one of the two headings would say the wrong thing
        about the model all over again.

        ⚠️ DELETING IT IS LOAD-BEARING, NOT TIDINESS. A unified form added
        alongside these two would have given the owner three ways in and changed
        nothing about the outcome — it would read as fixed and behave exactly as
        before. AddPersonForm.test.tsx renders both sections and fails if a form
        returns to either.
      */}
    </section>
  );
}

export function VerifierSection({
  items,
  onChange,
}: {
  items: Verifier[];
  onChange: () => Promise<void>;
}) {
  // Same removal as RecipientSection — this section lists and removes; becoming
  // a trusted contact is a tick on the one form at the top of the page.
  const { remove, removeError } = useRemove('/api/verifiers', onChange);

  return (
    <section>
      {/*
        Amended 2026-08-12. The old hint promised they "never see anything
        inside your vault", which is imprecise in the same way §3.1 was: at the
        moment they are asked they see how many items and which categories, so
        they can judge whether the request is proportionate. The line that holds
        is contents, not scale — and the hint now also names the step that
        decides whether their answer counts at all.
      */}
      <SectionHeading hint="They are asked whether an emergency is real. Their answer only counts once you have checked it is really them. They never see what is inside your vault — only how much, and only when they are asked.">
        Who confirms it is real
      </SectionHeading>

      {removeError ? (
        <p role="alert" style={{ fontSize: 'var(--t2)', color: 'var(--clay)', marginBottom: 'var(--s2)' }}>
          {removeError}
        </p>
      ) : null}

      <ul style={{ ...card, listStyle: 'none', padding: 0, margin: `0 0 var(--s4)` }}>
        {items.length === 0 ? (
          <li style={{ padding: 'var(--s3) var(--s4)', fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
            Nobody yet. One is fragile — they might be on the flight with you.
          </li>
        ) : null}
        {items.map((v) => (
          <li
            key={v.id}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 'var(--s3)',
              padding: 'var(--s3) var(--s4)',
              borderTop: '1px solid var(--rule)',
            }}
          >
            <div>
              <span style={{ fontSize: 'var(--t3)', fontWeight: 500 }}>{v.name}</span>
              <StandbyLight state={v.standby_state} paperOnly={v.break_glass_only} />
              <div style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)' }}>{v.email}</div>
              {needsClaimCode(v.standby_state) && !v.break_glass_only ? (
                <InviteControl
                  personId={v.id}
                  personType="verifier"
                  name={v.name}
                  email={v.email}
                />
              ) : null}
              {needsClaimCode(v.standby_state) ? (
                <PaperOnlyControl
                  personId={v.id}
                  personType="verifier"
                  name={v.name}
                  marked={Boolean(v.break_glass_only)}
                  onChanged={onChange}
                />
              ) : null}
              {hasClaimed(v.standby_state) ? (
                <FallbackLine
                  name={v.name}
                  hasPasskey={Boolean(v.has_passkey)}
                  hasBreakGlass={Boolean(v.has_break_glass)}
                />
              ) : null}
              {/* Verifiers matter most here: their notice is the one whose
                  silent loss stalls a release. */}
              <DeliveryLine name={v.name} email={v.email} delivery={v.delivery} />
              {/* Evidence about a PERSON, not about a provider's queue. */}
              <DrillLine name={v.name} drill={v.drill} />
              <ProviderRiskLine name={v.name} email={v.email} />
              <SecondAddressControl personType="verifier" person={v} onChanged={onChange} />
              {v.fingerprint && hasClaimed(v.standby_state) ? (
                <FingerprintControl
                  personId={v.id}
                  personType="verifier"
                  name={v.name}
                  fingerprint={v.fingerprint}
                  state={readStandbyState(v.standby_state) === 'confirmed' ? 'confirmed' : 'claimed'}
                  onChanged={onChange}
                />
              ) : null}
              {canHoldBreakGlass(v.standby_state) ? (
                <BreakGlassControl
                  personId={v.id}
                  personType="verifier"
                  name={v.name}
                  hasClaimed={hasClaimed(v.standby_state)}
                />
              ) : null}
            </div>
            {/* A verifier holds no items, so there is no count to name — the
                consequence is to the quorum, which the readiness banner states
                far better than a sentence beside a button could. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s3)' }}>
              <RenameControl personType="verifier" person={v} onRenamed={onChange} />
              <RemoveButton onConfirm={() => remove(v.id)} name={v.name} />
            </div>
          </li>
        ))}
      </ul>

      {/*
        The verifier half of the same removal — see the note in RecipientSection
        above. Becoming a trusted contact is now a tick on the one form at the
        top of this page.

        ⚠️ THE NOUN CAME WITH IT. This button read "Add a trusted contact", and
        the reason was written here: the readiness blocker says "No trusted
        contact yet" and /rules says "Add a trusted contact", both linking to
        this screen, where the phrase had appeared nowhere and the only button
        offered "verifier" instead. That phrase now lives on the AddPersonForm
        tick — the place an owner following their own to-do list arrives at — and
        `role-noun.test.ts` reads BOTH files so it cannot go missing by being
        moved. "verifier" stays the table, the type and the API; renaming those
        for a copy problem would be a contract change.
      */}

      {/*
        Sits under the verifiers and nowhere else. They are the people whose
        silence stalls a release — a recipient who misses a message can be
        reached again, a verifier who misses one means quorum is never met.
      */}
      {items.length > 0 ? <FireDrillControl onRun={onChange} /> : null}
    </section>
  );
}
