/**
 * The off-GitHub heartbeat alerts on CHANGE, not on every tick.
 *
 * 🔴 WHY. `scripts/heartbeat-local.ts` runs every 15 minutes and, until
 * 2026-10-08, mailed "[relay] heartbeat: delivery FAILING" on EVERY run while a
 * known-open condition held — GitHub dropping the sub-hourly canary schedule
 * (B11, open since 2026-08-29). `.heartbeat/runs.jsonl`, 2026-09-24 → 10-08:
 * 41 finding runs, 37 alerts sent, in 16 separate episodes of 1-6 runs each.
 * Thirteen identical mails in two days. A watchdog that mails the same sentence
 * every quarter-hour gets filtered, and then the production half — the one
 * that means customers are meeting a broken product — is filtered with it.
 *
 * What these tests hold:
 *   - identical consecutive ticks send ONE mail (the RED this file was written on);
 *   - a different problem alerts at once;
 *   - an unchanged problem re-alerts at most once per reminder period;
 *   - a clear sends ONE "recovered" mail, after the clear has held for the
 *     recovery period — because the delivery condition FLAPS (episodes ~6h
 *     apart), and a recovered mail on the first clean tick would replace one
 *     mail per episode with two;
 *   - the state file failing in any way fails OPEN: the mail goes, the check
 *     does not crash.
 *
 * Feature: relay-h0-mvp
 * Requirements: B12.i
 */

import { describe, it, expect, afterAll } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  alertTick,
  composeFindingAlert,
  fileStateStore,
  policyFromEnv,
  productionKey,
  problemKeys,
  type AlertPolicy,
  type AlertState,
  type HeartbeatFinding,
  type StateStore,
  type TickDeps,
} from './heartbeat-alert';

const BASE = 'https://relaystandby.com';
const H = 3600_000;
const T0 = Date.parse('2026-10-08T15:39:41.000Z');
const POLICY: AlertPolicy = { remindHours: 24, recoveryHours: 6 };

const DELIVERY = (n = 0): HeartbeatFinding => ({
  half: 'delivery',
  key: 'scheduled-canary-stopped',
  detail: `${n} scheduled canary run(s) in the last 6h (need ≥ 1)`,
  consequence: 'GitHub has stopped delivering the scheduled canary entirely.',
});
const PRODUCTION = (checks = ['landing page serves']): HeartbeatFinding => ({
  half: 'production',
  key: checks.slice().sort().join(','),
  detail: checks.map((c) => `✗ ${c} — request failed`).join('\n'),
  consequence: 'A behavioural check against production FAILED.',
});

/** In-memory store with the same contract as the file store. */
function memoryStore(initial: AlertState | null = null): StateStore & { value: AlertState | null } {
  const s = {
    value: initial,
    read() {
      return s.value ? { kind: 'ok' as const, state: structuredClone(s.value) } : { kind: 'none' as const };
    },
    write(next: AlertState | null) {
      s.value = next ? structuredClone(next) : null;
    },
  };
  return s;
}

interface Harness {
  deps: TickDeps;
  sent: { subject: string; text: string }[];
  at: (ms: number) => void;
}
function harness(store: StateStore, sendResult = true): Harness {
  let now = T0;
  const sent: { subject: string; text: string }[] = [];
  return {
    sent,
    at: (ms) => {
      now = ms;
    },
    deps: {
      store,
      now: () => new Date(now),
      send: async (subject, text) => {
        sent.push({ subject, text });
        return sendResult;
      },
    },
  };
}
const tick = (h: Harness, findings: HeartbeatFinding[], extra: { unknownHalves?: ('production' | 'delivery')[] } = {}) =>
  alertTick(findings, h.deps, { baseUrl: BASE, policy: POLICY, ...extra });

describe('heartbeat alerting — on change, not on every tick', () => {
  it('🔴 two identical consecutive ticks send ONE mail, not two', async () => {
    const h = harness(memoryStore());
    await tick(h, [DELIVERY()]);
    h.at(T0 + 15 * 60_000);
    await tick(h, [DELIVERY()]);
    expect(h.sent.map((m) => m.subject)).toEqual(['[relay] heartbeat: delivery FAILING']);
  });

  it('a run of identical ticks inside the reminder period stays at one mail', async () => {
    const h = harness(memoryStore());
    for (let i = 0; i < 20; i++) {
      h.at(T0 + i * 15 * 60_000);
      await tick(h, [DELIVERY()]);
    }
    expect(h.sent).toHaveLength(1);
  });

  it('the fingerprint ignores counts and text that change every run', async () => {
    // The delivery detail carries a count; a production detail carries canary output.
    // Neither belongs in "is this the same problem".
    const h = harness(memoryStore());
    await tick(h, [DELIVERY(0)]);
    h.at(T0 + 15 * 60_000);
    await tick(h, [{ ...DELIVERY(0), detail: 'different wording, same problem' }]);
    expect(h.sent).toHaveLength(1);
  });

  it('a DIFFERENT problem alerts at once, and says what is new', async () => {
    const h = harness(memoryStore());
    await tick(h, [DELIVERY()]);
    h.at(T0 + 15 * 60_000);
    // the script pushes the production finding first, then delivery
    await tick(h, [PRODUCTION(), DELIVERY()]);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].subject).toBe('[relay] heartbeat: production + delivery FAILING');
    expect(h.sent[1].text).toMatch(/new: production:landing page serves/);
  });

  it('a different failing production check is a different problem', async () => {
    const h = harness(memoryStore());
    await tick(h, [PRODUCTION(['landing page serves'])]);
    h.at(T0 + 15 * 60_000);
    await tick(h, [PRODUCTION(['checkout requires a session'])]);
    expect(h.sent).toHaveLength(2);
  });

  it('one half clearing while the other persists is a change, and is reported as cleared', async () => {
    const h = harness(memoryStore());
    await tick(h, [DELIVERY(), PRODUCTION()]);
    h.at(T0 + 15 * 60_000);
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].text).toMatch(/cleared: production:landing page serves/);
  });
});

describe('heartbeat alerting — the reminder', () => {
  it('an unchanged problem re-alerts once the reminder period has passed, not before', async () => {
    const h = harness(memoryStore());
    await tick(h, [DELIVERY()]);
    h.at(T0 + 24 * H - 60_000);
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(1);
    h.at(T0 + 24 * H);
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].subject).toBe('[relay] heartbeat: delivery FAILING');
    expect(h.sent[1].text).toMatch(/reminder/i);
    // and the next reminder is measured from THIS mail, not the first
    h.at(T0 + 24 * H + 15 * 60_000);
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(2);
  });

  it('every alert says when the next reminder will come', async () => {
    const h = harness(memoryStore());
    await tick(h, [DELIVERY()]);
    expect(h.sent[0].text).toContain(`Next reminder: ${new Date(T0 + 24 * H).toISOString()}`);
  });

  it('the reminder period is env-overridable', async () => {
    const policy = policyFromEnv({ HEARTBEAT_REMIND_HOURS: '2' });
    expect(policy.remindHours).toBe(2);
    const h = harness(memoryStore());
    await alertTick([DELIVERY()], h.deps, { baseUrl: BASE, policy });
    h.at(T0 + 2 * H);
    await alertTick([DELIVERY()], h.deps, { baseUrl: BASE, policy });
    expect(h.sent).toHaveLength(2);
  });
});

describe('heartbeat alerting — recovery', () => {
  it('a clear sends ONE recovered mail once it has held for the recovery period', async () => {
    const h = harness(memoryStore());
    await tick(h, [DELIVERY()]);
    h.at(T0 + 15 * 60_000);
    await tick(h, []); // first clean tick: clear, but not yet held
    expect(h.sent).toHaveLength(1);
    h.at(T0 + 15 * 60_000 + 6 * H);
    await tick(h, []);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].subject).toBe('[relay] heartbeat: recovered');
    expect(h.sent[1].text).toContain('delivery:scheduled-canary-stopped');
    // and nothing after that
    for (let i = 1; i <= 8; i++) {
      h.at(T0 + 15 * 60_000 + 6 * H + i * 15 * 60_000);
      await tick(h, []);
    }
    expect(h.sent).toHaveLength(2);
  });

  it('the same problem returning inside the recovery period is NOT a new alert (the flap)', async () => {
    const h = harness(memoryStore());
    await tick(h, [DELIVERY()]);
    h.at(T0 + 1 * H);
    await tick(h, []);
    h.at(T0 + 5 * H);
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(1);
    // and the clear clock restarted: 6h after the FIRST clear is not enough now
    h.at(T0 + 5.25 * H);
    await tick(h, []);
    h.at(T0 + 7.5 * H);
    await tick(h, []);
    expect(h.sent).toHaveLength(1);
  });

  it('a DIFFERENT problem during the recovery period alerts at once', async () => {
    const h = harness(memoryStore());
    await tick(h, [DELIVERY()]);
    h.at(T0 + 1 * H);
    await tick(h, []);
    h.at(T0 + 2 * H);
    await tick(h, [PRODUCTION()]);
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].subject).toBe('[relay] heartbeat: production FAILING');
  });

  it('HEARTBEAT_RECOVERY_HOURS=0 sends the recovered mail on the first clean tick', async () => {
    const policy = policyFromEnv({ HEARTBEAT_RECOVERY_HOURS: '0' });
    const h = harness(memoryStore());
    await alertTick([DELIVERY()], h.deps, { baseUrl: BASE, policy });
    h.at(T0 + 15 * 60_000);
    await alertTick([], h.deps, { baseUrl: BASE, policy });
    expect(h.sent.map((m) => m.subject)).toEqual([
      '[relay] heartbeat: delivery FAILING',
      '[relay] heartbeat: recovered',
    ]);
  });

  it('a healthy tick with no open alert sends nothing', async () => {
    const h = harness(memoryStore());
    await tick(h, []);
    expect(h.sent).toHaveLength(0);
  });

  it('a half that could not be looked at is unknown, not cleared', async () => {
    // gh unavailable while production fails: the delivery problem is not "resolved".
    const h = harness(memoryStore());
    await tick(h, [DELIVERY()]);
    h.at(T0 + 15 * 60_000);
    await tick(h, [PRODUCTION()], { unknownHalves: ['delivery'] });
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1].text).not.toMatch(/cleared: delivery/);
    h.at(T0 + 30 * 60_000);
    await tick(h, [DELIVERY(), PRODUCTION()]); // gh back: same set as carried — no mail
    expect(h.sent).toHaveLength(2);
  });
});

describe('heartbeat alerting — fails OPEN', () => {
  it('a store whose read throws still sends', async () => {
    const store: StateStore = {
      read: () => {
        throw new Error('EACCES');
      },
      write: () => {},
    };
    const h = harness(store);
    const out = await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(1);
    expect(out.sent).toBe(true);
    expect(h.sent[0].text).toMatch(/alert-state file could not be read/);
  });

  it('a store whose write throws does not crash the check, and the next tick sends again', async () => {
    const store: StateStore = {
      read: () => ({ kind: 'none' }),
      write: () => {
        throw new Error('ENOSPC');
      },
    };
    const h = harness(store);
    const out = await tick(h, [DELIVERY()]);
    expect(out.sent).toBe(true);
    expect(out.stateError).toMatch(/ENOSPC/);
    h.at(T0 + 15 * 60_000);
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(2);
  });

  it('a mail that could not be sent does not advance the state — the next tick retries', async () => {
    const store = memoryStore();
    const failing = harness(store, false);
    await tick(failing, [DELIVERY()]);
    expect(store.value).toBeNull();
    const ok = harness(store, true);
    ok.at(T0 + 15 * 60_000);
    await tick(ok, [DELIVERY()]);
    expect(ok.sent).toHaveLength(1);
  });

  it('a recovered mail that could not be sent is retried on the next tick', async () => {
    const policy = policyFromEnv({ HEARTBEAT_RECOVERY_HOURS: '0' });
    const store = memoryStore();
    const h = harness(store);
    await alertTick([DELIVERY()], h.deps, { baseUrl: BASE, policy });
    const failing = harness(store, false);
    failing.at(T0 + 15 * 60_000);
    await alertTick([], failing.deps, { baseUrl: BASE, policy });
    expect(store.value).not.toBeNull();
    const ok = harness(store, true);
    ok.at(T0 + 30 * 60_000);
    await alertTick([], ok.deps, { baseUrl: BASE, policy });
    expect(ok.sent.map((m) => m.subject)).toEqual(['[relay] heartbeat: recovered']);
    expect(store.value).toBeNull();
  });

  it('a state stamped in the future is distrusted and the alert goes', async () => {
    // A far-future lastAlertAt would otherwise suppress every reminder until that date.
    const future = new Date(T0 + 30 * 24 * H).toISOString();
    const h = harness(
      memoryStore({ v: 1, problems: ['delivery:scheduled-canary-stopped'], firstAlertAt: future, lastAlertAt: future, clearSince: null }),
    );
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(1);
  });
});

describe('heartbeat alerting — the state file', () => {
  const dirs: string[] = [];
  const tmp = () => {
    const d = mkdtempSync(join(tmpdir(), 'relay-hb-state-'));
    dirs.push(d);
    return d;
  };
  afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

  it('round-trips, reports a missing file as no open alert, and deletes on null', () => {
    const p = join(tmp(), 'nested', 'alert-state.json');
    const store = fileStateStore(p);
    expect(store.read()).toEqual({ kind: 'none' });
    const st: AlertState = { v: 1, problems: ['delivery:x'], firstAlertAt: new Date(T0).toISOString(), lastAlertAt: new Date(T0).toISOString(), clearSince: null };
    store.write(st);
    expect(store.read()).toEqual({ kind: 'ok', state: st });
    store.write(null);
    expect(existsSync(p)).toBe(false);
    expect(store.read()).toEqual({ kind: 'none' });
  });

  it('🔴 a corrupt state file reads as unreadable, the alert goes, and the file is repaired', async () => {
    const d = tmp();
    const p = join(d, 'alert-state.json');
    writeFileSync(p, '{"v":1,"problems":[tru');
    const store = fileStateStore(p);
    expect(store.read().kind).toBe('unreadable');
    const h = harness(store);
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(1);
    expect(JSON.parse(readFileSync(p, 'utf8')).problems).toEqual(['delivery:scheduled-canary-stopped']);
    h.at(T0 + 15 * 60_000);
    await tick(h, [DELIVERY()]);
    expect(h.sent).toHaveLength(1);
  });

  it('a well-formed file of the wrong shape is unreadable too', () => {
    const d = tmp();
    const p = join(d, 'alert-state.json');
    for (const bad of ['null', '[]', '{"v":2}', '{"v":1,"problems":"x","firstAlertAt":"a","lastAlertAt":"b","clearSince":null}']) {
      writeFileSync(p, bad);
      expect(fileStateStore(p).read().kind, bad).toBe('unreadable');
    }
  });

  it('a path that cannot be read as a file reads as unreadable rather than throwing', () => {
    const d = tmp();
    const p = join(d, 'is-a-dir');
    mkdirSync(p);
    expect(fileStateStore(p).read().kind).toBe('unreadable');
  });
});

describe('heartbeat alerting — the message', () => {
  it('keeps the existing subject and body format', () => {
    const { subject, text } = composeFindingAlert([DELIVERY()], {
      baseUrl: BASE,
      at: new Date(T0),
      why: 'new',
      added: [],
      cleared: [],
      nextReminderAt: new Date(T0 + 24 * H),
      policy: POLICY,
    });
    expect(subject).toBe('[relay] heartbeat: delivery FAILING');
    expect(text.startsWith(`The off-GitHub heartbeat (B12.i) found 1 problem(s) at ${new Date(T0).toISOString()}.`)).toBe(true);
    expect(text).toContain('── DELIVERY\n0 scheduled canary run(s) in the last 6h (need ≥ 1)\n\n→ GitHub has stopped');
    expect(text.endsWith(`Probed: ${BASE}\n`)).toBe(true);
  });

  it('keys a production failure on the names of the failing checks, sorted', () => {
    const out = [
      'canary → https://relaystandby.com',
      '',
      '  ✓ ports healthy — HTTP 200',
      '  ✗ signup page offers enrolment — request failed',
      '  ✗ landing page serves — HTTP 500',
      '',
      '2 of 8 checks FAILED:',
    ].join('\n');
    expect(productionKey(out)).toBe('landing page serves,signup page offers enrolment');
    expect(productionKey('')).toBe('canary-failed-without-naming-a-check');
  });

  it('problemKeys is a sorted, de-duplicated set', () => {
    expect(problemKeys([PRODUCTION(), DELIVERY(), DELIVERY(3)])).toEqual([
      'delivery:scheduled-canary-stopped',
      'production:landing page serves',
    ]);
  });

  it('policy defaults, and refuses nonsense rather than inventing a period', () => {
    expect(policyFromEnv({})).toEqual({ remindHours: 24, recoveryHours: 6 });
    expect(policyFromEnv({ HEARTBEAT_REMIND_HOURS: 'soon', HEARTBEAT_RECOVERY_HOURS: '-3' })).toEqual({
      remindHours: 24,
      recoveryHours: 6,
    });
    expect(policyFromEnv({ HEARTBEAT_REMIND_HOURS: '0.5', HEARTBEAT_RECOVERY_HOURS: '12' })).toEqual({
      remindHours: 0.5,
      recoveryHours: 12,
    });
  });
});
