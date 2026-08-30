/**
 * Does the op-ed still satisfy the constraints it has to satisfy? (A1.4)
 *
 * 🔴 IT WAS A HAND-COUNTED TABLE, AND THE HAND COUNT WAS WRONG.
 * `docs/oped-angle-3-draft.md` carries a "Compliance measurements" table whose
 * own heading says *"re-measure after the rewrite, do not trust these"* — an
 * instruction to a person to redo arithmetic nobody would notice going stale.
 * It claimed **991** body words. Measured on 2026-08-30: **1054**. Sixty-three
 * words out, in the document that decides whether the piece is inside the
 * outlet's range, in a repository whose standing rule is that a volatile number
 * lives in one place and is derived rather than copied.
 *
 * So A1.4 — "compliance re-measure after the rewrite" — is this command instead
 * of that instruction.
 *
 * THE CONSTRAINTS ARE NOT INVENTED HERE. They are
 * `ratified.g1-editorial-over-paid.constraints_carried`: *"§1a third person;
 * estate stays out …; no medical claims; commercial interest disclosed"*, plus
 * ROADMAP A1.4's word range and the portfolio's employer-anonymity rule.
 *
 * ⚠️ §1a IS NARROWER THAN "NO SECOND PERSON", and reading it as the broader rule
 * would fail a compliant draft. The rule as written in `docs/g1-editorial-lane.md`
 * is: *"Never 'your mother', never 'you' joined to a health event."* An op-ed
 * that says "you" about what the READER might do on a Tuesday is fine; one that
 * says "you" about the reader's own illness is not. This checks the join, in a
 * sentence, which is the thing the rule is actually about.
 *
 * ⚠️ WHAT IT CANNOT CHECK, said so its green is not read as wider than it is:
 * whether the piece is any good, whether it is in Steve's voice (A1.1, and the
 * whole reason the send is human-authored), and whether the cover email
 * discloses the commercial interest (A1.2 — a different document). A green here
 * means "no constraint is provably broken", never "ready to send".
 *
 *   npm run check:oped
 *
 * 0 = every checkable constraint holds · 1 = a finding · 2 = could not look.
 *
 * Feature: relay-g1-wtp
 * Requirements: A1.4
 */

import { readFileSync, existsSync } from 'node:fs';

const DRAFT = 'docs/oped-angle-3-draft.md';

/** ROADMAP A1.4. The outlet's range, not a preference. */
const MIN_WORDS = 500;
const MAX_WORDS = 1500;

interface Finding {
  constraint: string;
  detail: string;
}

/**
 * The body only — between the draft heading and the bio.
 *
 * The bio is measured separately and by a different rule: it is ALLOWED one
 * oblique reference to building tools, which is the disclosure the outlet
 * expects, and counting it as a product mention would fail the piece for doing
 * the honest thing.
 */
function sections(src: string): { body: string; bio: string } {
  const bodyStart = src.indexOf('\n## Draft');
  const bioStart = src.indexOf('\n## Bio');
  if (bodyStart === -1 || bioStart === -1 || bioStart < bodyStart) {
    throw new Error(
      `could not find "## Draft" and "## Bio" in ${DRAFT}. This script measures the BODY, and a ` +
        'measurement over the whole file would silently include the compliance table it exists ' +
        'to replace — which mentions every banned word in order to ban it.',
    );
  }
  const bioEnd = src.indexOf('\n## ', bioStart + 1);
  const bioSection = src.slice(bioStart, bioEnd === -1 ? undefined : bioEnd);

  /*
    🔴 THE BIO IS THE BLOCKQUOTE, NOT THE NOTES BESIDE IT — and the first version
    of this check got that wrong in the direction that manufactures a finding.
    The section carries annotations ABOUT the constraints, including the line
    "⚠️ No employer reference, anywhere". A check FOR an employer reference
    matched the sentence forbidding one, and reported the draft as breaking a
    rule it was explicitly keeping.

    That is the trap `disposable-sweep-matches-the-cascade.test.ts` records in as
    many words: "a NEGATIVE grep matches the comment that EXPLAINS why it must
    not appear". Fourth instance in this repository, and the second written by
    this author this week.
  */
  const bio = bioSection
    .split('\n')
    .filter((l) => l.trim().startsWith('>'))
    .join(' ');

  return { body: src.slice(bodyStart, bioStart), bio };
}

/** Prose words: markdown headings, list bullets and table pipes are not prose. */
function wordCount(md: string): number {
  return md
    .split('\n')
    .filter((l) => !l.trim().startsWith('#') && !l.trim().startsWith('|'))
    .join(' ')
    .replace(/[*_`>#-]/g, ' ')
    .split(/\s+/)
    .filter((w) => /[a-z0-9]/i.test(w)).length;
}

function sentences(md: string): string[] {
  return md.replace(/\s+/g, ' ').split(/(?<=[.!?])\s+/);
}

function main(): number {
  if (!existsSync(DRAFT)) {
    console.error(`COULD NOT LOOK: ${DRAFT} does not exist.`);
    return 2;
  }

  let body: string;
  let bio: string;
  try {
    ({ body, bio } = sections(readFileSync(DRAFT, 'utf8')));
  } catch (err) {
    console.error(`COULD NOT LOOK: ${(err as Error).message}`);
    return 2;
  }

  const findings: Finding[] = [];
  const words = wordCount(body);

  // ── 1. Word count ─────────────────────────────────────────────────────────
  if (words < MIN_WORDS || words > MAX_WORDS) {
    findings.push({
      constraint: 'word count',
      detail: `${words} words, outside ${MIN_WORDS}–${MAX_WORDS}`,
    });
  }

  // ── 2. No product mentions in the BODY ────────────────────────────────────
  const product = [...body.matchAll(/\bRelay\b/g)].length;
  if (product > 0) {
    findings.push({
      constraint: 'product mentions in body',
      detail: `${product} — the piece is contributed expertise, not a vendor placement, and a ` +
        'named product is what gets a founder blocked at this class of outlet',
    });
  }

  // ── 3. Estate stays out ───────────────────────────────────────────────────
  /*
    "will" is deliberately matched only as a NOUN — `a/the/his/her/their/my will`.
    The bare word is the commonest modal verb in English and matching it would
    make this check cry wolf on every draft, which is how a guard gets ignored.
  */
  const estate = [
    ...body.matchAll(/\b(estate|inherit\w*|executor|probate|bequeath\w*|intestate)\b/gi),
    ...body.matchAll(/\b(?:a|the|his|her|their|my|your)\s+will\b/gi),
  ].map((m) => m[0]);
  if (estate.length > 0) {
    findings.push({
      constraint: 'estate vocabulary',
      detail: `${estate.length}: ${[...new Set(estate)].join(', ')} — estate was WITHDRAWN ` +
        'permanently (gates.g2-counsel-opinion.declined), so the piece must not imply it exists',
    });
  }

  // ── 4. §1a — "you" joined to a health event ───────────────────────────────
  const HEALTH =
    /\b(hospital|stroke|ill|illness|dying|died|death|dementia|diagnos\w*|rehab\w*|ward|medical|surgery|cancer|collapse[ds]?)\b/i;
  const secondPerson = /\b(you|your|you're|yours)\b/i;
  const joined = sentences(body).filter((s) => secondPerson.test(s) && HEALTH.test(s));
  if (joined.length > 0) {
    findings.push({
      constraint: '§1a — second person joined to a health event',
      detail: `${joined.length} sentence(s). First: "${joined[0].slice(0, 120)}…"`,
    });
  }

  // ── 5. No medical claims ──────────────────────────────────────────────────
  const medicalClaim = sentences(body).filter((s) =>
    /\b(cures?|treats?|prevents?|diagnoses?|reduces? the risk of|clinically proven)\b/i.test(s),
  );
  if (medicalClaim.length > 0) {
    findings.push({
      constraint: 'medical claim',
      detail: `${medicalClaim.length}: "${medicalClaim[0].slice(0, 110)}…"`,
    });
  }

  // ── 6. Employer anonymity ─────────────────────────────────────────────────
  /*
    PHRASES, never the employer's name — the same choice `press-kit.test.ts`
    makes. Writing the name into a tracked file to check it is absent is the
    disclosure the rule exists to prevent.
  */
  const employer = ['employer', 'works at', 'day job', 'consultant at', 'my company', 'we build'];
  const hit = employer.filter((w) => (body + ' ' + bio).toLowerCase().includes(w));
  if (hit.length > 0) {
    findings.push({ constraint: 'employer reference', detail: hit.join(', ') });
  }

  // ── Report ────────────────────────────────────────────────────────────────
  console.log(`op-ed compliance — ${DRAFT}\n`);
  console.log(`  body words                 ${words}   (range ${MIN_WORDS}–${MAX_WORDS})`);
  console.log(`  product mentions (body)    ${product}`);
  console.log(`  estate vocabulary          ${estate.length}`);
  console.log(`  §1a joins                  ${joined.length}`);
  console.log(`  medical claims             ${medicalClaim.length}`);
  console.log(`  employer references        ${hit.length}`);
  console.log(`  bio words                  ${wordCount(bio)}`);

  if (findings.length > 0) {
    console.error('\n::error::The op-ed breaks a constraint it carries.\n');
    for (const f of findings) console.error(`  ${f.constraint}\n    ${f.detail}\n`);
    console.error(
      'These come from ratified.g1-editorial-over-paid.constraints_carried and ROADMAP A1.4.\n' +
        'They are ratified, so the answer is an edit to the draft, never a looser check here.',
    );
    return 1;
  }

  console.log('\nOK — no carried constraint is provably broken.');
  console.log(
    '\n⚠️ That is NOT "ready to send". This cannot judge the writing, cannot tell whether the\n' +
      "   piece is in Steve's voice (A1.1), and does not look at the cover email's commercial\n" +
      '   disclosure (A1.2). Both remain human and both remain required.',
  );
  return 0;
}

process.exit(main());
