/**
 * Every activity says whose it is, and §3.5 does not silently drop Claude's.
 *
 * 🔴 WHY, MEASURED 2026-08-31. The roadmap carries 123 rows with a `Court`
 * column across twenty tables, and the split was readable only by reading all
 * twenty. §3.5 renders it — but a rendering written by hand goes stale the way
 * every other hand-written number in this repository has, and this one goes
 * stale by OMISSION, which is the quiet kind: a Claude-court item that falls out
 * of the list is simply never done, and nothing says so.
 *
 * ⚠️ AND THE RENDERING HAD TO BE DRAWN TWICE. The first pass named 16 of the 19
 * open Claude-court rows. Three — C1.3, D12, D18 — were missing, and the section
 * looked complete without them. That is the exact failure this file prevents,
 * caught before the section shipped only because the completeness was checked
 * rather than eyeballed.
 *
 * Two rules, both narrow:
 *
 *   1. Every row with a `Court` column names a court. A row added without one is
 *      work nobody has been assigned, sitting in a plan that looks complete.
 *   2. §3.5 names every OPEN Claude-court id. Steve's and the co-pilot lists are
 *      rendered but not completeness-checked — they are larger, more volatile,
 *      and their omissions surface when he reads them. Claude's do not surface
 *      at all, which is why only that half is pinned.
 *
 * Feature: relay-h0-mvp
 * Requirements: §3.5
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const MD = readFileSync('ROADMAP.md', 'utf8');

interface Row {
  id: string;
  court: string;
  line: string;
}

/** Rows from every markdown table that has a `Court` column, wherever it sits. */
function courtRows(): Row[] {
  const cells = (l: string): string[] =>
    l.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
  const rows: Row[] = [];
  let hdr: string[] | null = null;
  let courtIdx = -1;
  let idIdx = 0;

  for (const line of MD.split('\n')) {
    if (!line.trim().startsWith('|')) {
      hdr = null;
      courtIdx = -1;
      continue;
    }
    if (/^\|[\s:|-]+\|$/.test(line.trim()) && hdr) {
      courtIdx = hdr.findIndex((h) => /court/i.test(h));
      idIdx = hdr.findIndex((h) => /^(id|#)$/i.test(h));
      if (idIdx < 0) idIdx = 0;
      continue;
    }
    if (courtIdx >= 0) {
      const c = cells(line);
      if (c.length > courtIdx) {
        rows.push({
          id: c[idIdx].replace(/[*~`]/g, '').split(' NEW')[0].trim(),
          court: c[courtIdx],
          line,
        });
      }
    } else {
      hdr = cells(line);
    }
  }
  return rows;
}

/** A row that carries a completion marker is not owed to anybody any more. */
const CLOSED = /✅|~~|\bCLOSED\b|\bDONE\b|\bdone\b/;

const KNOWN_COURT = /steve|claude|co-pilot|done|n\/a/i;

function section35(): string {
  const from = MD.indexOf('## 3.5.');
  const to = MD.indexOf('## 4. Dated');
  expect(from, 'ROADMAP.md has no §3.5 court section').toBeGreaterThan(-1);
  expect(to, 'ROADMAP.md has no §4 to bound §3.5').toBeGreaterThan(from);
  return MD.slice(from, to);
}

describe('the roadmap court split', () => {
  const rows = courtRows();

  it('finds court rows at all, so this guard is not vacuous', () => {
    // If the tables are restructured, this fails rather than passing on zero —
    // the blind-guard shape the rest of this directory uses.
    expect(rows.length, 'no rows with a Court column found in ROADMAP.md').toBeGreaterThan(80);
  });

  it('every OPEN activity says whose it is', () => {
    /*
      Closed rows are exempt, and that is not a loophole: `~~A4~~ · ~~A5~~` closed
      on 2026-08-20 and carries `—`, correctly — a finished row owes nobody a
      court. The first version of this test demanded one from every row and
      reported that closure as a defect, which is the false-positive shape this
      directory keeps recording: a guard that fires on the thing behaving exactly
      as intended is a guard people learn to switch off.
    */
    const orphans = rows.filter((r) => !CLOSED.test(r.line) && (!r.court || !KNOWN_COURT.test(r.court)));
    expect(
      orphans.map((r) => `${r.id} — court: "${r.court}"`),
      orphans.length
        ? 'These rows do not name a court:\n' +
            orphans.map((r) => `  ${r.id}  court: "${r.court}"`).join('\n') +
            '\n\nA row without a court is work nobody has been assigned, sitting in a plan that ' +
            'reads as complete. Name steve, claude, co-pilot, done or n/a — a split court ' +
            '("steve (ruling); claude (build)") is fine and is the commonest honest answer.'
        : 'ok',
    ).toEqual([]);
  });

  it('🔴 §3.5 names every OPEN Claude-court item', () => {
    /*
      The one that matters. Steve reads his own list and notices a gap; nothing
      reads Claude's, so an item dropped from it is never done and never missed.
      Completeness here is the difference between a plan and a snapshot.
    */
    const sec = section35();
    const open = rows.filter(
      (r) => !CLOSED.test(r.line) && /claude/i.test(r.court) && !/steve|co-pilot/i.test(r.court),
    );
    expect(open.length, 'no open Claude-court rows found — the filter has drifted').toBeGreaterThan(0);

    const missing = open.map((r) => r.id).filter((id) => !sec.includes(id));
    expect(
      missing,
      missing.length
        ? '§3.5 does not name these open Claude-court items:\n' +
            missing.map((id) => `  ${id}`).join('\n') +
            '\n\nEither add them to §3.5 or close the row in §2. A rendering that omits work is ' +
            'worse than no rendering: it is read as the complete list. The first draft of §3.5 ' +
            'missed C1.3, D12 and D18 and looked finished without them.'
        : 'ok',
    ).toEqual([]);
  });

  it('§3.5 still says it is a rendering, not an authority', () => {
    // The moment it reads as authoritative, it becomes a second source of truth
    // for the split — which is the failure the whole file argues against.
    const sec = section35();
    expect(sec).toMatch(/rendering/i);
    expect(sec).toMatch(/§2['’]s inventory and its `Court` column win/);
  });
});
