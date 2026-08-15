/**
 * What GET /api/access says to a SIGNED-IN contact, in each of the three states
 * that are not "here is your dashboard".
 *
 * 🔴 THE STATE THIS EXISTS FOR IS THE CALM ONE. A claimed recipient whose owner
 * is perfectly fine — every trigger armed, nothing ever fired — used to be told
 * "Everything is back to normal. The vault has been re-armed, so this link no
 * longer opens anything," followed by "You were trusted with N items for under
 * an hour." None of it had happened. The resolver matched an `armed` row, the
 * route read any non-released resolve as CLOSED, and the item count came from a
 * live access_rules query while the duration came from audit rows including the
 * one that request had just written.
 *
 * That lands on precisely the audience this product is for: somebody standing
 * by for a parent, checking whether they are needed. Telling them access was
 * granted and withdrawn is a small horror, and it was the steady state.
 *
 * The three answers must stay distinct, because the family member reads them as
 * three different facts about someone they love:
 *   nothing happening  → say nothing is waiting
 *   in progress        → say they have been asked, and to sit tight
 *   genuinely closed   → the farewell, with a truthful summary
 *
 * Feature: relay-standby
 * Requirements: 7.3, 7.7, J8, J9-R4
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../../lib/access/dashboard', async (io) => {
  const actual = await io<typeof import('../../../../lib/access/dashboard')>();
  return { ...actual, getAccessDashboard: vi.fn(), getAccessDashboardForRecipient: vi.fn() };
});
vi.mock('../../../../lib/auth/session', () => ({ getOwnerSession: vi.fn() }));
vi.mock('../../../../lib/access/session-access', () => ({
  resolveReleaseForUser: vi.fn(),
  resolveReleasesForUser: vi.fn(),
}));
vi.mock('../../../../lib/people/owner-label', () => ({ getOwnerLabel: vi.fn() }));
vi.mock('../../../../lib/access/closure', () => ({
  getClosureSummary: vi.fn(),
  getClosureSummaryForUser: vi.fn(),
}));

import { getOwnerSession } from '../../../../lib/auth/session';
import {
  resolveReleaseForUser,
  resolveReleasesForUser,
} from '../../../../lib/access/session-access';
import { getOwnerLabel } from '../../../../lib/people/owner-label';
import { getClosureSummaryForUser } from '../../../../lib/access/closure';
import { getAccessDashboardForRecipient } from '../../../../lib/access/dashboard';
import { GET } from './route';

const mockSession = vi.mocked(getOwnerSession);
const mockResolve = vi.mocked(resolveReleaseForUser);
const mockResolveAll = vi.mocked(resolveReleasesForUser);
const mockLabel = vi.mocked(getOwnerLabel);
const mockClosure = vi.mocked(getClosureSummaryForUser);
const mockDash = vi.mocked(getAccessDashboardForRecipient);

/** No token at all — the claimed-recipient path. `owner` selects among several. */
const req = (params: Record<string, string> = {}) =>
  ({
    headers: { get: () => null },
    nextUrl: { searchParams: { get: (k: string) => params[k] ?? null } },
  }) as never;

const release = (o: Record<string, unknown> = {}) => ({
  recipientId: 'rec-1',
  ownerId: 'owner-1',
  releaseStateId: 'rs-1',
  triggerType: 'emergency',
  state: 'released',
  released: true,
  ...o,
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSession.mockResolvedValue({ ownerId: 'user-1' } as never);
  // Default: at most one thing open, so the picker never fires in the branch
  // tests below. `resolveReleaseForUser` is what those assert against.
  mockResolveAll.mockResolvedValue([]);
  mockLabel.mockImplementation(async (id: string) => `Owner ${id}`);
});

describe('a signed-in contact with nothing open', () => {
  it('is NOT told their access closed when it never opened', async () => {
    mockResolve.mockResolvedValue(null); // armed rows no longer resolve
    mockClosure.mockResolvedValue(null); // and they have no footprint

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(401);
    expect(body.closed).toBeUndefined();
    // The words that were wrong, asserted as absent rather than merely different.
    expect(JSON.stringify(body)).not.toMatch(/back to normal|re-armed|trusted with/i);
  });

  it('does not compute a closure summary for someone with no history', async () => {
    mockResolve.mockResolvedValue(null);
    mockClosure.mockResolvedValue(null);

    await GET(req());

    // It may ASK (that is how the two cases are told apart) but the answer
    // being null must end the matter — no summary reaches the client.
    expect(mockDash).not.toHaveBeenCalled();
  });
});

describe('a signed-in contact whose release is still in progress', () => {
  for (const state of ['pending', 'grace'] as const) {
    it(`is told they are waiting, not that it closed (${state})`, async () => {
      mockResolve.mockResolvedValue({
        recipientId: 'rec-1',
        ownerId: 'owner-1',
        releaseStateId: 'rs-1',
        triggerType: 'emergency',
        state,
        released: false,
      });

      const res = await GET(req());
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.pending).toBe(true);
      expect(body.closed).toBeUndefined();
      expect(body.summary).toBeUndefined();
      // "checked back in" describes something that has not happened.
      expect(body.message).not.toMatch(/checked back in|closed/i);
      expect(body.message).toMatch(/not need to do anything/i);
    });
  }

  it('never renders the farewell for an in-progress release', async () => {
    mockResolve.mockResolvedValue({
      recipientId: 'rec-1',
      ownerId: 'owner-1',
      releaseStateId: 'rs-1',
      triggerType: 'emergency',
      state: 'pending',
      released: false,
    });

    await GET(req());

    expect(mockClosure).not.toHaveBeenCalled();
  });
});

describe('a signed-in contact whose access genuinely closed', () => {
  /*
    The J9-R4 differentiator, and the reason the closure path could not simply
    be deleted along with the bug. After a real close the row is re-armed, so
    this case is indistinguishable from the calm one by STATE — it is separated
    by evidence in the owner's audit chain, which is what getClosureSummaryForUser
    now looks for.
  */
  it('still gets the graceful close, with its summary', async () => {
    mockResolve.mockResolvedValue(null); // re-armed: nothing open
    mockClosure.mockResolvedValue({
      grantedCount: 3,
      opened: [{ title: 'Bank', openedAt: new Date(0).toISOString() }],
      firstSeenAt: new Date(0).toISOString(),
      lastSeenAt: new Date(3_600_000).toISOString(),
      hoursOfAccess: 1,
    });

    const res = await GET(req());
    const body = await res.json();

    expect(res.status).toBe(403);
    expect(body.closed).toBe(true);
    expect(body.summary.grantedCount).toBe(3);
    expect(body.message).toMatch(/checked back in/i);
  });
});

/**
 * A contact standing by for two people, both of whom need them at once.
 *
 * 🔴 THIS COLLAPSED SILENTLY. The resolver took `LIMIT 1` with no tiebreak, so
 * an adult child standing by for both parents was shown one plan with nothing on
 * the page suggesting the other existed — and which one they got could differ
 * between requests.
 */
describe('a signed-in contact needed by more than one person', () => {
  const twoOpen = () =>
    mockResolveAll.mockResolvedValue([
      release(),
      release({ recipientId: 'rec-2', ownerId: 'owner-2', releaseStateId: 'rs-2', state: 'grace', released: false }),
    ]);

  it('is offered the choice instead of being handed one at random', async () => {
    twoOpen();

    const res = await GET(req());
    const body = await res.json();

    expect(body.choose).toBe(true);
    expect(body.releases.map((r: { ownerId: string }) => r.ownerId)).toEqual(['owner-1', 'owner-2']);
    // Names, not identifiers: somebody is deciding which parent to attend to.
    expect(body.releases[0].ownerLabel).toBe('Owner owner-1');
    expect(body.releases[1].released).toBe(false);
  });

  /*
    NOT 2xx. A client that has never heard of `ChooseOwner` must not be able to
    mistake this for a dashboard and render an empty one.
  */
  it('answers a non-success status carrying the discriminator', async () => {
    twoOpen();
    const res = await GET(req());
    expect(res.ok).toBe(false);
    expect((await res.json()).error).toBe('ChooseOwner');
  });

  /*
    Being shown a list of names is not viewing anybody's plan. Auditing here
    would put a `dashboard_viewed` entry in TWO families' tamper-evident chains
    for one visit that opened nothing.
  */
  it('resolves nothing, and so audits nothing, while the question is open', async () => {
    twoOpen();
    await GET(req());
    expect(mockResolve).not.toHaveBeenCalled();
  });

  it('passes the choice through once it is made', async () => {
    twoOpen();
    mockResolve.mockResolvedValue(release({ ownerId: 'owner-2', recipientId: 'rec-2' }));
    mockDash.mockResolvedValue({ items: [] } as never);

    await GET(req({ owner: 'owner-2' }));

    expect(mockResolve).toHaveBeenCalledWith('user-1', { audit: true, ownerId: 'owner-2' });
  });

  it('does not ask the question when only one thing is open', async () => {
    mockResolveAll.mockResolvedValue([release()]);
    mockResolve.mockResolvedValue(release());
    mockDash.mockResolvedValue({ items: [] } as never);

    const res = await GET(req());

    expect(res.status).toBe(200);
    expect(mockLabel).not.toHaveBeenCalled();
  });
});
