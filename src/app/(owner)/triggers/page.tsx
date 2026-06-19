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

const STATE_STYLE: Record<string, string> = {
  armed: 'bg-emerald-100 text-emerald-700',
  pending: 'bg-amber-100 text-amber-700',
  grace: 'bg-orange-100 text-orange-700',
  released: 'bg-red-100 text-red-700',
  cancelled: 'bg-slate-100 text-slate-600',
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
        <h1 className="text-2xl font-semibold tracking-tight">Triggers</h1>
        <p className="text-sm text-slate-500">Release state, check-in cadence, and (for demo accounts) the simulate control.</p>
      </header>

      {error ? <p className="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}

      {data ? (
        <>
          <CadenceForm current={data.checkinIntervalDays} onSaved={load} />
          {data.isDemo ? <SimulatePanel onDone={load} /> : null}

          <section className="space-y-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">Release states</h2>
            {data.releaseStates.length === 0 ? (
              <p className="text-sm text-slate-400">No triggers yet — create an access rule to provision one.</p>
            ) : null}
            {data.releaseStates.map((rs) => (
              <TriggerCard key={rs.id} rs={rs} onChange={load} />
            ))}
          </section>
        </>
      ) : (
        !error && <p className="text-sm text-slate-500">Loading…</p>
      )}
    </div>
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

  return (
    <form onSubmit={save} className="flex items-end gap-3 rounded border border-slate-200 bg-white p-4">
      <label className="text-sm">
        <span className="mb-1 block text-slate-600">Check-in interval (days)</span>
        <input
          type="number"
          min={1}
          max={365}
          value={days}
          onChange={(e) => setDays(e.target.value)}
          className="w-28 rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </label>
      <button type="submit" className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700">
        Save
      </button>
      {msg ? <span className="text-sm text-slate-500">{msg}</span> : null}
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
    <section className="rounded border border-amber-200 bg-amber-50 p-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-sm font-semibold text-amber-800">Simulate emergency (demo)</h2>
          <p className="text-xs text-amber-700">Fast-forwards ARMED → PENDING → GRACE → RELEASED in ~10s using the real state machine.</p>
        </div>
        <button
          onClick={run}
          disabled={progress !== null}
          className="rounded bg-amber-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-amber-700 disabled:opacity-60"
        >
          {progress !== null ? 'Running…' : 'Simulate'}
        </button>
      </div>
      {progress !== null ? (
        <div className="mt-3 h-2 overflow-hidden rounded bg-amber-200">
          <div className="h-full bg-amber-600 transition-all" style={{ width: `${progress}%` }} />
        </div>
      ) : null}
      {result ? <p className="mt-2 text-sm text-amber-800">{result}</p> : null}
    </section>
  );
}

function TriggerCard({ rs, onChange }: { rs: ReleaseState; onChange: () => Promise<void> }) {
  const reversible = rs.trigger_type !== 'estate';
  const [n, setN] = useState(String(rs.required_confirmations));
  const [msg, setMsg] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    setMsg(null);
    try {
      await fn();
      await onChange();
    } catch (err) {
      setMsg(String((err as Error).message));
    }
  };

  return (
    <div className="rounded border border-slate-200 bg-white p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-medium capitalize">{rs.trigger_type}</span>
          <span className={`rounded px-2 py-0.5 text-[11px] font-semibold uppercase ${STATE_STYLE[rs.state] ?? 'bg-slate-100 text-slate-600'}`}>
            {rs.state}
          </span>
          <span className="text-xs text-slate-500">
            {rs.received_confirmations}/{rs.required_confirmations} confirmations
          </span>
        </div>
        <div className="flex gap-2">
          {rs.state === 'armed' ? (
            <button
              onClick={() => act(() => apiSend(`/api/triggers/${encodeURIComponent(rs.trigger_type)}/initiate`, 'POST'))}
              className="rounded border border-slate-300 px-2.5 py-1 text-xs font-medium hover:bg-slate-100"
            >
              Initiate
            </button>
          ) : null}
          {rs.state === 'grace' && reversible ? (
            <button
              onClick={() => act(() => apiSend(`/api/triggers/${rs.id}/cancel`, 'POST'))}
              className="rounded border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="text-xs text-slate-600">Required confirmations (N):</span>
        <input
          type="number"
          min={1}
          value={n}
          onChange={(e) => setN(e.target.value)}
          className="w-16 rounded border border-slate-300 px-2 py-1 text-xs focus:border-blue-500 focus:outline-none"
        />
        <button
          onClick={() => act(() => apiSend(`/api/triggers/${encodeURIComponent(rs.trigger_type)}/config`, 'PUT', { required_confirmations: Number(n) }))}
          className="rounded border border-slate-300 px-2 py-1 text-xs font-medium hover:bg-slate-100"
        >
          Set
        </button>
        {msg ? <span className="text-xs text-red-600">{msg}</span> : null}
      </div>
    </div>
  );
}
