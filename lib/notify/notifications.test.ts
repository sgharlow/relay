/**
 * Tests for lib/notify/notifications.ts + email best-effort behaviour.
 *
 * Validates: Requirements 4.4, 6.2, 6.6
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Resend } from 'resend';
import { _setResendClientForTesting } from './email';
import {
  notifyVerifiersForTrigger,
  notifyOwnerReleasePendingGrace,
  notifyOwnerTriggerPending,
  notifyRecipientsOfRelease,
  notifyRecipientAccessClosed,
  notifyOwnerOfDelegation,
} from './notifications';
import { query } from '../db/connection';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
const mockQuery = vi.mocked(query);

const sent: Array<{ to: string; subject: string; text: string }> = [];

function stubResend(opts: { fail?: boolean } = {}): Resend {
  return {
    emails: {
      send: vi.fn(async (msg: { to: string; subject: string; text: string }) => {
        if (opts.fail) throw new Error('resend down');
        sent.push(msg);
        return { data: { id: 'mail-1' }, error: null };
      }),
    },
  } as unknown as Resend;
}

function qResult(rows: unknown[]) {
  return { rows, rowCount: rows.length, command: '', oid: 0, fields: [] } as never;
}

beforeEach(() => {
  sent.length = 0;
  mockQuery.mockReset();
  process.env.RESEND_FROM_ADDRESS = 'relay@example.com';
  process.env.VERIFIER_JWT_SECRET = 'test-secret';
  process.env.RECIPIENT_JWT_SECRET = 'test-recipient-secret';
  process.env.NEXTAUTH_URL = 'https://relay.test';
  delete process.env.NEXT_PUBLIC_SITE_URL;
});
afterEach(() => {
  _setResendClientForTesting(null);
});

describe('notifyVerifiersForTrigger', () => {
  it('emails each verifier a scoped confirmation link and counts successes', async () => {
    _setResendClientForTesting(stubResend());
    const n = await notifyVerifiersForTrigger(
      [
        { id: 'v1', name: 'Lee', email: 'lee@example.com' },
        { id: 'v2', name: 'Sam', email: 'sam@example.com' },
      ],
      'emergency',
      'rs-1',
    );
    expect(n).toBe(2);
    expect(sent).toHaveLength(2);
    expect(sent[0].text).toContain('/verify?token=');
    // verifiers must never receive secret material
    expect(sent[0].text).not.toContain('ciphertext');
  });

  it('best-effort: a Resend failure does not throw (returns 0 sent)', async () => {
    _setResendClientForTesting(stubResend({ fail: true }));
    const n = await notifyVerifiersForTrigger([{ id: 'v1', name: 'Lee', email: 'lee@example.com' }], 'emergency', 'rs-1');
    expect(n).toBe(0);
  });
});

/**
 * The recipient path now issues a typed code and looks up the owner's display
 * name, so a fixed call-order mock runs out. Routing on the SQL keeps these
 * tests about behaviour rather than about how many queries the implementation
 * happens to make.
 */
function routeQueries(recipients: unknown[]) {
  mockQuery.mockImplementation(async (sql: string) => {
    if (sql.includes('FROM recipients')) return qResult(recipients) as never;
    if (sql.includes('FROM users')) return qResult([{ display_name: 'Margaret Chen', email: 'margaret@example.com' }]) as never;
    return qResult([]) as never; // code INSERT and anything else
  });
}

describe('notifyRecipientsOfRelease', () => {
  it('emails each scoped recipient a personal /access link and counts successes', async () => {
    _setResendClientForTesting(stubResend());
    routeQueries([
      { id: 'r1', name: 'Jordan', email: 'jordan@example.com' },
      { id: 'r2', name: 'Pat', email: 'pat@example.com' },
    ]);
    const n = await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'owner-1', triggerType: 'emergency', version: 3 });
    expect(n).toBe(2);
    expect(sent).toHaveLength(2);
    // Points at the bare /access page. The token used to travel in this URL;
    // it is now a typed code, asserted separately below.
    expect(sent[0].text).toContain('/access');
    // scoped query joins access_rules on owner + trigger
    const sql = mockQuery.mock.calls[0][0] as string;
    expect(sql).toContain('JOIN access_rules');
  });

  it('returns 0 when no recipients are scoped', async () => {
    _setResendClientForTesting(stubResend());
    routeQueries([]);
    expect(await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'o', triggerType: 'emergency', version: 1 })).toBe(0);
  });

  it('sends a CODE, not a token in the URL — a forwarded email must grant nothing', async () => {
    _setResendClientForTesting(stubResend());
    routeQueries([{ id: 'r1', name: 'Jordan', email: 'jordan@example.com' }]);

    await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'o', triggerType: 'emergency', version: 3 });

    expect(sent[0].text).not.toContain('?token=');
    expect(sent[0].text).toMatch(/[23456789A-Z]{4}-[23456789A-Z]{4}/);
    // The promise was re-worded 2026-08-13 to the rule that is true in every
    // branch: click-then-enter is the imitation tell.
    expect(sent[0].text).toContain('never asks you to click a link and then enter anything');
  });

  /*
    🔴 THE BUG THESE THREE PIN. A claimed recipient's "skip the code" was
    signalled by THROWING; the shared catch swallowed it like a real failure,
    and the fallback treated every failure as "send the legacy token link" — so
    the one person the architecture promises never to email a credential
    received a live signed JWT at release. hybrid+6 principle 1, violated by an
    exception-as-control-flow. Fixed 2026-08-13 by making claimed an ordinary
    branch.
  */
  it('a CLAIMED recipient gets a pure notification — no token, no code, no credential', async () => {
    _setResendClientForTesting(stubResend());
    routeQueries([
      { id: 'r1', name: 'Jordan', email: 'jordan@example.com', claimed_user_id: 'user-9' },
    ]);

    await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'o', triggerType: 'emergency', version: 3 });

    expect(sent).toHaveLength(1);
    expect(sent[0].text).not.toContain('?token=');
    // Not the code-format regex used elsewhere: the case id (RLY-XXXX-XXXX)
    // legitimately matches it. "enter this code" is the phrase only the
    // credential-bearing branch prints.
    expect(sent[0].text).not.toContain('enter this code');
    expect(sent[0].text).toContain('/standby');
    expect(sent[0].text).toContain('Sign in the way you normally do');
    expect(sent[0].text).toContain('no link that signs you in');
  });

  it('a claimed recipient never even ATTEMPTS a code mint — no credential row is written', async () => {
    // The old shape minted nothing for claimed too, but by throwing mid-mint.
    // Assert structurally: no INSERT into recipient code storage happens at all.
    _setResendClientForTesting(stubResend());
    routeQueries([
      { id: 'r1', name: 'Jordan', email: 'jordan@example.com', claimed_user_id: 'user-9' },
    ]);

    await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'o', triggerType: 'emergency', version: 3 });

    const inserts = mockQuery.mock.calls.map((c) => c[0] as string).filter((q) => /INSERT/i.test(q));
    expect(inserts).toEqual([]);
  });

  it('the token-link fallback still exists, but ONLY for an unclaimed recipient whose code failed', async () => {
    // The deliberate last resort: an unclaimed recipient has no account to
    // sign into, so a locked-out recipient mid-emergency is the worse outcome.
    _setResendClientForTesting(stubResend());
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM recipients'))
        return qResult([{ id: 'r1', name: 'Jordan', email: 'jordan@example.com', claimed_user_id: null }]) as never;
      if (sql.includes('FROM users'))
        return qResult([{ display_name: 'Margaret Chen', email: 'margaret@example.com' }]) as never;
      if (/INSERT/i.test(sql)) throw new Error('DSQL unavailable'); // the code mint fails
      return qResult([]) as never;
    });

    await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'o', triggerType: 'emergency', version: 3 });

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('/access?token=');
  });

  it('names the owner rather than printing a raw email address', async () => {
    _setResendClientForTesting(stubResend());
    routeQueries([{ id: 'r1', name: 'Jordan', email: 'jordan@example.com' }]);

    await notifyRecipientsOfRelease({ releaseStateId: 'rs-1', ownerId: 'o', triggerType: 'emergency', version: 3 });

    expect(sent[0].text).toContain('Margaret Chen');
  });
});

describe('notifyOwnerReleasePendingGrace', () => {
  it('tells the owner the release is confirmed and how to undo it', async () => {
    _setResendClientForTesting(stubResend());
    await notifyOwnerReleasePendingGrace('owner@example.com', 'emergency');
    expect(sent[0].to).toBe('owner@example.com');
    expect(sent[0].subject).toContain('confirmed');
    expect(sent[0].text).toMatch(/check in and it closes again/i);
  });

  it('🔴 NEVER promises a delay, because GRACE_WINDOW_MS is 0', async () => {
    // This said "Release will complete when the grace window elapses. If this is
    // a false alarm, check in now to cancel" — inviting the owner into a race
    // they would lose, since the window is zero by design. What protects them is
    // reversibility, not a countdown, and that is what the message now says.
    _setResendClientForTesting(stubResend());
    await notifyOwnerReleasePendingGrace('owner@example.com', 'emergency');

    const all = `${sent[0].subject} ${sent[0].text}`.toLowerCase();
    expect(all).not.toContain('grace window');
    expect(all).not.toContain('elapses');
  });
});

describe('verifier link regression', () => {
  it('REGRESSION: the verifier link must never point at /confirm', async () => {
    _setResendClientForTesting(stubResend());
    // /confirm has never existed and 404s in production, so every verifier
    // email sent before 2026-08-07 led to a dead page and the N-of-M loop
    // could not be completed from email at all.
    await notifyVerifiersForTrigger(
      [{ id: 'v1', name: 'Alex', email: 'alex@example.com' }],
      'emergency',
      'rs-1',
    );

    const body = sent[0]?.text ?? '';
    expect(body).toContain('/verify?token=');
    expect(body).not.toContain('/confirm?token=');
  });
});

/**
 * Emailed-link origin.
 *
 * FOUND IN A REAL INBOX 2026-08-08: appUrl() read NEXTAUTH_URL, which in
 * production still pointed at the pre-domain deployment, so every access link
 * we had ever sent went to relay-three-henna.vercel.app. A raw vercel.app host
 * with a JWT in the query string, arriving during someone's emergency, is
 * indistinguishable from phishing.
 */
describe('emailed link origin', () => {
  it('prefers NEXT_PUBLIC_SITE_URL over NEXTAUTH_URL', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://relaystandby.com';
    _setResendClientForTesting(stubResend());

    await notifyVerifiersForTrigger(
      [{ id: 'v-1', name: 'Dr Patel', email: 'v@example.com' }],
      'emergency',
      'rs-1',
    );

    expect(sent[0].text).toContain('https://relaystandby.com/verify?token=');
    expect(sent[0].text).not.toContain('relay.test');
  });

  it('falls back to NEXTAUTH_URL so local dev needs no extra setup', async () => {
    _setResendClientForTesting(stubResend());

    await notifyVerifiersForTrigger(
      [{ id: 'v-1', name: 'Dr Patel', email: 'v@example.com' }],
      'emergency',
      'rs-1',
    );

    expect(sent[0].text).toContain('https://relay.test/verify?token=');
  });

  it('NEVER emits a vercel.app link — that host is not ours to keep', async () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://relaystandby.com';
    _setResendClientForTesting(stubResend());

    await notifyVerifiersForTrigger(
      [{ id: 'v-1', name: 'Dr Patel', email: 'v@example.com' }],
      'emergency',
      'rs-1',
    );

    expect(sent[0].text).not.toMatch(/vercel\.app/);
  });
});

/**
 * Indefinite articles in subject lines.
 *
 * Caught by transcribing a full family scenario 2026-08-08: two of the five
 * trigger types start with a vowel, so real mail went out reading "A emergency
 * trigger was initiated" — in the subject line of the message that arrives
 * during an actual emergency.
 */
describe('subject-line grammar', () => {
  it.each(['emergency', 'estate'])('uses "an" before the vowel-initial %s', async (trigger) => {
    _setResendClientForTesting(stubResend());
    await notifyVerifiersForTrigger([{ id: 'v-1', name: 'Dr Patel', email: 'v@example.com' }], trigger, 'rs-1');

    expect(sent[0].subject).toContain(`confirm an ${trigger}`);
    expect(sent[0].subject).not.toContain(`confirm a ${trigger}`);
  });

  it.each(['caregiver', 'travel', 'business'])('uses "a" before the consonant-initial %s', async (trigger) => {
    _setResendClientForTesting(stubResend());
    await notifyVerifiersForTrigger([{ id: 'v-1', name: 'Dr Patel', email: 'v@example.com' }], trigger, 'rs-1');

    expect(sent[0].subject).toContain(`confirm a ${trigger}`);
  });

  it('capitalises correctly when the article opens the sentence', async () => {
    _setResendClientForTesting(stubResend());
    await notifyOwnerTriggerPending('owner@example.com', 'emergency');

    expect(sent[0].subject).toBe('An emergency trigger was initiated on your account');
    expect(sent[0].text).toContain('An "emergency" trigger');
  });
});

/**
 * The quiet moments.
 *
 * Transcribing a full family arc on 2026-08-08 produced three messages, ALL of
 * them during the crisis. These cover the moments the product used to stay
 * silent through.
 */
describe('closure notice to the recipient', () => {
  it('leads with reassurance, not an error', async () => {
    _setResendClientForTesting(stubResend());
    await notifyRecipientAccessClosed({
      to: 'sarah@example.com', name: 'Sarah', ownerLabel: 'Margaret',
      itemsGranted: 4, itemsOpened: 2,
    });

    expect(sent[0].subject).toBe('Access closed — Margaret is back');
    expect(sent[0].text).toContain('Nothing is wrong');
    expect(sent[0].text).toContain('Thank you for stepping in');
  });

  it('reports what they opened and what they did not', async () => {
    _setResendClientForTesting(stubResend());
    await notifyRecipientAccessClosed({
      to: 'sarah@example.com', name: 'Sarah', ownerLabel: 'Margaret',
      itemsGranted: 4, itemsOpened: 2,
    });

    expect(sent[0].text).toContain('trusted with 4 items');
    expect(sent[0].text).toContain('opened 2 of them');
    expect(sent[0].text).toContain('other 2 are');
  });

  it('uses singular English when exactly one went unopened', async () => {
    _setResendClientForTesting(stubResend());
    await notifyRecipientAccessClosed({
      to: 'a@b.com', name: 'Sarah', ownerLabel: 'Margaret', itemsGranted: 2, itemsOpened: 1,
    });
    expect(sent[0].text).toContain('other one is');
  });

  it('handles a recipient who opened nothing without sounding accusatory', async () => {
    _setResendClientForTesting(stubResend());
    await notifyRecipientAccessClosed({
      to: 'a@b.com', name: 'Sarah', ownerLabel: 'Margaret', itemsGranted: 3, itemsOpened: 0,
    });
    expect(sent[0].text).toContain('did not need to open any');
  });

  it('carries NO link — a message that closes a loop should not open one', async () => {
    _setResendClientForTesting(stubResend());
    await notifyRecipientAccessClosed({
      to: 'a@b.com', name: 'Sarah', ownerLabel: 'Margaret', itemsGranted: 1, itemsOpened: 1,
    });
    expect(sent[0].text).not.toMatch(/https?:\/\//);
  });

  /*
    🔴 THE DILIGENT RECIPIENT GOT THE WORST SENTENCE. Somebody who opened
    everything they were given — the case the product most wants — was told
    "You opened 3 of them. The other 0 are on the record as never opened."
    The zero clause was unguarded, and because `granted` and `opened` are
    counted over different sets it could also go negative: "The other -1 are on
    the record as never opened." The web version of this same summary has always
    guarded it, so the two surfaces disagreed.
  */
  it('says nothing about unopened items when there are none', async () => {
    _setResendClientForTesting(stubResend());
    await notifyRecipientAccessClosed({
      to: 'a@b.com', name: 'Sarah', ownerLabel: 'Margaret', itemsGranted: 3, itemsOpened: 3,
    });
    expect(sent[0].text).not.toContain('other 0');
    expect(sent[0].text).not.toMatch(/never opened/);
    expect(sent[0].text).toContain('You opened all of them.');
  });

  it('never renders a negative count, however the two totals disagree', async () => {
    _setResendClientForTesting(stubResend());
    // Reachable for real: access_rules shrink (item deleted, policy
    // rematerialised) while the append-only audit log never does.
    await notifyRecipientAccessClosed({
      to: 'a@b.com', name: 'Sarah', ownerLabel: 'Margaret', itemsGranted: 2, itemsOpened: 3,
    });
    expect(sent[0].text).not.toMatch(/-\d/);
    expect(sent[0].text).not.toMatch(/never opened/);
  });

  it('still names the remainder when some really were left unopened', async () => {
    _setResendClientForTesting(stubResend());
    await notifyRecipientAccessClosed({
      to: 'a@b.com', name: 'Sarah', ownerLabel: 'Margaret', itemsGranted: 4, itemsOpened: 1,
    });
    expect(sent[0].text).toContain('other 3 are on the record as never opened');
  });

  it('uses the singular for exactly one left unopened', async () => {
    _setResendClientForTesting(stubResend());
    await notifyRecipientAccessClosed({
      to: 'a@b.com', name: 'Sarah', ownerLabel: 'Margaret', itemsGranted: 2, itemsOpened: 1,
    });
    expect(sent[0].text).toContain('other one is on the record as never opened');
  });
});

describe('delegation confirmation to the owner', () => {
  it('states the boundary of what a delegate can and cannot do', async () => {
    _setResendClientForTesting(stubResend());
    await notifyOwnerOfDelegation({
      ownerEmail: 'margaret@example.com', delegateLabel: 'sarah@example.com',
      consentMethod: 'in_person',
    });

    expect(sent[0].text).toContain('CANNOT see anything already');
    expect(sent[0].text).toContain('cannot release anything');
  });

  it.each([
    ['in_person', 'in person'],
    ['paper_upload', 'on paper'],
    ['link', 'by link'],
  ])('describes %s consent as "%s"', async (method, phrase) => {
    _setResendClientForTesting(stubResend());
    await notifyOwnerOfDelegation({
      ownerEmail: 'm@example.com', delegateLabel: 's@example.com', consentMethod: method,
    });
    expect(sent[0].text).toContain(phrase);
  });

  it('tells the owner how to end it', async () => {
    _setResendClientForTesting(stubResend());
    await notifyOwnerOfDelegation({
      ownerEmail: 'm@example.com', delegateLabel: 's@example.com', consentMethod: 'link',
    });
    expect(sent[0].text).toContain('/circle');
    expect(sent[0].text).toContain('end it at any time');
  });
});

/**
 * ADAPTIVE MINTING — who gets a live credential in their email.
 *
 * The unit-level rule is asserted in `verifier-notice-class.test.ts`; these
 * assert the thing that actually reaches an inbox, because the rule being right
 * and the message being right are two different failures. A code that is not
 * minted but is still described in the body is worse than either.
 *
 * Feature: relay-standby
 * Requirements: J7-R1, J7-R2
 */
describe('adaptive minting (Option 2, ratified 2026-08-12)', () => {
  /**
   * Routes on SQL rather than call order: the classifier makes one, two or three
   * queries depending on who is in the circle, so a positional mock would encode
   * the implementation instead of the behaviour.
   */
  function routeVerifierQueries(
    verifiers: { id: string; standby_state: string | null; claimed_user_id: string | null }[],
    opts: { passkeyUsers?: string[]; totpUsers?: string[] } = {},
  ) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM verifiers')) return qResult(verifiers) as never;
      if (sql.includes('webauthn_credentials')) {
        return qResult((opts.passkeyUsers ?? []).map((user_id) => ({ user_id }))) as never;
      }
      if (sql.includes('totp_secret')) {
        return qResult((opts.totpUsers ?? []).map((id) => ({ id }))) as never;
      }
      if (sql.includes('FROM users')) {
        return qResult([{ display_name: 'Margaret Chen', email: 'm@example.com' }]) as never;
      }
      return qResult([]) as never; // the code INSERT
    });
  }

  it('mails a code to a confirmed verifier who cannot sign in', async () => {
    _setResendClientForTesting(stubResend());
    routeVerifierQueries([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }]);

    await notifyVerifiersForTrigger(
      [{ id: 'v1', name: 'Dr Patel', email: 'v@example.com' }],
      'emergency',
      'rs-1',
      'owner-1',
    );

    expect(sent[0].text).toContain('/verify and enter this code');
    expect(sent[0].text).not.toContain('?token=');
  });

  it('mails NO credential to a confirmed verifier who holds a passkey', async () => {
    _setResendClientForTesting(stubResend());
    routeVerifierQueries([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }], {
      passkeyUsers: ['u1'],
    });

    await notifyVerifiersForTrigger(
      [{ id: 'v1', name: 'Dr Patel', email: 'v@example.com' }],
      'emergency',
      'rs-1',
      'owner-1',
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('/standby');
    expect(sent[0].text).toContain('There is no code in this message');
    expect(sent[0].text).not.toContain('?token=');
    expect(sent[0].text).not.toMatch(/enter this code/);
    // No credential was minted, either — the assertion above only proves the
    // body does not MENTION one.
    expect(mockQuery.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(
      /INSERT INTO verifier_codes/i,
    );
  });

  it('tells an unverified verifier plainly that their answer would not count', async () => {
    _setResendClientForTesting(stubResend());
    routeVerifierQueries([{ id: 'v1', standby_state: 'claimed', claimed_user_id: 'u1' }]);

    await notifyVerifiersForTrigger(
      [{ id: 'v1', name: 'Dr Patel', email: 'v@example.com' }],
      'emergency',
      'rs-1',
      'owner-1',
    );

    expect(sent).toHaveLength(1);
    expect(sent[0].text).toContain('would not count');
    expect(sent[0].text).toContain('Margaret Chen');
    expect(sent[0].text).not.toContain('?token=');
    expect(sent[0].text).not.toMatch(/enter this code/);
    expect(mockQuery.mock.calls.map((c) => String(c[0])).join('\n')).not.toMatch(
      /INSERT INTO verifier_codes/i,
    );
  });

  it('sends a REVOKED verifier nothing at all', async () => {
    _setResendClientForTesting(stubResend());
    routeVerifierQueries([{ id: 'v1', standby_state: 'revoked', claimed_user_id: 'u1' }]);

    const n = await notifyVerifiersForTrigger(
      [{ id: 'v1', name: 'Removed', email: 'gone@example.com' }],
      'emergency',
      'rs-1',
      'owner-1',
    );

    // Until 2026-08-12 this person received the emergency AND a working code.
    expect(n).toBe(0);
    expect(sent).toHaveLength(0);
  });

  it('mints for everyone when the classifier itself fails — a stalled release is worse', async () => {
    _setResendClientForTesting(stubResend());
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM verifiers')) throw new Error('DSQL unavailable');
      return qResult([]) as never;
    });

    await notifyVerifiersForTrigger(
      [{ id: 'v1', name: 'Dr Patel', email: 'v@example.com' }],
      'emergency',
      'rs-1',
      'owner-1',
    );

    expect(sent[0].text).toContain('enter this code');
  });

  it('gives each person in a mixed circle their own message', async () => {
    _setResendClientForTesting(stubResend());
    routeVerifierQueries(
      [
        { id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' },
        { id: 'v2', standby_state: 'confirmed', claimed_user_id: 'u2' },
        { id: 'v3', standby_state: 'invited', claimed_user_id: null },
      ],
      { passkeyUsers: ['u1'] },
    );

    await notifyVerifiersForTrigger(
      [
        { id: 'v1', name: 'Ana', email: 'ana@example.com' },
        { id: 'v2', name: 'Ben', email: 'ben@example.com' },
        { id: 'v3', name: 'Cal', email: 'cal@example.com' },
      ],
      'emergency',
      'rs-1',
      'owner-1',
    );

    const byTo = new Map(sent.map((m) => [m.to, m.text]));
    expect(byTo.get('ana@example.com')).toContain('/standby');
    expect(byTo.get('ben@example.com')).toContain('enter this code');
    expect(byTo.get('cal@example.com')).toContain('would not count');
  });
});

/**
 * 🔴 The verifier mail named nobody, in any branch.
 *
 * The recipient mail has always opened "${ownerLabel} arranged for you…"; the
 * verifier mail said "You've been asked to confirm a … release trigger" and left
 * the person being asked to vouch for somebody with no idea who. Same omission
 * as the decision page (J7-R3), found by writing the user manual.
 *
 * Requirements: J7-R3
 */
describe('verifier mail names the owner', () => {
  function routeFor(verifiers: { id: string; standby_state: string | null; claimed_user_id: string | null }[], passkeyUsers: string[] = []) {
    mockQuery.mockImplementation(async (sql: string) => {
      if (sql.includes('FROM verifiers')) return qResult(verifiers) as never;
      if (sql.includes('webauthn_credentials')) return qResult(passkeyUsers.map((user_id) => ({ user_id }))) as never;
      if (sql.includes('totp_secret')) return qResult([]) as never;
      if (sql.includes('FROM users')) return qResult([{ display_name: 'Margaret Chen', email: 'm@example.com' }]) as never;
      return qResult([]) as never;
    });
  }

  it('names them in the code branch', async () => {
    _setResendClientForTesting(stubResend());
    routeFor([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }]);
    await notifyVerifiersForTrigger([{ id: 'v1', name: 'Dr Patel', email: 'v@example.com' }], 'emergency', 'rs-1', 'owner-1');
    expect(sent[0].text).toContain('Margaret Chen');
  });

  it('names them in the sign-in branch', async () => {
    _setResendClientForTesting(stubResend());
    routeFor([{ id: 'v1', standby_state: 'confirmed', claimed_user_id: 'u1' }], ['u1']);
    await notifyVerifiersForTrigger([{ id: 'v1', name: 'Dr Patel', email: 'v@example.com' }], 'emergency', 'rs-1', 'owner-1');
    expect(sent[0].text).toContain('Margaret Chen');
  });

  it('names them in the not-counted branch', async () => {
    _setResendClientForTesting(stubResend());
    routeFor([{ id: 'v1', standby_state: 'claimed', claimed_user_id: 'u1' }]);
    await notifyVerifiersForTrigger([{ id: 'v1', name: 'Dr Patel', email: 'v@example.com' }], 'emergency', 'rs-1', 'owner-1');
    expect(sent[0].text).toContain('Margaret Chen');
  });

  it('still sends something sensible when there is no owner id at all', async () => {
    // The legacy token fallback takes this path; it must not render "undefined".
    _setResendClientForTesting(stubResend());
    await notifyVerifiersForTrigger([{ id: 'v1', name: 'Dr Patel', email: 'v@example.com' }], 'emergency', 'rs-1');
    expect(sent[0].text).not.toContain('undefined');
    expect(sent[0].text).toContain("Someone named you as one of the people");
  });
});

describe('🔴 the confirmed notice is trigger-aware — 2026-08-12 grace ruling', () => {
  it('tells a reversible owner they can close it by checking in', async () => {
    _setResendClientForTesting(stubResend());
    await notifyOwnerReleasePendingGrace('owner@example.com', 'emergency');
    expect(sent[0].text).toMatch(/check in and it closes again/i);
  });

  it('NEVER tells an estate owner to check in — it cannot reverse one', async () => {
    // processCheckin puts estate in `blocked`: permanent once released. The
    // reversible wording would be false twice over -- it does not open at once,
    // and checking in will never close it. That is the same false promise this
    // message was rewritten to remove, arriving from the other direction.
    _setResendClientForTesting(stubResend());
    await notifyOwnerReleasePendingGrace('owner@example.com', 'estate');

    const all = `${sent[0].subject} ${sent[0].text}`;
    expect(all).toMatch(/three days/i);
    expect(all).toMatch(/PERMANENT/);
    expect(all).toMatch(/stand it down/i);
    expect(sent[0].text).not.toMatch(/check in and it closes again/i);
  });

  it('gets the article right on the estate wording', async () => {
    _setResendClientForTesting(stubResend());
    await notifyOwnerReleasePendingGrace('owner@example.com', 'estate');
    expect(sent[0].text).toContain('an estate handover is');
  });
});
