/**
 * Guards on the comparison matrix.
 *
 * Every competitor cell is a public claim about someone else's product, on a
 * page ad reviewers read. These tests do not check that the claims are TRUE —
 * only a human with the vendor's documentation can do that — they check that
 * the table keeps the shape that makes it honest, so nobody quietly turns it
 * into a sales sheet later.
 *
 * The rule that matters most is the last one: the rows Relay loses must stay.
 * They are the reason the rest is believable, and they are exactly what a
 * future edit would be tempted to remove.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';

import { COLUMNS, ROWS, CELL_MARK, VERIFIED_ON } from './comparison';

describe('table integrity', () => {
  it('every row has a verdict for every column — no silent blanks', () => {
    for (const row of ROWS) {
      for (const col of COLUMNS) {
        expect(row.cells[col.key], `${row.question} × ${col.label}`).toBeDefined();
      }
    }
  });

  it('has no columns a row does not know about', () => {
    const keys = new Set(COLUMNS.map((c) => c.key));
    for (const row of ROWS) {
      for (const k of Object.keys(row.cells)) expect(keys.has(k)).toBe(true);
    }
  });

  it('compares four alternatives plus Relay', () => {
    expect(COLUMNS[0].key).toBe('relay');
    expect(COLUMNS).toHaveLength(5);
  });
});

describe('honesty guards', () => {
  it('KEEPS rows where Relay loses — this is the whole credibility of the table', () => {
    const losses = ROWS.filter((r) => r.relayLoses);
    expect(losses.length).toBeGreaterThanOrEqual(3);
  });

  it('every declared loss actually shows Relay not winning', () => {
    for (const row of ROWS.filter((r) => r.relayLoses)) {
      expect(row.cells.relay, row.question).not.toBe('yes');
    }
  });

  it('names a competitor as better at something, in words', () => {
    // A table can be technically honest and still read as a hit piece. At least
    // one note must say plainly that another product is the right choice.
    const notes = ROWS.map((r) => r.note ?? '').join(' ');
    expect(notes).toMatch(/genuinely better|start there|real reason to choose/i);
  });

  it('distinguishes "not offered" from "we do not know"', () => {
    // Collapsing unknown into a cross would be the easiest way to make a
    // competitor look worse than the evidence supports.
    expect(CELL_MARK.unknown.label).toBe('Not published');
    expect(CELL_MARK.no.label).toBe('No');
    expect(CELL_MARK.unknown.mark).not.toBe(CELL_MARK.no.mark);
    expect(ROWS.some((r) => Object.values(r.cells).includes('unknown'))).toBe(true);
  });

  it('carries a verification date, because these facts go stale', () => {
    expect(VERIFIED_ON).toMatch(/\d{4}/);
  });
});

describe('claims that were corrected on 2026-08-08', () => {
  it('does not describe Bitwarden Emergency Access as free', () => {
    // docs/COMPETITORS.md called it "the most credible free rival". It is
    // Premium-only. That error would have shipped onto a public page.
    const col = COLUMNS.find((c) => c.key === 'pwmgr');
    expect(col?.sublabel).toMatch(/Premium/i);
    expect(col?.sublabel).not.toMatch(/free/i);
  });

  it('does not credit 1Password with emergency access it does not offer', () => {
    // Its "Emergency Kit" is a printed PDF of your own credentials — not a
    // trusted-contact release flow. The source doc conflated the two.
    const all = JSON.stringify(COLUMNS) + JSON.stringify(ROWS);
    expect(all).not.toMatch(/1Password/i);
  });

  it('credits Bitwarden only with a timer, not with verification', () => {
    const row = ROWS.find((r) => /confirm the situation is real/i.test(r.question));
    expect(row?.cells.pwmgr).toBe('partial');
    expect(row?.note).toMatch(/waiting period/i);
  });

  it('states the Apple limitation as death-only, which is the load-bearing row', () => {
    const row = ROWS.find((r) => /alive but cannot manage/i.test(r.question));
    expect(row?.cells.platform).toBe('no');
    expect(row?.note).toMatch(/death certificate/i);
  });
});

describe('scope discipline', () => {
  it('never markets estate — withdrawn permanently, and the terms page says so', () => {
    const all = (JSON.stringify(ROWS) + JSON.stringify(COLUMNS)).toLowerCase();
    expect(all).not.toContain('estate');
    expect(all).not.toContain('inheritance');
    expect(all).not.toContain('will ');
  });
});
