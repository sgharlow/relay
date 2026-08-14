/**
 * Requirement 12's gaps, on the screen the requirement names.
 *
 * 🔴 THE WHOLE AGENT WAS BUILT, TESTED, AND CALLED BY NOTHING. lib/ai/prioritize-agent.ts
 * detects gaps, ranks them by consequence, writes a plain-language explanation
 * for each and counts custody risks — and `runPrioritize` had zero production
 * callers, so the "Custody Risk" label the requirement names had never once been
 * shown to anybody.
 *
 * That is not a missing nicety. A CUSTODY_RISK is an irreplaceable item — a
 * deed, a will, a government ID — that either has nobody scoped to it or has no
 * note saying what it is for. Those are the items that cannot be regenerated
 * from a login, so an owner who never learns they are unreachable has a vault
 * that looks complete and loses precisely the things that cannot be replaced.
 *
 * ADVISORY, NEVER A GATE. Req 12.7 is explicit that no gap flag may block any
 * owner action, so this is a list with reasons and nothing else — no
 * disabled buttons, no interstitial, no nagging on other screens. The owner
 * decides; this only makes sure they are deciding with the information.
 *
 * Rendered from the server page so it costs no client bundle and needs no
 * endpoint — the requirement says "on vault load", which is where this runs.
 *
 * Feature: relay-h0-mvp
 * Requirements: 12.1, 12.3, 12.4, 12.7
 */

import type { Gap } from '../../../../lib/ai/prioritize-agent';

export function GapList({ gaps }: { gaps: Gap[] }) {
  if (gaps.length === 0) return null;

  const custody = gaps.filter((g) => g.gap_type === 'CUSTODY_RISK');
  const notes = gaps.filter((g) => g.gap_type !== 'CUSTODY_RISK');

  return (
    <section
      aria-label="Things worth a second look"
      style={{
        marginTop: 'var(--s6)',
        border: '1px solid var(--rule)',
        borderRadius: 'var(--radius-owner)',
        padding: 'var(--s4)',
        background: 'var(--paper-raised)',
      }}
    >
      <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600 }}>Worth a second look</h2>
      <p style={{ fontSize: 'var(--t2)', color: 'var(--ink-muted)', marginTop: 'var(--s1)' }}>
        Nothing here is broken and nothing is blocked — these are the items where a
        person stepping in would have the least to go on.
      </p>

      {custody.length > 0 ? (
        <div style={{ marginTop: 'var(--s4)' }}>
          {/*
            Ochre, not clay. This is in-motion-and-reversible — something the
            owner can fix in a minute — and clay is reserved for the permanent.
          */}
          <p style={{ fontSize: 'var(--t1)', fontWeight: 600, color: 'var(--ochre-text)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Custody Risk
          </p>
          <ul style={{ marginTop: 'var(--s2)' }}>
            {custody.map((g) => (
              <li key={g.vault_item_id} style={{ marginTop: 'var(--s2)', fontSize: 'var(--t2)' }}>
                <span style={{ fontWeight: 600 }}>{g.title}</span>
                <span style={{ color: 'var(--ink-muted)' }}> — {g.consequence}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {notes.length > 0 ? (
        <ul style={{ marginTop: 'var(--s4)' }}>
          {notes.map((g) => (
            <li key={g.vault_item_id} style={{ marginTop: 'var(--s2)', fontSize: 'var(--t2)' }}>
              <span style={{ fontWeight: 600 }}>{g.title}</span>
              <span style={{ color: 'var(--ink-muted)' }}> — {g.consequence}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}
