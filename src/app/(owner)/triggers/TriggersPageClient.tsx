'use client';

/**
 * Triggers & Simulate screen (Requirement 4.1, 5.x, 9.1 / task 19.1).
 *
 * Per-trigger release-state badges, check-in cadence config, N-of-M config,
 * Initiate (ARMED), Cancel (GRACE + reversible), and a demo-only Simulate button
 * that runs the ~10s ARMED→PENDING→GRACE→RELEASED flow with a countdown bar.
 *
 * Feature: relay-h0-mvp
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiGet, apiSend } from '../_lib/api';
import { article } from '../../../../lib/text/article';

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
  const [msg, setMsg] = useState<string | null>(null);

  async function checkIn() {
    setState('busy');
    setMsg(null);
    try {
      const r = (await apiSend('/api/checkin', 'PUT')) as { reset?: string[]; blocked?: string[] };
      const reset = r?.reset ?? [];
      // Naming what was stood down matters: an owner checking in after an alarm
      // needs to know it actually closed, not just that a button worked.
      setMsg(
        reset.length > 0
          ? `Checked in — ${reset.join(', ')} re-armed.`
          : 'Checked in. Nothing needed reversing.',
      );
      setState('done');
      await onDone();
    } catch (err) {
      setState('idle');
      setMsg(String((err as Error).message));
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
      {msg ? <span className="text-t2 text-sage-text">{msg}</span> : null}
    </span>
  );
}

function CadenceForm({ current, onSaved }: { current: number; onSaved: () => Promise<void> }) {
  const [days, setDays] = useState(String(current));
  const [msg, setMsg] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    try {
      await apiSend('/api/settings', 'PUT', { checkin_interval_days: Number(days) });
      setMsg('Saved');
      await onSaved();
    } catch (err) {
      setMsg(String((err as Error).message));
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
      {msg ? <span className="text-t2 text-muted">{msg}</span> : null}
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

function TriggerCard({ rs, onChange }: { rs: ReleaseState; onChange: () => Promise<void> }) {
  const reversible = rs.trigger_type !== 'estate';
  const [n, setN] = useState(String(rs.required_confirmations));
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
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
   * The irreversible branch asks the trigger type to be TYPED, matching what
   * closing an account already demands. One click after a warning is not a
   * decision; finding the keyboard is.
   */
  const [confirmingInitiate, setConfirmingInitiate] = useState(false);
  const [typedConfirm, setTypedConfirm] = useState('');

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      setConfirmingCancel(false);
      await onChange();
    } catch (err) {
      setMsg(String((err as Error).message));
    }
  };

  return (
    <div className="rounded border border-rule bg-paper-raised p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium capitalize">{rs.trigger_type}</span>
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${STATE_STYLE[rs.state] ?? 'bg-paper-sunken text-muted'}`}>
            {rs.state}
          </span>
          <span className="text-t1 text-muted">
            {rs.received_confirmations}/{rs.required_confirmations} confirmations
          </span>
        </div>
        <div className="flex gap-2">
          {/* Firing a release is the most consequential control on this screen
              and was one unguarded click. See the note on `confirmingInitiate`. */}
          {rs.state === 'armed' && !confirmingInitiate ? (
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
          {/* Two-step inline rather than window.confirm: a native modal blocks
              the page, reads badly on a phone, and cannot be exercised by the
              browser tests that guard this behaviour. */}
          {rs.state === 'grace' && reversible ? (
            confirmingCancel ? (
              <button
                onClick={() => act(() => apiSend(`/api/triggers/${rs.id}/cancel`, 'POST'))}
                className="rounded border border-clay bg-clay-soft px-2.5 py-1 text-t1 font-semibold text-clay hover:bg-clay-soft"
              >
                Retire it for good — tap again
              </button>
            ) : (
              <button
                onClick={() => setConfirmingCancel(true)}
                className="rounded border border-rule-strong px-2.5 py-1 text-t1 font-medium text-muted hover:bg-clay-soft hover:text-clay"
              >
                Cancel permanently
              </button>
            )
          ) : null}
        </div>
      </div>

      {/* CANCELLED is terminal — nothing transitions out of it and check-in
          does not reverse it. A bare badge does not convey that a rule is dead,
          so say it. */}
      {rs.state === 'cancelled' ? (
        <p className="mt-2 text-t1 leading-relaxed text-muted">
          Retired. This trigger cannot be re-armed — recreate the access rule to grant this
          recipient emergency access again.
        </p>
      ) : null}
      {confirmingCancel && rs.state === 'grace' ? (
        <p className="mt-2 text-t1 leading-relaxed text-clay">
          This retires the trigger for good. To stop a false alarm and keep the rule, use{' '}
          <span className="font-semibold">Stand down — re-arm</span> instead.
        </p>
      ) : null}

      {/*
        The confirmation, stating the CONSEQUENCE rather than asking "are you
        sure" — which is a question nobody reads. Reversible and irreversible
        triggers get different sentences and different weights, because they are
        different acts that happen to share a button.
      */}
      {confirmingInitiate && rs.state === 'armed' ? (
        <div
          className={`mt-3 rounded border p-3 ${
            reversible ? 'border-ochre bg-ochre-soft' : 'border-clay bg-clay-soft'
          }`}
        >
          {reversible ? (
            <p className="text-t2 leading-relaxed text-ink">
              Everyone you named to confirm {article(rs.trigger_type)}{' '}
              <span className="font-semibold">{rs.trigger_type}</span> will be asked whether this is
              real. If enough of them agree, the access you arranged
              opens. <span className="font-semibold">You can stop it at any point by checking in.</span>
            </p>
          ) : (
            <>
              <p className="text-t2 font-semibold leading-relaxed text-clay">
                {article(rs.trigger_type) === 'an' ? 'An' : 'A'} {rs.trigger_type} handover cannot
                be undone.
              </p>
              <p className="mt-1 text-t2 leading-relaxed text-clay">
                If the people you named agree, what you set aside passes to them permanently.
                Checking in will not reverse it and neither can we.
              </p>
              {/* The window is the whole protection here, so it is named rather
                  than left as a silent property of the system. */}
              <p className="mt-1 text-t2 leading-relaxed text-clay">
                Relay waits <span className="font-semibold">three days</span> after they agree
                before it completes. That is the only chance anyone gets to stop it.
              </p>
              <label htmlFor={`confirm-${rs.id}`} className="mt-3 block text-t2 font-medium text-clay">
                Type <span className="font-semibold">{rs.trigger_type}</span> to confirm
              </label>
              <input
                id={`confirm-${rs.id}`}
                value={typedConfirm}
                onChange={(e) => setTypedConfirm(e.target.value)}
                autoComplete="off"
                className="mt-1 w-full rounded border border-clay px-3 py-2 text-t2"
              />
            </>
          )}

          <div className="mt-3 flex gap-2">
            <button
              type="button"
              disabled={!reversible && typedConfirm.trim().toLowerCase() !== rs.trigger_type}
              onClick={() => {
                setConfirmingInitiate(false);
                setTypedConfirm('');
                void act(() =>
                  apiSend(`/api/triggers/${encodeURIComponent(rs.trigger_type)}/initiate`, 'POST'),
                );
              }}
              className={`min-h-[32px] rounded px-3 py-1.5 text-t2 font-semibold text-paper disabled:opacity-50 ${
                reversible ? 'bg-ink' : 'bg-clay'
              }`}
            >
              {reversible ? 'Yes — ask them now' : `Hand over permanently`}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmingInitiate(false);
                setTypedConfirm('');
              }}
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
        {msg ? <span className="text-t1 text-clay">{msg}</span> : null}
      </div>
    </div>
  );
}
