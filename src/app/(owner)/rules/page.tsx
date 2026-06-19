'use client';

/**
 * Access-rules screen (Requirement 3.3–3.5 / task 12.3).
 *
 * Lists rules and provides a rule builder: vault item + recipient selectors,
 * trigger-type, scope toggle, and a reversible checkbox that is forced off and
 * disabled for estate triggers (estate rules must be irreversible — Property 7).
 * Inline validation errors come from the API.
 *
 * NOTE: N-of-M (`required_confirmations`) is configured per trigger on the
 * Triggers screen (it lives on release_state, not the rule). Creating a rule
 * provisions the trigger's release_state with the default 1-of-M.
 *
 * Feature: relay-h0-mvp
 */

import { useCallback, useEffect, useState } from 'react';
import {
  VALID_TRIGGER_TYPES,
  VALID_SCOPES,
  type TriggerType,
  type Scope,
} from '../../../../lib/domain/enums';
import { apiGet, apiSend } from '../_lib/api';

interface Rule {
  id: string;
  vault_item_id: string;
  recipient_id: string;
  trigger_type: TriggerType;
  scope: Scope;
  reversible: boolean;
  release_after_days: number | null;
}
interface Named {
  id: string;
  title?: string;
  name?: string;
}

const inputCls =
  'rounded border border-slate-300 px-2.5 py-1.5 text-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500';

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[]>([]);
  const [items, setItems] = useState<Named[]>([]);
  const [recipients, setRecipients] = useState<Named[]>([]);

  const load = useCallback(async () => {
    const [r, i, rec] = await Promise.all([
      apiGet<{ rules: Rule[] }>('/api/rules'),
      apiGet<{ items: Named[] }>('/api/vault/items'),
      apiGet<{ recipients: Named[] }>('/api/recipients'),
    ]);
    setRules(r.rules);
    setItems(i.items);
    setRecipients(rec.recipients);
  }, []);

  useEffect(() => {
    load().catch(() => {});
  }, [load]);

  const itemName = (id: string) => items.find((x) => x.id === id)?.title ?? id.slice(0, 8);
  const recipientName = (id: string) => recipients.find((x) => x.id === id)?.name ?? id.slice(0, 8);

  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Access Rules</h1>
        <p className="text-sm text-slate-500">Grant a recipient scoped access to an item under a trigger.</p>
      </header>

      <ul className="divide-y divide-slate-100 rounded border border-slate-200 bg-white">
        {rules.length === 0 ? <li className="px-4 py-3 text-sm text-slate-400">No rules yet.</li> : null}
        {rules.map((rule) => (
          <li key={rule.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
            <div>
              <span className="font-medium">{itemName(rule.vault_item_id)}</span>
              <span className="text-slate-400"> → </span>
              <span>{recipientName(rule.recipient_id)}</span>
              <div className="text-xs text-slate-500">
                {rule.trigger_type} · {rule.scope} · {rule.reversible ? 'reversible' : 'irreversible'}
              </div>
            </div>
            <button onClick={() => apiSend(`/api/rules/${rule.id}`, 'DELETE').then(load).catch(() => {})} className="text-xs text-red-600 hover:underline">
              Remove
            </button>
          </li>
        ))}
      </ul>

      <RuleBuilder items={items} recipients={recipients} onCreated={load} />
    </div>
  );
}

function RuleBuilder({ items, recipients, onCreated }: { items: Named[]; recipients: Named[]; onCreated: () => Promise<void> }) {
  const [form, setForm] = useState({
    vault_item_id: '',
    recipient_id: '',
    trigger_type: 'emergency' as TriggerType,
    scope: 'view' as Scope,
    reversible: true,
    release_after_days: '',
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const estate = form.trigger_type === 'estate';

  function setTrigger(trigger_type: TriggerType) {
    // Estate rules must be irreversible (Property 7) — force + lock the checkbox.
    setForm((f) => ({ ...f, trigger_type, reversible: trigger_type === 'estate' ? false : f.reversible }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!form.vault_item_id || !form.recipient_id) {
      setError('Choose a vault item and a recipient.');
      return;
    }
    setBusy(true);
    try {
      await apiSend('/api/rules', 'POST', {
        vault_item_id: form.vault_item_id,
        recipient_id: form.recipient_id,
        trigger_type: form.trigger_type,
        scope: form.scope,
        reversible: form.reversible,
        release_after_days: form.release_after_days ? Number(form.release_after_days) : undefined,
      });
      setForm({ ...form, vault_item_id: '', recipient_id: '', release_after_days: '' });
      await onCreated();
    } catch (err) {
      setError(String((err as Error).message));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded border border-slate-200 bg-white p-4">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-400">New rule</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Vault item</span>
          <select className={`${inputCls} w-full`} value={form.vault_item_id} onChange={(e) => setForm({ ...form, vault_item_id: e.target.value })}>
            <option value="">Select an item…</option>
            {items.map((i) => (
              <option key={i.id} value={i.id}>
                {i.title ?? i.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Recipient</span>
          <select className={`${inputCls} w-full`} value={form.recipient_id} onChange={(e) => setForm({ ...form, recipient_id: e.target.value })}>
            <option value="">Select a recipient…</option>
            {recipients.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name ?? r.id}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Trigger type</span>
          <select className={`${inputCls} w-full`} value={form.trigger_type} onChange={(e) => setTrigger(e.target.value as TriggerType)}>
            {VALID_TRIGGER_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-slate-600">Scope</span>
          <select className={`${inputCls} w-full`} value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value as Scope })}>
            {VALID_SCOPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="flex items-center gap-4">
        <label
          className={`flex items-center gap-2 text-sm ${estate ? 'text-slate-400' : 'text-slate-700'}`}
          title={estate ? 'Estate rules must be irreversible' : 'Reversible: access closes again if you recover'}
        >
          <input type="checkbox" checked={estate ? false : form.reversible} disabled={estate} onChange={(e) => setForm({ ...form, reversible: e.target.checked })} />
          Reversible
          {estate ? <span className="text-xs">(estate is always irreversible)</span> : null}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          Release after
          <input className={`${inputCls} w-20`} type="number" min={0} placeholder="0" value={form.release_after_days} onChange={(e) => setForm({ ...form, release_after_days: e.target.value })} />
          days
        </label>
      </div>

      {error ? <p role="alert" className="text-sm text-red-600">{error}</p> : null}
      <button type="submit" disabled={busy} className="rounded bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-60">
        Add rule
      </button>
    </form>
  );
}
