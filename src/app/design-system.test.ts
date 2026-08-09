/**
 * The design system is the only palette.
 *
 * The audit's central finding was that no system existed, so every screen
 * invented its own greys and sizes — fourteen shades of slate, eight H1 values,
 * and links at 4.24:1 on an audience that skews older. Migrating the app fixed
 * that once. This keeps it fixed.
 *
 * A raw Tailwind palette class is not a style mistake so much as a decision made
 * without the system: `text-slate-500` is somebody choosing a grey, and the next
 * person choosing a slightly different one. The tokens have names for the jobs
 * that exist — ink, muted, rule, sage, ochre, clay — and a missing name is a
 * prompt to ask what job the colour does, not to reach past them.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'fs';
import { join } from 'path';

const APP = join(process.cwd(), 'src/app');

/** Tailwind's default ramps. Anything here is a colour picked outside the system. */
const RAW_PALETTE =
  /\b(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-(50|\d{3})\b/;

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx')) out.push(p);
  }
  return out;
}

describe('every screen uses the design system', () => {
  it('no file reaches past the tokens for a raw palette colour', () => {
    const offenders: string[] = [];

    for (const file of tsxFiles(APP)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = line.match(RAW_PALETTE);
        if (m) offenders.push(`${file.replace(process.cwd(), '.')}:${i + 1} → ${m[0]}`);
      });
    }

    expect(
      offenders,
      'These reach past the design system for a raw Tailwind colour. Use a token ' +
        '(ink / muted / faint / rule / paper / sage / ochre / clay) — and if none of ' +
        'them names the job, that is worth a conversation rather than a new shade:\n' +
        offenders.join('\n'),
    ).toEqual([]);
  });

  it('no file invents a type size outside the nine-step scale', () => {
    // text-t1..t9 are the scale. Tailwind's own text-sm/lg/2xl are how the app
    // ended up with eight distinct H1 values.
    const RAW_SIZE = /\btext-(xs|sm|base|lg|xl|[2-9]xl)\b/;
    const offenders: string[] = [];

    for (const file of tsxFiles(APP)) {
      const lines = readFileSync(file, 'utf8').split('\n');
      lines.forEach((line, i) => {
        const m = line.match(RAW_SIZE);
        if (m) offenders.push(`${file.replace(process.cwd(), '.')}:${i + 1} → ${m[0]}`);
      });
    }

    expect(
      offenders,
      `Use text-t1 … text-t9 rather than Tailwind's default sizes:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });
});
