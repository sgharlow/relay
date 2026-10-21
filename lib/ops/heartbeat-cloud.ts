/**
 * B12.i, the cloud half — the off-GitHub heartbeat AND the canary dispatcher,
 * as one tick that an AWS Lambda runs every 15 minutes (EventBridge Scheduler).
 *
 * Until 2026-10-20 both ran as Windows scheduled tasks on VICTUS
 * (`scripts/heartbeat-local.ts` and `relay-canary-dispatch`). They moved to AWS
 * because each local console launch flashed a window on the operator's screen,
 * 192 times a day (Steve's ruling, 2026-10-20). What the tick checks is
 * unchanged; see heartbeat-local.ts for why each half exists. Infra and deploy:
 * `infra/heartbeat-lambda/`, `docs/canary-dispatch.md`.
 *
 * WHAT DIFFERS FROM THE LOCAL SCRIPT, AND WHY:
 *   - GitHub is read and dispatched over REST with a fine-grained token, not `gh`.
 *   - The alert state is an S3 object, read and written through the same
 *     parse/serialize as the local file (heartbeat-alert.ts), so both stores
 *     agree on what a valid state is.
 *   - Mail goes through SNS, not Resend. A Resend send from relaystandby.com
 *     without an `email_send_attempts` row is an orphan delivery event, and
 *     orphans trip webhook-health's mute alarm (operator-alert.ts header). The
 *     row needs a database identity a Lambda does not have and should not get,
 *     so the cloud heartbeat uses a channel that produces no Resend event at all.
 *
 * WHO WATCHES THIS? cadence-watch (daily, GitHub). If the Lambda stops, the
 * canary's counted runs fall to GitHub's own ~5/day, below the floor of 24
 * (lib/ops/cadence-wall.ts), and cadence-watch goes red.
 *
 * Feature: relay-h0-mvp
 * Requirements: B12.i
 */

import {
  alertTick,
  parseAlertState,
  productionKey,
  serializeAlertState,
  type AlertPolicy,
  type AlertState,
  type HeartbeatFinding,
  type StateRead,
  type StateStore,
} from './heartbeat-alert.ts';
import { CANARY_FILE, DISPATCHABLE_COUNTED_EVENTS, countRuns } from './cadence-wall.ts';

export const SCHEDULER_MONITOR_FILE = 'scheduler-monitor.yml';

/**
 * The scheduler monitor is dispatched on every second 15-minute tick: when the
 * UTC minute is in [0,15) or [30,45). The same stateless rule the VICTUS task
 * used (docs/canary-dispatch.md), so its 48/day cadence is unchanged.
 */
export function schedulerMonitorDue(now: Date): boolean {
  const m = now.getUTCMinutes();
  return m < 15 || (m >= 30 && m < 45);
}

type RunRow = { event?: unknown; created_at?: unknown };

export interface GitHubPort {
  listCanaryRuns(): Promise<readonly RunRow[]>;
  /** Throws when GitHub does not accept the dispatch. */
  dispatch(workflowFile: string): Promise<void>;
}

export function githubRest(opts: { token: string; repo: string; ref?: string; fetchImpl?: typeof fetch }): GitHubPort {
  const doFetch = opts.fetchImpl ?? fetch;
  const ref = opts.ref ?? 'master';
  const base = `https://api.github.com/repos/${opts.repo}/actions/workflows`;
  const headers = {
    authorization: `Bearer ${opts.token}`,
    accept: 'application/vnd.github+json',
    'x-github-api-version': '2022-11-28',
    'user-agent': 'relay-heartbeat-lambda',
  };
  return {
    async listCanaryRuns() {
      // per_page=100 is the newest 100 runs — many times the 6h window at ~100 a day.
      const res = await doFetch(`${base}/${CANARY_FILE}/runs?per_page=100`, { headers, signal: AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`GitHub run list HTTP ${res.status}`);
      const body = (await res.json()) as { workflow_runs?: unknown };
      if (!Array.isArray(body?.workflow_runs)) throw new Error('GitHub returned an unreadable run list');
      return (body.workflow_runs as RunRow[]).map((r) => ({ event: r.event, created_at: r.created_at }));
    },
    async dispatch(workflowFile) {
      const res = await doFetch(`${base}/${workflowFile}/dispatches`, {
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json' },
        body: JSON.stringify({ ref }),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status !== 204) {
        const text = (await res.text().catch(() => '')).slice(0, 160);
        throw new Error(`dispatch ${workflowFile} HTTP ${res.status} ${text}`.trim());
      }
    },
  };
}

export interface CloudHeartbeatDeps {
  now(): Date;
  canary(): Promise<{ ok: boolean; output: string }>;
  github: GitHubPort;
  /** The persisted alert state's raw text, or null when there is none. */
  loadState(): Promise<string | null>;
  /** Persist the raw text, or remove it (null). */
  saveState(raw: string | null): Promise<void>;
  /** True when the provider accepted the mail. */
  send(subject: string, text: string): Promise<boolean>;
}

export interface CloudHeartbeatConfig {
  baseUrl: string;
  windowHours: number;
  minRuns: number;
  policy: AlertPolicy;
}

export interface CloudHeartbeatReport {
  result: 'ok' | 'finding' | 'could-not-look';
  dispatch: { canary: string; schedulerMonitor: string };
  halves?: HeartbeatFinding['half'][];
  alert?: string;
  alerted?: boolean;
  nextReminderAt?: string;
  why?: string;
  stateError?: string;
}

async function tryDispatch(github: GitHubPort, file: string): Promise<string> {
  try {
    await github.dispatch(file);
    return 'ok';
  } catch (e) {
    return `failed: ${(e as Error).message.slice(0, 200)}`;
  }
}

/**
 * The failure list, from its "N of M checks FAILED" line onward. Not the output's
 * tail: the 2026-10-21 drill mail, with every check failing, cut the first failure
 * mid-sentence. Capped from the END so the first failures are the ones kept.
 */
function failureDetail(output: string): string {
  const at = output.search(/^\d+ of \d+ checks FAILED/m);
  const from = (at >= 0 ? output.slice(at) : output).trim();
  return (from.length > 4000 ? `${from.slice(0, 4000)}\n  … (truncated)` : from) || 'canary failed with no output';
}

function productionFinding(output: string): HeartbeatFinding {
  return {
    half: 'production',
    key: productionKey(output),
    detail: failureDetail(output),
    consequence:
      'A behavioural check against production FAILED. This is the half that means customers ' +
      'are meeting a broken product right now.',
  };
}

async function deliveryFinding(deps: CloudHeartbeatDeps, cfg: CloudHeartbeatConfig): Promise<HeartbeatFinding | null> {
  const since = new Date(deps.now().getTime() - cfg.windowHours * 3600_000);
  const n = countRuns(await deps.github.listCanaryRuns(), DISPATCHABLE_COUNTED_EVENTS, since);
  if (n >= cfg.minRuns) return null;
  return {
    half: 'delivery',
    key: 'canary-runs-stopped',
    detail:
      `${n} canary run(s) in the last ${cfg.windowHours}h (need ≥ ${cfg.minRuns}; counted: ` +
      `${DISPATCHABLE_COUNTED_EVENTS.join(' + ')})`,
    consequence:
      'GitHub has stopped running the canary entirely — neither the cron nor the dispatcher ' +
      '(this Lambda) has produced a run. Production may be fine — but if it were not, nothing on ' +
      'GitHub would tell you. Check this function\'s dispatch results in its CloudWatch log first.',
  };
}

/** One tick. Never throws for a GitHub, state or mail failure — each is reported in the result. */
export async function cloudHeartbeat(deps: CloudHeartbeatDeps, cfg: CloudHeartbeatConfig): Promise<CloudHeartbeatReport> {
  const now = deps.now();
  const dispatch = {
    canary: await tryDispatch(deps.github, CANARY_FILE),
    schedulerMonitor: schedulerMonitorDue(now) ? await tryDispatch(deps.github, SCHEDULER_MONITOR_FILE) : 'skipped',
  };

  const findings: HeartbeatFinding[] = [];
  const prod = await deps.canary();
  if (!prod.ok) findings.push(productionFinding(prod.output));

  let couldNotLook: string | null = null;
  try {
    const delivery = await deliveryFinding(deps, cfg);
    if (delivery) findings.push(delivery);
  } catch (e) {
    couldNotLook = (e as Error).message.slice(0, 200);
  }

  if (couldNotLook && findings.length === 0) {
    return { result: 'could-not-look', dispatch, why: couldNotLook };
  }

  // The tick's store is synchronous; the S3 object is read before and written after.
  let initial: StateRead;
  try {
    const raw = await deps.loadState();
    initial = raw === null ? { kind: 'none' } : parseAlertState(raw);
  } catch (e) {
    initial = { kind: 'unreadable', why: `state load failed: ${(e as Error).message.slice(0, 120)}` };
  }
  let written: { next: AlertState | null } | null = null;
  const store: StateStore = {
    read: () => initial,
    write: (next) => {
      written = { next };
    },
  };

  const out = await alertTick(
    findings,
    { store, now: deps.now, send: deps.send },
    {
      baseUrl: cfg.baseUrl,
      policy: cfg.policy,
      unknownHalves: couldNotLook ? ['delivery'] : [],
      sentBy: 'the cloud heartbeat (AWS Lambda relay-heartbeat, account 461293170793)',
    },
  );

  let stateError = out.stateError;
  const pending = written as { next: AlertState | null } | null;
  if (pending) {
    try {
      await deps.saveState(pending.next === null ? null : serializeAlertState(pending.next));
    } catch (e) {
      stateError = `state save failed: ${(e as Error).message.slice(0, 120)}`;
    }
  }

  return {
    result: findings.length === 0 ? 'ok' : 'finding',
    dispatch,
    ...(findings.length ? { halves: findings.map((f) => f.half) } : {}),
    alert: out.kind,
    alerted: out.sent,
    ...(out.nextReminderAt ? { nextReminderAt: out.nextReminderAt } : {}),
    ...(couldNotLook ? { why: couldNotLook } : {}),
    ...(stateError ? { stateError } : {}),
  };
}
