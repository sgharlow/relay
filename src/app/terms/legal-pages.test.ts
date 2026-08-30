/**
 * The two legal pages, held to their own rule.
 *
 * src/app/terms/page.tsx opens with it: "THIS DOCUMENT MAKES FACTUAL CLAIMS THAT
 * GO STALE… a false statement here is worse than a missing one." It then lists
 * the two that already went wrong — "no paying customers yet" for a day after
 * the first live charge, "not currently taking payment" in the week money was
 * taken. Nothing reads either page for the next one.
 *
 * 🔴 TWO WERE STANDING WHEN THIS FILE WAS WRITTEN (2026-08-21).
 *
 * ONE — TEXT MESSAGING, IN THE PRESENT TENSE. /terms: "If you choose to, you can
 * give us a mobile number and we will text you…"; /privacy describes "the box
 * ticked" on "their own signed-in account". There is no box. No screen collects
 * a number, no SMS provider is a dependency, and /sms says so plainly: "text
 * messaging is not switched on yet, and Relay has never sent one."
 * docs/a2p-registration-prep.md puts building the opt-in screen AFTER campaign
 * approval. So the contract a paying owner reads describes a control they cannot
 * find, while a third page says it does not exist.
 *
 * ⚠️ THE DISCLOSURES THEMSELVES MUST STAY. lib/ops/sms-disclosure.test.ts exists
 * because A2P 10DLC review reads these pages and rejects a policy that never
 * mentions texting. The fix is the qualifier /sms already carries, not deletion —
 * this file asserts the qualifier, that one asserts the disclosure, and both have
 * to pass.
 *
 * TWO — THE DATE. Both pages read "Last updated 12 August 2026" after material
 * edits landed on the 15th, 16th, 19th and 20th: who operates Relay, Stripe as a
 * subprocessor, the readable authenticator seed, what a lapse does, the
 * no-successor statement. A reader comparing versions was told nothing had
 * changed. A hand-copied date in two files is the "volatile numbers live in
 * exactly one place" rule with nothing enforcing it.
 *
 * Feature: relay-g1-wtp
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';

const PAGES = [
  { name: 'terms', file: 'src/app/terms/page.tsx' },
  { name: 'privacy', file: 'src/app/privacy/page.tsx' },
] as const;

/** Rendered prose: comments out, whitespace as a reader meets it. */
const prose = (file: string) =>
  readFileSync(file, 'utf8')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\/\/[^\n]*/g, ' ')
    .replace(/\s+/g, ' ');

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** `UPDATED = '12 August 2026'` → a Date, or null if the shape changed. */
function updatedDate(file: string): Date | null {
  const m = /UPDATED\s*=\s*'(\d{1,2}) (\w+) (\d{4})'/.exec(readFileSync(file, 'utf8'));
  if (!m) return null;
  const month = MONTHS.indexOf(m[2]);
  if (month < 0) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1])));
}

/**
 * The date of the file's last commit, or null when git cannot answer.
 *
 * Null on purpose rather than a throw: a source export, a shallow clone or a
 * sandbox without git must skip this check, not fail it. A guard that cannot run
 * everywhere is still worth having where it can.
 */
function lastCommitDate(file: string): Date | null {
  try {
    const out = execFileSync('git', ['log', '-1', '--format=%cs', '--', file], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(out) ? new Date(`${out}T00:00:00Z`) : null;
  } catch {
    return null;
  }
}

describe.each(PAGES)('/%s does not promise text messages it cannot send', ({ name, file }) => {
  it('does not state the opt-in as something available now', () => {
    /*
      The present-tense assertions, specifically. "We will text you" and "the box
      ticked" describe a control the reader can go and use.
    */
    const offenders = [/we will text you/i, /the box ticked/i, /with the box/i].filter((re) =>
      re.test(prose(file)),
    );
    expect(
      offenders.map(String),
      `/${name} states the SMS opt-in in the present tense. No screen collects a number, ` +
        'no SMS provider is a dependency, and /sms says Relay has never sent one.',
    ).toEqual([]);
  });

  it('carries the same qualifier /sms carries', () => {
    // /sms: "text messaging is not switched on yet, and Relay has never sent
    // one. This page states the terms it will run under, in advance."
    expect(
      prose(file),
      `/${name} describes text messaging without saying it is not switched on yet`,
    ).toMatch(/not switched on|not yet|never sent|before (?:it|any of this) is switched on/i);
  });

  it('still carries the disclosure A2P review looks for', () => {
    // Belt and braces with lib/ops/sms-disclosure.test.ts: the qualifier above
    // must never be applied by deleting the paragraph it qualifies.
    const p = prose(file);
    expect(p).toMatch(/text (you|messages|someone)/i);
    expect(p).toContain('STOP');
  });
});

describe.each(PAGES)('/%s reports its own revision date honestly', ({ name, file }) => {
  it('declares an UPDATED date in the expected shape', () => {
    expect(
      updatedDate(file),
      `${file} no longer declares UPDATED = 'D Month YYYY' — move this guard to wherever ` +
        'the displayed date now comes from',
    ).not.toBeNull();
  });

  it('is not older than the last change to the file', () => {
    const declared = updatedDate(file);
    const committed = lastCommitDate(file);
    if (!declared || !committed) return; // no git, or shape changed — covered above

    expect(
      declared.getTime() >= committed.getTime(),
      `/${name} says "Last updated ${declared.toISOString().slice(0, 10)}" but the file was last ` +
        `changed on ${committed.toISOString().slice(0, 10)}. Move UPDATED in the same commit as ` +
        'the edit — a reader comparing versions is being told nothing changed.',
    ).toBe(true);
  });
});

describe('/privacy states everything that survives a deletion', () => {
  /*
    🔴 THE PAGE UNDERSTATED WHAT REMAINS. It said closing an account "removes your
    vault, the people you listed, your passkeys and any emergency codes", then
    "Two things deliberately survive" — the audit log and the roster stub on
    somebody else's list. Three more do:

      · `email_delivery_events` holds every owner's and contact's address in
        plaintext. It is deliberately NOT owner-scoped (migration 027: "the fact
        lives against an ADDRESS"), and no DELETE anywhere targets it — so the
        addresses of "the people you listed" outlive the deletion indefinitely.
      · `caregiver_leads` holds an email and a free-text note from the interest
        form, with no deletion path. /privacy never mentioned that form at all.
      · Backups. docs/backup-restore-runbook.md records 35-day retention.

    lib/account/lifecycle.ts states the standard this is held to: "The promise and
    the implementation must agree, so the code follows the document." Making the
    code delete these is a retention decision (a deleted delivery record is also a
    deleted bounce history, which is what stops mail to a dead address); saying
    what is true is not, and is the half that can be done without ruling on it.
  */
  const privacy = () => prose('src/app/privacy/page.tsx');

  it('does not claim a count of exceptions it does not list', () => {
    // "Two things deliberately survive" was a closed statement, and closed
    // statements are the ones that go quietly wrong when a third thing appears.
    expect(privacy(), 'a fixed count invites the next omission').not.toMatch(
      /Two things deliberately survive/i,
    );
  });

  it('mentions delivery records, which hold contacts’ addresses', () => {
    expect(privacy()).toMatch(/delivery record|whether an email reached/i);
  });

  /*
    🔴 AND THEN THE WINDOW ITSELF BECAME A HAND-COPIED NUMBER, IN THREE PLACES.
    /privacy states it twice and this test asserted the literal `/35 days/` — so
    the guard against a stale legal claim was itself a third copy of the fact it
    was guarding. `docs/backup-restore-runbook.md` is where the backup plan is
    described and where a change to it would be made; changing the DSQL retention
    there would leave a privacy policy making a false statement about how long a
    deletion takes to reach every copy, with a green suite.

    The repo's rule is that a volatile number lives in exactly one place. There
    is no importable constant for this — the runbook table IS the record — so the
    page is compared against it rather than against a number typed here.
  */
  const RUNBOOK = 'docs/backup-restore-runbook.md';

  /** `| Retention | 35 days |` → 35, or null if that row's shape changed. */
  const retentionDays = (md: string): number | null => {
    const m = /\|\s*Retention\s*\|\s*(\d+)\s*days?\s*\|/i.exec(md);
    return m ? Number(m[1]) : null;
  };

  /** Does this prose state N days as the backup window? */
  const statesWindow = (text: string, days: number): boolean =>
    new RegExp(`backups?[^.]{0,160}?\\b${days} days\\b|\\b${days} days\\b[^.]{0,160}?backups?`, 'i').test(
      text,
    );

  it('reads the retention window out of the runbook', () => {
    expect(
      retentionDays(readFileSync(RUNBOOK, 'utf8')),
      `${RUNBOOK} no longer carries a "| Retention | N days |" row — move this guard to ` +
        'wherever the backup window is now recorded',
    ).toBeGreaterThan(0);
  });

  it('would notice a page stating a different window', () => {
    // The check proven to fail, on a fixture rather than by editing the runbook:
    // an assertion that cannot be wrong is decoration.
    expect(statesWindow('backups of the database are kept for 35 days', 35)).toBe(true);
    expect(statesWindow('backups of the database are kept for 7 days', 35)).toBe(false);
  });

  it('names the same backup window the runbook declares', () => {
    const days = retentionDays(readFileSync(RUNBOOK, 'utf8'));
    if (days === null) return; // shape changed — reported by the assertion above

    expect(
      statesWindow(privacy(), days),
      `${RUNBOOK} says backups are kept ${days} days; /privacy must state that same number — ` +
        'it is how long a deletion takes to reach every copy, and the page promises it',
    ).toBe(true);
  });

  it('mentions the interest form, whose note has no deletion path', () => {
    expect(privacy()).toMatch(/interest form|asked to hear more/i);
  });
});

describe('the billing gate’s scope is stated, not left silent (E4.1)', () => {
  /*
    🔴 RULED 2026-08-30. `assertCanRelease` guards ONE of the four ARMED -> PENDING
    paths — the deliberate Initiate action. The missed-check-in sweep, owner
    consent to an access request, and silence on a challenge are NOT billing-gated.

    /terms said nothing about any of it. Silence here is the expensive kind: an
    owner whose card has lapsed cannot tell whether the thing they bought Relay
    for still happens, and the honest answer — it does — is also the reassuring
    one, so there was never a reason to withhold it.

    Asserted on MEANING rather than on a sentence, so the copy can be rewritten
    without this going red for the wrong reason. What must survive: the page says
    a lapse does not stop the involuntary paths.
  */
  const terms = readFileSync('src/app/terms/page.tsx', 'utf8');

  it('says a lapsed subscription does not stop a release that runs without the owner', () => {
    expect(
      /lapsed subscription does not switch off|not hold an emergency behind a card/i.test(terms),
      '/terms no longer states what a lapse does NOT stop. E4.1 ruled that the three involuntary ' +
        'paths are never billing-gated and that /terms must say so — this is the sentence that ' +
        'keeps the promise checkable.',
    ).toBe(true);
  });

  it('names the paths that keep working, not just that "some" do', () => {
    // "Some releases still work" is not a term anybody can rely on. The three
    // must be recognisable: stop checking in, agree to a request, never answer.
    expect(/stop checking in/i.test(terms)).toBe(true);
    expect(/asks for access/i.test(terms)).toBe(true);
    expect(/never answer/i.test(terms)).toBe(true);
  });

  it('is honest that starting one yourself is the part that stops', () => {
    expect(/no longer start a release yourself/i.test(terms)).toBe(true);
  });
});
