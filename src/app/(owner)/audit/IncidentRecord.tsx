'use client';

/**
 * "What happened while you were away" (§8.2).
 *
 * `how-it-works` promises customers *"Margaret gets a record of exactly what was
 * opened while she was away."* The only surface was the hash-chained table below
 * this one, which answers a different question — is the log intact — and none of
 * the questions somebody actually has when they get home.
 *
 * ABOVE THE TABLE, NOT INSTEAD OF IT. The chain is the proof and stays exactly as
 * it was; this is a reading of it. Somebody who wants to verify hashes still can,
 * and somebody who wants to know what their son opened no longer has to.
 *
 * The quiet state is the common one and is treated as the design centre: most
 * owners will open this page having had no emergency at all, and telling them
 * that plainly is worth more than an empty table.
 *
 * Feature: relay-standby
 * Requirements: 8.6, J9-R4
 */

import { useEffect, useState } from 'react';

interface Incident {
  startedAt: string;
  endedAt: string | null;
  opened: { title: string; at: string }[];
  confirmedBy: string[];
  closedByOwner: boolean;
  summary: string;
}

export default function IncidentRecord() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);

  useEffect(() => {
    fetch('/api/audit/incidents')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setIncidents(d?.incidents ?? []))
      .catch(() => setIncidents([]));
  }, []);

  if (incidents === null) return null;

  if (incidents.length === 0) {
    return (
      <div
        className="mb-6 rounded border border-rule bg-paper-raised px-4 py-3"
        style={{ fontSize: 'var(--t2)' }}
      >
        <p style={{ fontWeight: 600 }}>Nothing has ever been opened.</p>
        <p style={{ color: 'var(--ink-muted)', marginTop: 4 }}>
          No emergency has been raised on your vault. If one ever is, what happened will be written
          here in plain words — who confirmed it, what was opened, and when it closed again.
        </p>
      </div>
    );
  }

  return (
    <section className="mb-6">
      <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600, marginBottom: 'var(--s2)' }}>
        What happened
      </h2>
      <div className="space-y-3">
        {incidents.map((i) => (
          <div
            key={i.startedAt}
            className="rounded border px-4 py-3"
            style={{
              // An episode still open is the one thing on this page that needs
              // attention; a closed one is reassurance and should look calm.
              borderColor: i.endedAt ? 'var(--rule)' : 'var(--ochre)',
              background: i.endedAt ? 'var(--paper-raised)' : 'var(--ochre-soft)',
            }}
          >
            <p style={{ fontSize: 'var(--t3)', lineHeight: 1.5 }}>{i.summary}</p>

            {i.opened.length > 0 ? (
              <ul className="mt-2 space-y-1">
                {i.opened.map((o) => (
                  <li key={o.title} style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)' }}>
                    {o.title} — opened {new Date(o.at).toLocaleString()}
                  </li>
                ))}
              </ul>
            ) : null}

            {i.endedAt ? (
              <p style={{ fontSize: 'var(--t1)', color: 'var(--ink-muted)', marginTop: 'var(--s2)' }}>
                Closed {new Date(i.endedAt).toLocaleString()}
                {i.closedByOwner ? ' — because you checked back in.' : '.'} Nothing else was
                reachable, and nothing stayed open.
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
