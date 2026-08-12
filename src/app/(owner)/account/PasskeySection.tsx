'use client';

/**
 * Add a passkey — stage two of the two-stage claim ([A1]).
 *
 * Stage one bound a device and is enough to be reachable today. This is what
 * lets someone come back on a NEW device without the owner reissuing anything,
 * and it is the only thing standing between a lost phone and a break-glass code.
 *
 * Deferrable by design: nothing in the claim flow blocks on it, because the
 * architecture's whole bet is claim conversion and the first thing a contact
 * meets must not be a security ceremony.
 *
 * Feature: relay-standby
 * Requirements: J4-R9, J4-R11
 */

import { useAddPasskey } from '../../../hooks/useAddPasskey';

export default function PasskeySection() {
  // Shared with the standby dashboard so the two surfaces cannot drift on what
  // an error means — notably `InvalidStateError`, which this page used to
  // report as a device failure when it in fact means "already protected".
  const { outcome, add } = useAddPasskey();
  const done = outcome.kind === 'added' || outcome.kind === 'already';

  return (
    <section className="rounded border border-rule bg-paper-raised p-5">
      <h2 className="text-t5 font-semibold text-ink">Passkey</h2>
      <p className="mt-1 text-t2 text-muted">
        Sign in with your face, fingerprint or device PIN — no code to find, and nothing we could
        email you that a stranger could imitate. Adding one also means a new phone does not lock you
        out.
      </p>

      {done ? (
        <p className="mt-3 text-t2 text-ink">
          {outcome.kind === 'already'
            ? 'This device already has a passkey for your account — you can use it to sign in.'
            : 'Passkey added. You can use it to sign in.'}
        </p>
      ) : (
        <button
          type="button"
          onClick={add}
          disabled={outcome.kind === 'busy'}
          className="mt-3 min-h-[44px] rounded border border-ink bg-ink px-4 text-t2 font-semibold text-paper disabled:opacity-60"
        >
          {outcome.kind === 'busy' ? 'Waiting for your device…' : 'Add a passkey'}
        </button>
      )}

      {outcome.kind === 'error' ? (
        <p role="alert" className="mt-3 text-t2 text-clay">
          {outcome.message}
        </p>
      ) : null}
    </section>
  );
}
