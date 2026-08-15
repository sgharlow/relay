'use client';

/**
 * "You are helping X set up their vault" — the only way a helper finds out.
 *
 * Nothing told them. An owner could appoint somebody and record consent, and
 * the person on the other end had no screen, no message and no route they could
 * have guessed (reassessment, 2026-08-12).
 *
 * Fetches independently rather than widening `/api/standby`, so a helper whose
 * roster row was later revoked still sees this: the two relationships are
 * separate facts and one ending does not end the other.
 *
 * Renders nothing when there is nothing to say — a person standing by for a
 * parent should not carry a permanent empty box about a job they do not have.
 *
 * Feature: relay-caregiver
 * Requirements: J3-R1, J3-R9
 */

import { useEffect, useState } from 'react';

export default function HelpingCard() {
  const [vaults, setVaults] = useState<{ ownerLabel: string }[]>([]);

  useEffect(() => {
    fetch('/api/helping')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVaults(d?.vaults ?? []))
      .catch(() => setVaults([]));
  }, []);

  if (vaults.length === 0) return null;

  const who =
    vaults.length === 1
      ? vaults[0].ownerLabel
      : `${vaults.slice(0, -1).map((v) => v.ownerLabel).join(', ')} and ${vaults.at(-1)?.ownerLabel}`;

  return (
    <section
      style={{
        marginTop: 24,
        padding: 20,
        borderRadius: 10,
        border: '1px solid #e4ded4',
        background: '#fffdf9',
      }}
    >
      <h2 style={{ fontSize: 'var(--t5)', fontWeight: 600 }}>You are helping {who} set up</h2>
      <p style={{ fontSize: 'var(--t4)', lineHeight: 1.6, marginTop: 8 }}>
        You can add things to their vault and suggest people. You cannot open anything, and anything
        that decides who can reach what goes to them as a question.
      </p>
      <a
        href="/helping"
        style={{
          display: 'inline-block',
          marginTop: 12,
          minHeight: 44,
          padding: '11px 18px',
          fontSize: 'var(--t4)',
          fontWeight: 600,
          color: '#211d18',
          border: '1px solid #cfc7ba',
          borderRadius: 8,
          textDecoration: 'none',
        }}
      >
        Open their setup
      </a>
    </section>
  );
}
