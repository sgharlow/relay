'use client';

/**
 * Did a real person confirm they can be reached?
 *
 * THE ONLY LINE ON THIS SCREEN THAT IS EVIDENCE ABOUT A HUMAN. DeliveryLine
 * reports what a mail provider said about its own queue — and both messages in
 * the 2026-08-14 Outlook test recorded `delivered` while sitting in a junk
 * folder. A drill acknowledgement was pressed by a person who had to sign in to
 * press it, which is the one reachability signal a junked message cannot fake.
 *
 * The judgement lives in `lib/release/fire-drill.ts` (`describeDrill`), including
 * the rules that a fresh drill is not yet a failure and that an old
 * acknowledgement cannot vouch for a new drill. This file is only the paint.
 *
 * Feature: relay-standby
 */

/*
  From `drill-claim`, NOT from `fire-drill`. This is a client component, and
  `fire-drill.ts` reaches the database — importing the sentence from there put
  `pg` in the browser bundle and broke the build on `dns`/`fs`/`net`/`tls`.
*/
import { describeDrill, type DrillState } from '../../../../lib/release/drill-claim';

export default function DrillLine({ name, drill }: { name: string; drill?: DrillState | null }) {
  const line = describeDrill(name, drill);
  if (!line) return null;

  return (
    <div
      style={{
        fontSize: 'var(--t1)',
        color: line.tone === 'warn' ? 'var(--ochre-text)' : 'var(--ink-muted)',
        marginTop: '4px',
      }}
    >
      {line.text}
    </div>
  );
}
