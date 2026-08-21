/**
 * The colour must key on the message, not on the render site.
 *
 * 🔴 THE DEFECT THIS PINS. `CheckInButton` stored the thrown error's text in the
 * same `msg` slot as its success sentence and painted the span
 * `text-t2 text-sage-text` unconditionally. Sage is this product's colour for
 * "closed, safe" — so "Request failed (401)" arrived in the reassuring colour,
 * beside the control an owner presses to stop a release. The markup was valid,
 * the types were fine, and no DOM measurement could see it: the same false-green
 * shape CircleClient.tsx records in its own colour rule.
 *
 * Rendered rather than grepped, because the question is what reaches the DOM.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { readFileSync } from 'node:fs';

import { StatusLine } from './StatusLine';

describe('StatusLine', () => {
  it('paints a success in the safe colour', () => {
    const out = renderToStaticMarkup(<StatusLine msg={{ text: 'Checked in.', ok: true }} />);
    expect(out).toContain('text-sage-text');
    expect(out).toContain('Checked in.');
  });

  it('NEVER paints a failure in the safe colour', () => {
    const out = renderToStaticMarkup(
      <StatusLine msg={{ text: 'Request failed (401)', ok: false }} />,
    );
    expect(out).not.toContain('sage');
    expect(out).toContain('text-clay');
  });

  it('renders nothing at all when there is no message', () => {
    expect(renderToStaticMarkup(<StatusLine msg={null} />)).toBe('');
  });

  /*
    A class Tailwind's scanner cannot see is an INVISIBLE sentence — worse than
    a wrong colour, and it would pass every assertion above if they only looked
    for the tone. So the size class is asserted too.
  */
  it('emits a literal size class in both sizes', () => {
    expect(renderToStaticMarkup(<StatusLine msg={{ text: 'x', ok: true }} />)).toContain('text-t2');
    expect(
      renderToStaticMarkup(<StatusLine msg={{ text: 'x', ok: true }} size="t1" />),
    ).toContain('text-t1');
  });
});

describe('the Triggers screen routes its messages through it', () => {
  /*
    The component being correct proves nothing if a call site keeps its own
    hard-coded colour. This is the assertion that would have failed before the
    fix, and the one that fails if somebody reintroduces the pattern.
  */
  it('no message span on the Triggers screen hard-codes the safe colour', () => {
    const src = readFileSync('src/app/(owner)/triggers/TriggersPageClient.tsx', 'utf8')
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/\/\/[^\n]*/g, '');

    expect(src).not.toMatch(/\{msg \? <span/);
    expect(src).toContain('<StatusLine');
  });
});
