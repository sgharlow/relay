'use client';

/**
 * The one-line result message beside a control on the Triggers screen.
 *
 * 🔴 IT EXISTS BECAUSE THE COLOUR DID NOT KEY ON THE MESSAGE, found 2026-08-21.
 * The check-in control set `msg` to a success sentence on success and to the
 * thrown error's text on failure, then painted both with `text-sage-text` —
 * sage being the colour this product reserves, deliberately and everywhere
 * else, for "closed, safe". An owner whose check-in 401'd after a session
 * expiry saw "Request failed (401)" in the reassuring colour, next to the most
 * time-critical button in the product, at the moment they were trying to stop
 * a release.
 *
 * This is the same defect CircleClient.tsx records at its own colour rule — a
 * false green in the palette rather than in the words — and neither DOM
 * measurement nor a type-check can see it, because the markup is valid either
 * way. So the tone travels WITH the message instead of being chosen at the
 * render site, which is where the two came apart.
 *
 * Feature: relay-h0-mvp
 * Requirements: 4.1
 */

export interface StatusMessage {
  text: string;
  /** False ⇒ this is a failure and must never wear the safe colour. */
  ok: boolean;
}

/*
  Every class is written out in full rather than interpolated. Tailwind's
  scanner reads source text, so `text-${size}` produces a class that exists in
  the DOM and in no stylesheet — an invisible sentence instead of a wrong
  colour, which is worse.
*/
export function StatusLine({ msg, size = 't2' }: { msg: StatusMessage | null; size?: 't1' | 't2' }) {
  if (!msg) return null;
  const scale = size === 't1' ? 'text-t1' : 'text-t2';
  const tone = msg.ok ? 'text-sage-text' : 'text-clay';
  return <span className={`${scale} ${tone}`}>{msg.text}</span>;
}

export default StatusLine;
