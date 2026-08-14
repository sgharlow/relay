/**
 * The recipient is told before they are shown, and the telling is recorded.
 *
 * This is the mitigation chosen INSTEAD of a counsel opinion when gate
 * `g2-counsel-opinion` was declined on 2026-08-14, so the properties that make
 * it worth anything are worth pinning:
 *
 *   - the statement comes BEFORE the plan. After it, the reader has already seen
 *     the credentials and the disclosure is decoration.
 *   - the acknowledgement is WRITTEN DOWN. A statement that is displayed and not
 *     recorded proves nothing later; "they were told" has to be a fact about the
 *     audit log rather than an assertion about a React component.
 *   - a failed write does NOT lock anybody out. Someone in a hospital corridor
 *     must never be held at a disclosure because the database blinked.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('../db/connection', () => ({ query: vi.fn() }));
vi.mock('../audit/audit-service', () => ({ writeAuditEntry: vi.fn(async () => ({})) }));

import { query } from '../db/connection';
import { writeAuditEntry } from '../audit/audit-service';
import {
  hasAcknowledgedLimits,
  recordLimitsAcknowledgement,
  LIMITS_ACK_ACTION,
} from './acknowledgement';

const mockQuery = vi.mocked(query);
const mockAudit = vi.mocked(writeAuditEntry);
const count = (n: number) => ({ rows: [{ n: String(n) }], rowCount: 1 }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('reading it back', () => {
  it('is false before anything is recorded', async () => {
    mockQuery.mockResolvedValueOnce(count(0));
    expect(await hasAcknowledgedLimits('own-1', 'rec-1')).toBe(false);
  });

  it('is true once it is', async () => {
    mockQuery.mockResolvedValueOnce(count(1));
    expect(await hasAcknowledgedLimits('own-1', 'rec-1')).toBe(true);
  });

  /*
    Scoped to the OWNER and the RECIPIENT, not to the release. Being re-shown the
    same statement every time an owner re-arms would train people to click past
    it, which is how a disclosure stops being one.
  */
  it('is scoped to this owner and this recipient', async () => {
    mockQuery.mockResolvedValueOnce(count(0));
    await hasAcknowledgedLimits('own-1', 'rec-1');
    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/owner_id = \$1/);
    expect(String(sql)).toMatch(/entity_id = \$3/);
    expect(params).toEqual(['own-1', LIMITS_ACK_ACTION, 'rec-1']);
  });
});

describe('writing it down', () => {
  it('records against the owner chain, naming the recipient as actor', async () => {
    await recordLimitsAcknowledgement({
      ownerId: 'own-1',
      recipientId: 'rec-1',
      releaseStateId: 'rs-1',
    });
    expect(mockAudit).toHaveBeenCalledWith(
      'own-1',
      expect.objectContaining({
        actor: 'recipient:rec-1',
        action: LIMITS_ACK_ACTION,
        entityId: 'rec-1',
      }),
    );
  });
});

describe('where it sits in the flow', () => {
  const client = () =>
    readFileSync('src/app/(access)/access/AccessClient.tsx', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ' ',
    );

  /*
    🔴 ORDER IS THE WHOLE POINT. A disclosure rendered after the plan is a
    disclosure the reader meets holding the credentials it is about.
  */
  it('the statement gates the plan rather than decorating it', () => {
    const src = client();
    const gate = src.indexOf('!data.acknowledgedLimits');
    const plan = src.indexOf('Your access plan');
    expect(gate, 'AccessClient does not gate on acknowledgedLimits').toBeGreaterThan(-1);
    expect(
      gate < plan,
      'the acknowledgement gate must come BEFORE the plan renders, or the reader ' +
        'has already seen what it is about.',
    ).toBe(true);
  });

  it('a reminder still shows after the one-time statement', () => {
    expect(client()).toContain('LimitsReminder');
  });

  /*
    The copy is the deliverable here, not an implementation detail — these three
    claims are what was approved, and a reword that drops one changes what the
    product asserts. Kept deliberately loose (no full sentences) so ordinary
    editing stays possible.
  */
  it('says the three things it exists to say', () => {
    const notice = readFileSync('src/app/(access)/access/LimitsNotice.tsx', 'utf8');
    expect(notice, 'must say the owner chose this').toMatch(/chose to share/i);
    expect(notice, 'must disclaim legal authority').toMatch(/legal authority/i);
    expect(notice, 'must route a death to the executor').toMatch(/executor/i);
  });

  /*
    Nobody is locked out by a failed write. The fetch is wrapped and the continue
    happens in `finally`, so a DSQL blip re-asks next time instead of stranding
    somebody mid-emergency.
  */
  it('lets the reader through even if the record fails', () => {
    const notice = readFileSync('src/app/(access)/access/LimitsNotice.tsx', 'utf8');
    expect(notice).toMatch(/finally\s*\{[\s\S]*?onAcknowledged\(\)/);
  });
});

describe('what the product now tells people', () => {
  /*
    The Terms said estate functionality "is not offered", which invited a reader
    to conclude nothing happens after they die. The heartbeat sweep does not
    filter by trigger type and nothing closes a released state, so an armed
    emergency trigger opens and stays open. Terms and mechanism have to agree.
  */
  it('the Terms state that a release does not end on its own', () => {
    const terms = readFileSync('src/app/terms/page.tsx', 'utf8').replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ');
    expect(terms).toMatch(/stay open until someone closes it/i);
    expect(
      terms,
      'the Terms must no longer flatly claim estate functionality is not offered ' +
        'without saying what DOES happen — that was the sentence the mechanism ' +
        'contradicted.',
    ).toMatch(/does not offer estate or inheritance services/i);
  });

  it('the owner meets it where they set the interval, not only in the Terms', () => {
    const triggers = readFileSync('src/app/(owner)/triggers/page.tsx', 'utf8').replace(
      /\{\/\*[\s\S]*?\*\/\}/g,
      ' ',
    );
    expect(triggers).toMatch(/stop checking in/i);
  });

  it('the guide and the security page say the same thing', () => {
    expect(readFileSync('public/guide/index.html', 'utf8')).toMatch(
      /does not lapse, expire or quietly withdraw/i,
    );
    expect(readFileSync('src/app/security/page.tsx', 'utf8')).toMatch(
      /release does not expire on its own/i,
    );
  });
});
