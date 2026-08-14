'use client';

/**
 * What this is, and what it is not — the statement a recipient reads before the
 * plan, and the slim reminder that stays afterwards.
 *
 * Gate `g2-counsel-opinion` was DECLINED on 2026-08-14 (PROJECT.yaml). No
 * written opinion is coming, and questions 4 and 5 of the counsel brief — what
 * Relay's exposure is for facilitating a recipient's login to a third party, and
 * whether that changes once the owner has died — are recorded as accepted open
 * risk. This is a named part of what was done instead.
 *
 * WRITTEN FOR SOMEBODY IN THE WORST WEEK OF THEIR LIFE. It has to be honest
 * without being frightening, and short enough to actually be read. It does not
 * threaten, it does not hedge, and it never suggests the reader is doing
 * something wrong — most of them are a daughter with her mother's permission.
 * What it does is refuse to let the product imply an authority it cannot confer.
 *
 * ⚠️ IT MUST NOT LOCK ANYBODY OUT. The acknowledgement is recorded server-side,
 * and a failed write lets the reader through anyway — they are re-asked on the
 * next load. Someone standing in a hospital corridor must never be held at a
 * disclosure because the database blinked; the statement's purpose is to inform,
 * and an unrecorded reading still informed them.
 *
 * Feature: relay-h0-mvp
 */

import { useState } from 'react';

export function LimitsNotice({
  ownerLabel,
  token,
  onAcknowledged,
}: {
  ownerLabel: string;
  /** Present for an unclaimed recipient; a claimed one resolves by session. */
  token?: string;
  onAcknowledged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function acknowledge() {
    setBusy(true);
    try {
      await fetch(`/api/access/acknowledge${token ? `?token=${encodeURIComponent(token)}` : ''}`, {
        method: 'POST',
      });
    } catch {
      // Deliberately swallowed — see the header. They will be asked again.
    } finally {
      // Continues whether or not the record was written.
      onAcknowledged();
    }
  }

  return (
    <section
      aria-labelledby="limits-heading"
      className="rounded-lg border border-rule bg-paper-raised px-6 py-6"
    >
      <h1 id="limits-heading" className="text-t6 font-semibold">
        What this is, and what it is not
      </h1>

      <p className="mt-4">
        {ownerLabel} chose to share these items with you, and set the conditions that opened them.
        That is all this is.
      </p>

      <p className="mt-3">
        Relay does not give you legal authority. It does not make you an executor, an agent, or a
        representative, and the companies behind these accounts have agreed to nothing. Using
        someone else&rsquo;s credentials may breach the terms of that account whatever your reason
        &mdash; that is between you and them.
      </p>

      <p className="mt-3">
        <strong>If {ownerLabel} has died</strong>, the person with authority is their executor or
        personal representative. Speak to them before you use anything here.
      </p>

      <button
        type="button"
        onClick={acknowledge}
        disabled={busy}
        className="mt-6 min-h-12 rounded bg-ink px-6 text-t3 font-semibold text-paper disabled:opacity-60"
      >
        {busy ? 'One moment…' : 'I understand — show me the plan'}
      </button>
    </section>
  );
}

/**
 * The line that stays.
 *
 * The one-time statement is what gets acknowledged; this is what a person sees
 * on every later visit, because the limits do not stop applying once they have
 * been read.
 */
export function LimitsReminder({ ownerLabel }: { ownerLabel: string }) {
  return (
    <p className="mt-2 text-t2 text-muted">
      {ownerLabel} chose to share these with you. Relay gives you access, not legal authority.
    </p>
  );
}
