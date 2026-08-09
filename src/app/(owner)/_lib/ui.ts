/**
 * Owner-mode primitives, drawn from the tokens in globals.css.
 *
 * The audit's finding was that no system existed, so every screen invented its
 * own sizes and colours. A token file alone does not fix that — it just moves
 * the invention one level down. These are the handful of shapes owner mode
 * actually uses, so a page composes rather than decides.
 *
 * Deliberately small. The direction's test is that the whole system is "small
 * enough that nobody has to look it up twice"; a primitives file that grows past
 * a screenful has stopped being a system and become a component library.
 *
 * Feature: relay-h0-mvp
 */

import type { CSSProperties } from 'react';

/** A surface sitting on paper. */
export const card: CSSProperties = {
  border: '1px solid var(--rule)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--paper-raised)',
};

export const cardPadded: CSSProperties = { ...card, padding: 'var(--s4)' };

/** A well — table headers, code, anything recessed. */
export const sunken: CSSProperties = {
  borderRadius: 'var(--radius-owner)',
  background: 'var(--paper-sunken)',
};

export const input: CSSProperties = {
  width: '100%',
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--t3)',
  padding: 'var(--s2) var(--s3)',
  border: '1px solid var(--rule-strong)',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--paper-raised)',
  color: 'var(--ink)',
};

/** Ink. A primary action is not decoration, so it does not get an accent. */
export const buttonPrimary: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--t3)',
  fontWeight: 600,
  padding: 'var(--s2) var(--s4)',
  minHeight: '44px',
  borderRadius: 'var(--radius-owner)',
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};

export const buttonQuiet: CSSProperties = {
  fontFamily: 'var(--font-ui)',
  fontSize: 'var(--t3)',
  padding: 'var(--s2) var(--s4)',
  minHeight: '44px',
  borderRadius: 'var(--radius-owner)',
  background: 'transparent',
  color: 'var(--ink)',
  border: '1px solid var(--rule-strong)',
  cursor: 'pointer',
};

/**
 * Clay, and only ever for something that cannot be taken back. If it starts
 * appearing on ordinary destructive-ish actions it stops meaning anything, and
 * the estate handoff loses the one signal that marks it.
 */
export const buttonPermanent: CSSProperties = {
  ...buttonPrimary,
  background: 'var(--clay)',
  border: '1px solid var(--clay)',
};

export const h1: CSSProperties = {
  fontSize: 'var(--t7)',
  fontWeight: 600,
  letterSpacing: '-0.02em',
  textWrap: 'balance',
};

export const h2: CSSProperties = {
  fontSize: 'var(--t5)',
  fontWeight: 600,
  letterSpacing: '-0.01em',
};

export const muted: CSSProperties = { fontSize: 'var(--t2)', color: 'var(--ink-muted)' };
export const meta: CSSProperties = { fontSize: 'var(--t1)', color: 'var(--ink-faint)' };

/** Errors are ordinary information, not an alarm — but they are not decoration either. */
export const errorText: CSSProperties = { fontSize: 'var(--t2)', color: 'var(--clay)' };

export const mono: CSSProperties = {
  fontFamily: 'ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace',
  fontSize: 'var(--t1)',
};
