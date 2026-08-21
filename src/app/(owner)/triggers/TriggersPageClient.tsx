'use client';

/**
 * Triggers & Simulate screen (Requirement 4.1, 5.x, 9.1 / task 19.1).
 *
 * Per-trigger release-state badges, check-in cadence config, N-of-M config,
 * Initiate (ARMED), Stand down (PENDING/GRACE/RELEASED + reversible), and a
 * demo-only Simulate button that runs the ~10s ARMED→PENDING→GRACE→RELEASED
 * flow with a countdown bar.
 *
 * 🔴 CANCEL IS GONE — ruled 2026-08-21, and this line used to name it. It sat
 * next to Stand down, two taps deep, and it retired the whole trigger TYPE for
 * the owner for good: every access rule using it, every recipient scoped to it,
 * with no edge out of CANCELLED anywhere in the state machine. Two rounds of
 * copy fixes went into making that button honest about itself; the ruling is
 * that no wording earns a permanent, unreachable-from state on the screen
 * somebody opens in a hurry. Stand down covers the false alarm and re-arms.
 *
 * Feature: relay-h0-mvp
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiSend } from '../_lib/api';
import { article } from '../../../../lib/text/article';
import { StatusLine, type StatusMessage } from './StatusLine';

interface ReleaseState {
  id: string;
  trigger_type: string;
  state: string;
  required_confirmations: number;
  received_confirmations: number;
}
interface TriggersResponse {
  releaseStates: ReleaseState[];
  checkinIntervalDays: number;
  isDemo: boolean;
}

/*
  The release states, in the system's own vocabulary.

  ARMED is sage: closed, safe, the resting state a vault sits in for years and
  returns to on its own. PENDING, GRACE and RELEASED are all ochre, because they
  are all the same thing — something is in motion and it can still be undone —
  and giving each its own colour would imply a difference in kind that does not
  exist.

  RELEASED was clay. That was wrong: clay is reserved for what cannot be taken
  back, and a released emergency trigger closes itself the moment the owner
  checks in. Spending clay here would leave nothing to mark the estate handoff,
  which is the one thing in the product that really is permanent.

  CANCELLED is muted rather than coloured: it is over, and nothing is asked of
  anyone.
*/
const STATE_STYLE: Record<string, string> = {
  armed: 'bg-sage-soft text-sage-text',
  pending: 'bg-ochre-soft text-ochre-text',
  grace: 'bg-ochre-soft text-ochre-text',
  released: 'bg-ochre-soft text-ochre-text',
  cancelled: 'bg-paper-sunken text-muted',
};

const SIMULATE_MS = 10_000;

export default function TriggersPage() {
  const [data, setData] = useState<TriggersResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setData(await apiGet<TriggersResponse>('/api/triggers'));
  }, []);

  useEffect(() => {
    load().catch((e) => setError(String(e.message)));
  }, [load]);

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <header>
        <h1 className="text-t7 font-semibold tracking-tight">Triggers</h1>
        {/*
          This read "Release state, check-in cadence, and (for demo accounts)
          the simulate control" — three pieces of engineering vocabulary and a
          parenthetical about a mode most owners are not in, on the screen that
          decides when their family gets access. Every other owner surface says
          "Who would step in"; this one alone spoke schema. Found by writing the
          user manual, where the sentence had to be translated to be usable.
        */}
        <p className="text-t2 text-muted">
          What would have to happen before anything opens, and how long Relay waits before it starts
          asking whether you are all right.
        </p>
      </header>

      {error ? <p className="rounded border border-clay bg-clay-soft px-4 py-3 text-t2 text-clay">{error}</p> : null}

      {data ? (
        <>
          <CadenceForm current={data.checkinIntervalDays} onSaved={load} />
          {data.isDemo ? <SimulatePanel onDone={load} /> : null}

          <section className="space-y-3">
            <h2 className="text-t5 font-semibold uppercase tracking-wide text-muted">Your triggers</h2>
            {data.releaseStates.length === 0 ? (
              <p className="text-t2 text-muted">Nothing is set to open yet. Decide who could reach what on the Rules page, and the conditions appear here.</p>
            ) : null}
            {data.releaseStates.map((rs) => (
              <TriggerCard key={rs.id} rs={rs} onChange={load} />
            ))}
          </section>
        </>
      ) : (
        !error && <p className="text-t2 text-muted">Loading…</p>
      )}
    </div>
  );
}

function CheckInButton({ onDone }: { onDone: () => Promise<void> }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  /*
    🔴 THIS WAS A BARE STRING AND BOTH BRANCHES WROTE INTO IT, corrected
    2026-08-21 — success sentence and thrown error alike, rendered in
    `text-sage-text`, the colour reserved for "closed, safe". An owner whose
    check-in failed (401 after a session expiry, a 500) read "Request failed
    (401)" in the reassuring colour beside the most time-critical control in the
    product. The tone now travels with the message; see StatusLine.tsx.
  */
  const [msg, setMsg] = useState<StatusMessage | null>(null);

  async function checkIn() {
    setState('busy');
    setMsg(null);
    try {
      const r = (await apiSend('/api/checkin', 'PUT')) as { reset?: string[]; blocked?: string[] };
      const reset = r?.reset ?? [];
      // Naming what was stood down matters: an owner checking in after an alarm
      // needs to know it actually closed, not just that a button worked.
      setMsg({
        ok: true,
        text:
          reset.length > 0
            ? `Checked in — ${reset.join(', ')} re-armed.`
            : 'Checked in. Nothing needed reversing.',
      });
      setState('done');
      await onDone();
    } catch (err) {
      setState('idle');
      setMsg({ ok: false, text: String((err as Error).message) });
    }
  }

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        onClick={checkIn}
        disabled={state === 'busy'}
        className="whitespace-nowrap rounded border border-sage bg-sage-soft px-3 py-1.5 text-t2 font-semibold text-sage-text hover:bg-sage-soft disabled:opacity-60"
      >
        {state === 'busy' ? 'Checking in…' : "I'm fine — check in"}
      </button>
      <StatusLine msg={msg} />
    </span>
  );
}

function CadenceForm({ current, onSaved }: { current: number; onSaved: () => Promise<void> }) {
  const [days, setDays] = useState(String(current));
  // Same slot, same two branches, same fix as CheckInButton. Here the shared
  // colour was `text-muted` rather than sage — not a false green, but "Saved"
  // and a validation refusal were still typographically identical, so a
  // rejected interval looked like an accepted one.
  const [msg, setMsg] = useState<StatusMessage | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await apiSend('/api/settings', 'PUT', { checkin_interval_days: Number(days) });
      setMsg({ ok: true, text: 'Saved' });
      await onSaved();
    } catch (err) {
      setMsg({ ok: false, text: String((err as Error).message) });
    }
  }

  /*
    🔴 flex-wrap WAS MISSING, AND IT CLIPPED THE CHECK-IN BUTTON OFF A PHONE.
    The `basis-full` on the paragraph below only forces its own line inside a
    WRAPPING container. In a nowrap row it just asks for 100% and then shrinks
    to whatever is left — measured 2026-08-14 at 390px as a 35px-wide column
    setting that sentence one word per line for twenty lines, with "I'm fine —
    check in" pushed past the right edge reading "I'm fine — che".

    The most time-critical control in the product was partially off-screen on
    the device it is most likely to be used from, and every automated check
    passed: the card clipped its overflowing child, so scrollWidth still
    equalled innerWidth. This is the exact failure globals.css already records
    at the 720px rule — the content column compresses rather than the document
    overflowing — a second instance of it, found the same way, by looking.
  */
  return (
    <form onSubmit={save} className="flex flex-wrap items-end gap-3 rounded border border-rule bg-paper-raised p-4">
      <label className="text-t2">
        <span className="mb-1 block text-muted">Check-in interval (days)</span>
        <input
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-28 rounded border border-rule-strong px-2.5 py-1.5 text-t2 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink"
        />
      </label>
      <button type="submit" className="rounded bg-ink px-3 py-1.5 text-t2 font-semibold text-paper hover:bg-ink">
        Save
      </button>
      {/*
        Said where the decision is actually made, not only in the Terms. This
        field is the dead-man's switch: miss it for long enough and an armed
        release opens. The owner should meet that fact while choosing the
        number, because the Terms are read once and this is read every time.
        Ratified 2026-08-14 alongside declining gate g2-counsel-opinion.
      */}
      <p className="basis-full text-t1 text-muted">
        If you stop checking in — for any reason — an armed release opens to the people you named,
        and stays open until you or they close it. Relay does not close it for you.
      </p>
      {/* The check-in itself, which had no control anywhere in the product.
          processCheckin reverses PENDING, GRACE and RELEASED back to ARMED — it
          is the routine "I'm fine" that the whole dead-man's-switch is built
          around — and the only way to perform one was to wait for the cron to
          notice, or to stand down each trigger individually. */}
      <CheckInButton onDone={onSaved} />
      <StatusLine msg={msg} />
    </form>
  );
}

function SimulatePanel({ onDone }: { onDone: () => Promise<void> }) {
  const [progress, setProgress] = useState<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [result, setResult] = useState<string | null>(null);

  useEffect(() => () => {
    if (timer.current) clearInterval(timer.current);
  }, []);

  async function run() {
    setResult(null);
    setProgress(0);
    const start = Date.now();
    timer.current = setInterval(() => {
      setProgress(Math.min(100, ((Date.now() - start) / SIMULATE_MS) * 100));
    }, 100);
    try {
      const res = await apiSend<{ states: string[] }>('/api/demo/simulate', 'POST', { trigger_type: 'emergency' });
      setResult(`Released via ${res.states.join(' → ')}`);
    } catch (err) {
      setResult(String((err as Error).message));
    } finally {
      if (timer.current) clearInterval(timer.current);
      setProgress(null);
      await onDone();
    }
  }

  return (
    <section className="rounded border border-ochre bg-ochre-soft p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-t5 font-semibold text-ochre-text">Simulate emergency (demo)</h2>
          <p className="text-t1 text-ochre-text">Fast-forwards ARMED → PENDING → GRACE → RELEASED in ~10s using the real state machine.</p>
        </div>
        <button
          onClick={run}
          disabled={progress !== null}
          className="rounded bg-ink px-3 py-1.5 text-t2 font-semibold text-paper hover:bg-ink disabled:opacity-60"
        >
          {progress !== null ? 'Running…' : 'Simulate'}
        </button>
      </div>
      {progress !== null ? (
        <div className="mt-3 h-2 overflow-hidden rounded bg-ochre-soft">
          <div className="h-full bg-ink transition-all" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {result ? <p className="mt-2 text-t2 text-ochre-text">{result}</p> : null}
    </section>
  );
}

/**
 * What a legacy row of a WITHDRAWN trigger type says about itself, per state.
 * `null` means the state already explains itself elsewhere on the card.
 *
 * A pure function, and exported, so the gate can be asserted state by state
 * rather than by grepping the file for the word "withdrawn" — the first version
 * of this notice was gated `!reversible && rs.state === 'armed'` and a test that
 * only looked for the word passed while PENDING, GRACE and RELEASED rendered a
 * badge, no controls, and no explanation.
 *
 * ⚠️ EVERY SENTENCE HERE IS A CLAIM ABOUT CODE ELSEWHERE. "Cannot be started"
 * holds because `/api/triggers/[id]/initiate` refuses a non-user-selectable type
 * AND because `runHeartbeatSweep` binds `USER_SELECTABLE_TRIGGER_TYPES` in its
 * armed-row read — it did not, until 2026-08-21, and this sentence was false on
 * the cron path for the week it shipped. "Checking in will not stand it down"
 * holds because `processCheckin` reports a non-reversible row as `blocked`. If
 * either of those changes, this copy is a defect, not a stale comment.
 */
export function withdrawnNotice(triggerType: string, state: string): string | null {
  if (triggerType !== 'estate') return null;
  switch (state) {
    case 'armed':
      return (
        `Withdrawn. Relay no longer offers ${triggerType} arrangements, and this trigger cannot ` +
        `be started — not by you, and not by the check-in schedule. Nothing you set aside has ` +
        `been changed or shared.`
      );
    case 'pending':
    case 'grace':
      return (
        `Withdrawn. Relay no longer offers ${triggerType} arrangements. This one started before ` +
        `that decision and is still running: checking in will not stand it down, because ` +
        `${triggerType} was never reversible.`
      );
    case 'released':
      return (
        `Withdrawn. Relay no longer offers ${triggerType} arrangements. This one completed before ` +
        `that decision, and the access it opened stays open — checking in does not close it, ` +
        `because ${triggerType} was never reversible.`
      );
    // CANCELLED has its own paragraph, which renders for every trigger type.
    default:
      return null;
  }
}

function TriggerCard({ rs, onChange }: { rs: ReleaseState; onChange: () => Promise<void> }) {
  const reversible = rs.trigger_type !== 'estate';
  const [n, setN] = useState(String(rs.required_confirmations));
  const [msg, setMsg] = useState<StatusMessage | null>(null);
  /**
   * 🔴 FIRING A RELEASE WAS ONE UNGUARDED CLICK, on a button labelled
   * "Initiate" that did not say what it does. Added 2026-08-12.
   *
   * ⚠️ ITS ORIGINAL JUSTIFICATION IS GONE, AND IT STAYS ANYWAY. This was written
   * as a precondition on `g2-counsel-opinion` — the argument being that a
   * misclick is survivable today, but becomes PERMANENT the day `estate` is
   * selectable, so the confirmation had to exist before then. That day is not
   * coming: g2 was declined on 2026-08-14 and estate is withdrawn permanently.
   *
   * Do not remove this on the strength of that. The confirmation earns its place
   * on what the product does NOW: firing a release contacts every verifier and
   * opens the vault to everyone scoped to that trigger. Stand down reverses the
   * state, but it cannot un-ask the circle — and verifiers who get spurious asks
   * stop answering the real one, which is the failure the whole assurance model
   * rests on not happening. A false alarm is cheap in database terms and
   * expensive in the only currency this product runs on.
   *
   * ⚠️ THE TYPE-THE-WORD HALF IS GONE, 2026-08-21. This paragraph used to end:
   * "The irreversible branch asks the trigger type to be TYPED, matching what
   * closing an account already demands." That branch only ever ran for `estate`,
   * which was withdrawn permanently on 2026-08-14 — so it guarded a ceremony
   * whose only possible outcome was a 400 from `/initiate`. Removed with the
   * copy it guarded; `typedConfirm` went with it. The reversible confirmation
   * above stays, on its own argument.
   */
  const [confirmingInitiate, setConfirmingInitiate] = useState(false);

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      // This slot only ever carries failures — `act` sets it nowhere else — so
      // it was already clay. It goes through StatusLine anyway: the invariant
      // worth holding is "no message span picks its own colour", and an
      // exception to it is how the next one gets written.
      setMsg({ ok: false, text: String((err as Error).message) });
    }
  };

  return (
    <div className="rounded border border-rule bg-paper-raised p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium capitalize">{rs.trigger_type}</span>
          <span className={`rounded px-2 py-0.5 text-t1 font-semibold uppercase ${STATE_STYLE[rs.state] ?? 'bg-paper-sunken text-muted'}`}>
            {rs.state}
          </span>
          <span className="text-t1 text-muted">
            {rs.received_confirmations}/{rs.required_confirmations} confirmations
          </span>
        </div>
        <div className="flex gap-2">
          {/* Firing a release is the most consequential control on this screen
              and was one unguarded click. See the note on `confirmingInitiate`. */}
          {/* `reversible` gates the control, not just the copy inside it: for a
              withdrawn trigger type `/initiate` answers 400, so offering the
              button at all is offering a refusal. See the estate note below. */}
          {rs.state === 'armed' && reversible && !confirmingInitiate ? (
            <button
              onClick={() => setConfirmingInitiate(true)}
              className="rounded border border-rule-strong px-2.5 py-1 text-t1 font-medium hover:bg-paper-sunken"
            >
              Start this now
            </button>
          ) : null}
          {/* The false-alarm control, and the DEFAULT one.
              Until 2026-08-08 the only option here was Cancel, which lands in
              CANCELLED — a terminal state with no outgoing transition, which
              check-in does not reverse. Someone standing down a false alarm
              therefore retired the access rule for good, by pressing the most
              innocuous-looking word on the screen. Stand down is prominent;
              the permanent option is demoted and says what it does. */}
          {(rs.state === 'grace' || rs.state === 'pending' || rs.state === 'released') && reversible ? (
            <button
              onClick={() => act(() => apiSend(`/api/triggers/${rs.id}/stand-down`, 'POST'))}
              className="rounded bg-ink px-2.5 py-1 text-t1 font-medium text-paper hover:bg-ink"
            >
              {rs.state === 'released' ? 'Close access — re-arm' : 'Stand down — re-arm'}
            </button>
          ) : null}
          {/*
            🔴 THE SECOND BUTTON IS GONE, 2026-08-21, and this is where it was.

            It read "Cancel permanently", asked for a second tap, and then
            retired the trigger TYPE for this owner for good — every access rule
            that used it, every recipient scoped to it — landing the row in
            CANCELLED, which `PERMITTED_TRANSITIONS` has no edge out of. Check-in
            does not reverse it, the sweep never looks at it again, and
            `/initiate` answers 409 for that type forever.

            It had already been corrected twice: once in 2026-08-08 when it was
            the ONLY stop control and people were retiring their plan while
            trying to stop a false alarm, and again on 2026-08-21 when its
            confirmation was found describing the wrong scope and offering a
            remedy that does nothing. The ruling that followed is that the
            problem is not the wording. Stand down, above, is what a false alarm
            needs, it is the prominent default, and it re-arms.

            Nothing replaces it. An owner who genuinely wants to retire an
            arrangement removes the access rules behind it, which is reversible
            and lives on the screen that owns that decision.
          */}
        </div>
      </div>

      {/*
        CANCELLED is terminal — nothing transitions out of it and check-in does
        not reverse it. A bare badge does not convey that a rule is dead, so say
        it.

        🔴 IT SAID IT AND THEN OFFERED A REMEDY THAT DOES NOTHING, corrected
        2026-08-21. The sentence was: "Retired. This trigger cannot be re-armed —
        recreate the access rule to grant this recipient emergency access again."
        Every clause after the dash was false.

        `release_state` is ONE row per (owner, trigger_type), not one per rule.
        Creating a rule calls `ensureReleaseState`, which returns the EXISTING
        row whatever its state — so the "new" rule binds straight back to the
        cancelled one, `/initiate` answers 409 forever, and the sweep never looks
        at it. An owner following the instruction would have finished believing
        they had restored emergency access, and would find out otherwise on the
        day it mattered. That is the worst class of copy this product can carry.

        It was wrong about the SCOPE too. Cancelling retires the trigger type for
        that owner — every rule that uses it, every recipient — not "this
        recipient".

        The J9 state-machine note in docs/user-journeys.md ("CANCELLED is
        terminal") specifies the other resolution: re-arming
        provisions a NEW release_state row. Nothing implements that, and building
        it is a state-model change, not a copy fix. Until someone rules on it,
        the screen describes what the product does. Guarded by
        cancelled-is-terminal.test.ts.
      */}
      {rs.state === 'cancelled' ? (
        <p className="mt-2 text-t1 leading-relaxed text-muted">
          Retired for good. Nothing re-arms {rs.trigger_type} now — not checking in, not adding a
          new access rule. Every rule that uses this trigger is inert.
        </p>
      ) : null}

      {/*
        The confirmation, stating the CONSEQUENCE rather than asking "are you
        sure" — which is a question nobody reads. Reversible and irreversible
        triggers get different sentences and different weights, because they are
        different acts that happen to share a button.
      */}
      {/*
        🔴 THE IRREVERSIBLE BRANCH WAS A CEREMONY FOR A WITHDRAWN CAPABILITY,
        removed 2026-08-21. It rendered, for any non-reversible trigger: "A
        estate handover cannot be undone", "what you set aside passes to them
        permanently", "Relay waits three days after they agree before it
        completes", a type-the-word input, and a button reading "Hand over
        permanently".

        Estate was withdrawn PERMANENTLY on 2026-08-14 — g2-counsel-opinion was
        DECLINED, not deferred — and Relay confers no legal authority on anyone.
        `USER_SELECTABLE_TRIGGER_TYPES` excludes it and
        `/api/triggers/[type]/initiate` answers 400, so the only reachable
        outcome of that whole ritual was an error: an owner with a legacy
        release_state row would have read three paragraphs about permanence,
        typed the word to confirm, pressed "Hand over permanently", and been
        refused. Two defects in one branch — copy offering a withdrawn
        capability, and a control that can only fail.

        The branch is not deleted into silence. A legacy row still renders, and
        a badge with no controls and no explanation reads as a bug rather than
        as a decision, so it says what happened. Guarded by
        estate-is-withdrawn.test.ts.

        🔴 TWICE CORRECTED THE SAME DAY, and both corrections are the same
        mistake in different clothes — a sentence asserting a safety property
        nothing enforced.

        (1) The replacement read "this trigger cannot be started", which was true
        of the OWNER and false of the CRON: `runHeartbeatSweep` read every armed
        row for an overdue owner with no trigger_type predicate, so the one case
        this paragraph renders in — a legacy armed row — is the exact case where
        the schedule could still fire it, mail every verifier, and release on
        quorum with no stand-down available. Fixed where the mistake happens: the
        sweep now binds `USER_SELECTABLE_TRIGGER_TYPES` in its WHERE clause
        (lib/release/heartbeat.ts), so the sentence is now earned rather than
        asserted, and it says "not by the check-in schedule" out loud.

        (2) It was gated `!reversible && rs.state === 'armed'`, so PENDING, GRACE
        and RELEASED — the three states where something is actually in motion and
        stand-down and cancel are both gated on `reversible` — got the badge with
        no controls and no explanation this very comment says it was avoiding.
        The notice is `withdrawnNotice()` now, a pure function with a sentence per
        state, so the gate is asserted per state instead of grepped for a word.
      */}
      {withdrawnNotice(rs.trigger_type, rs.state) ? (
        <p className="mt-2 text-t1 leading-relaxed text-muted">
          {withdrawnNotice(rs.trigger_type, rs.state)}
        </p>
      ) : null}

      {confirmingInitiate && rs.state === 'armed' && reversible ? (
        <div className="mt-3 rounded border border-ochre bg-ochre-soft p-3">
          <p className="text-t2 leading-relaxed text-ink">
            Everyone you named to confirm {article(rs.trigger_type)}{' '}
            <span className="font-semibold">{rs.trigger_type}</span> will be asked whether this is
            real. If enough of them agree, the access you arranged
            opens. <span className="font-semibold">You can stop it at any point by checking in.</span>
          </p>

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setConfirmingInitiate(false);
                void act(() =>
                  apiSend(`/api/triggers/${encodeURIComponent(rs.trigger_type)}/initiate`, 'POST'),
                );
              }}
              className="min-h-[32px] rounded bg-ink px-3 py-1.5 text-t2 font-semibold text-paper disabled:opacity-50"
            >
              Yes — ask them now
            </button>
            <button
              type="button"
              onClick={() => setConfirmingInitiate(false)}
              className="min-h-[32px] rounded border border-rule-strong bg-paper-raised px-3 py-1.5 text-t2 text-ink"
            >
              Not yet
            </button>
          </div>
        </div>
      ) : null}

      <div className="mt-3 flex items-center gap-2">
        {/*
          A <span> is not a label. axe flagged this as `label` (critical): the
          text beside the box named it for somebody looking at it and for nobody
          using a screen reader. The interval field above gets this right by
          wrapping its input in a <label>; this one sits in a flex row where that
          would change the layout, so it carries the name explicitly — and names
          the TRIGGER too, because the page renders one of these per trigger and
          two controls both called "people who must agree" are not distinguishable.
        */}
        <span className="text-t1 text-muted" aria-hidden="true">
          People who must agree first:
        </span>
        <input
          type="number"
          min={1}
          aria-label={`People who must agree first for the ${rs.trigger_type} trigger`}
          value={n}
          onChange={(e) => setN(e.target.value)}
          className="w-16 rounded border border-rule-strong px-2 py-1 text-t1 focus:border-ink focus:outline-none"
        />
        <button
          onClick={() => act(() => apiSend(`/api/triggers/${encodeURIComponent(rs.trigger_type)}/config`, 'PUT', { required_confirmations: Number(n) }))}
          className="rounded border border-rule-strong px-2 py-1 text-t1 font-medium hover:bg-paper-sunken"
        >
          Set
        </button>
        <StatusLine msg={msg} size="t1" />
      </div>
    </div>
  );
}
