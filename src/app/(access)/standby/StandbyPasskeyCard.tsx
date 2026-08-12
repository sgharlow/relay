'use client';

/**
 * Stage two of the claim, on the surface where the people it is for actually are.
 *
 * THE GAP THIS CLOSES, found by testing on production 2026-08-12: the passkey
 * ceremony worked end to end — register, sign out, sign back in with no
 * identifier typed — but the only place to enrol one was /account, inside the
 * OWNER shell. A standby contact who found it was dropped into a vault
 * dashboard: a sidebar of Vault / Import / Rules / Triggers / Approvals and a
 * readiness banner telling them their vault was empty and nobody was named to
 * receive access. None of that is true of them. So [A1]'s "offered afterwards,
 * deferrable" had no afterwards, and the one path onto a new device that does
 * not need the owner to reissue anything was unreachable for its intended user.
 *
 * DEFERRABLE, AND IT HAS TO LOOK IT. The architecture bets on claim conversion,
 * so this cannot read as a demand or a wall. It is a card below the fold with no
 * badge, no count, no nag — it states what it buys them (a new phone does not
 * lock you out) and it disappears once they have one. Someone who never touches
 * it stays exactly as reachable as before; the fallbacks underneath are the
 * reason that is acceptable.
 *
 * Access mode, deliberately: 17-18px, warm, 48px targets. Read by someone who
 * may be having the worst week of their life.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { useAddPasskey } from '../../../hooks/useAddPasskey';

export default function StandbyPasskeyCard() {
  const { outcome, add } = useAddPasskey();

  if (outcome.kind === 'added' || outcome.kind === 'already') {
    return (
      <section
        style={{
          marginTop: 32,
          padding: 20,
          borderRadius: 10,
          border: '1px solid #e4ded4',
          background: '#fffdf9',
        }}
      >
        <h2 style={{ fontSize: 19, fontWeight: 600 }}>This device is set up</h2>
        <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 8, color: '#6b6257' }}>
          {outcome.kind === 'already'
            ? 'You had already done this. Nothing more is needed.'
            : 'Next time, sign in with your face, fingerprint or device PIN.'}
        </p>
      </section>
    );
  }

  return (
    <section
      style={{
        marginTop: 32,
        padding: 20,
        borderRadius: 10,
        border: '1px solid #e4ded4',
        background: '#fffdf9',
      }}
    >
      <h2 style={{ fontSize: 19, fontWeight: 600 }}>Make sure you can get back in</h2>
      <p style={{ fontSize: 17, lineHeight: 1.6, marginTop: 8, color: '#6b6257' }}>
        Set up your face, fingerprint or device PIN for this account. Then a new phone will not lock
        you out, and there is no code to keep somewhere — nothing we could send you that a stranger
        could imitate. You can do this later.
      </p>

      <button
        type="button"
        onClick={add}
        disabled={outcome.kind === 'busy'}
        style={{
          marginTop: 14,
          minHeight: 48,
          padding: '0 20px',
          borderRadius: 6,
          border: '1px solid #211d18',
          background: '#fffdf9',
          color: '#211d18',
          fontSize: 17,
          fontWeight: 600,
          cursor: outcome.kind === 'busy' ? 'default' : 'pointer',
          opacity: outcome.kind === 'busy' ? 0.6 : 1,
        }}
      >
        {outcome.kind === 'busy' ? 'Waiting for your device…' : 'Set this up'}
      </button>

      {outcome.kind === 'error' ? (
        <p role="alert" style={{ fontSize: 16, marginTop: 12, color: '#9a3412' }}>
          {outcome.message}
        </p>
      ) : null}
    </section>
  );
}
