/**
 * The AI seam is metered.
 *
 * 🔴 IT WAS NOT. /api/ai/intake authenticated and called OpenAI, full stop —
 * no rate limit, no daily cap, no tier gate, behind a self-serve signup. The
 * per-call batch cap bounded what one request cost; nothing bounded how many
 * requests there were.
 *
 * The two properties worth pinning are the ones that are easy to get subtly
 * wrong: the meter must count ATTEMPTS rather than successes, or a caller burns
 * the budget for free by failing on purpose; and it must be keyed on the OWNER
 * rather than the IP, or a family behind one address throttles each other while
 * an attacker changes address.
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
  reserveIntakeRun,
  intakeRunsToday,
  IntakeBudgetError,
  INTAKE_DAILY_LIMIT,
  INTAKE_ACTION,
} from './intake-budget';

const mockQuery = vi.mocked(query);
const count = (n: number) => ({ rows: [{ n: String(n) }], rowCount: 1 }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  mockQuery.mockReset();
});

describe('the daily ceiling', () => {
  it('counts only this owner, only this action, only the last 24 hours', async () => {
    mockQuery.mockResolvedValueOnce(count(3));
    await intakeRunsToday('own-1');

    const [sql, params] = mockQuery.mock.calls[0];
    expect(String(sql)).toMatch(/INTERVAL '24 hours'/);
    expect(String(sql)).toMatch(/owner_id = \$1/);
    expect(String(sql)).toMatch(/action = \$2/);
    expect(params).toEqual(['own-1', INTAKE_ACTION]);
  });

  it('lets a run through when there is room', async () => {
    mockQuery.mockResolvedValueOnce(count(0));
    await expect(reserveIntakeRun('own-1')).resolves.toBeUndefined();
    expect(vi.mocked(writeAuditEntry)).toHaveBeenCalledTimes(1);
  });

  it('refuses once the ceiling is reached', async () => {
    mockQuery.mockResolvedValueOnce(count(INTAKE_DAILY_LIMIT));
    await expect(reserveIntakeRun('own-1')).rejects.toBeInstanceOf(IntakeBudgetError);
  });

  /*
    A refusal must not tick the meter. Otherwise a caller who is already blocked
    keeps extending their own lockout, and the audit log fills with entries for
    runs that never happened.
  */
  it('does not record an attempt it refused', async () => {
    mockQuery.mockResolvedValueOnce(count(INTAKE_DAILY_LIMIT));
    await reserveIntakeRun('own-1').catch(() => {});
    expect(vi.mocked(writeAuditEntry)).not.toHaveBeenCalled();
  });

  /*
    🔴 THE PROPERTY THE WHOLE MODULE TURNS ON. The entry is written BEFORE the
    model is called, so the meter records the intent to spend. If it recorded
    the RESULT instead, an attacker would trigger a failure after every call and
    never increment anything — spending real money against a counter that never
    moves.
  */
  it('reserves before the model runs, not after', () => {
    const route = readFileSync('src/app/api/ai/intake/route.ts', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ' ',
    );
    const reserved = route.indexOf('reserveIntakeRun');
    const ran = route.indexOf('runIntake(');
    expect(reserved).toBeGreaterThan(-1);
    expect(ran).toBeGreaterThan(-1);
    expect(
      reserved < ran,
      'reserveIntakeRun must be called before runIntake, or the meter counts ' +
        'successes and a caller can spend for free by failing on purpose.',
    ).toBe(true);
  });

  it('the refusal tells the owner nothing is wrong with their vault', async () => {
    mockQuery.mockResolvedValueOnce(count(INTAKE_DAILY_LIMIT));
    const err = await reserveIntakeRun('own-1').then(
      () => null,
      (e: unknown) => e as IntakeBudgetError,
    );
    expect(err, 'the ceiling must have refused').not.toBeNull();
    expect(err!.message).toMatch(/nothing in your vault is affected/i);
    expect(err!.retryAfterSeconds).toBeGreaterThan(0);
  });
});

describe('the burst limit', () => {
  /*
    Keyed on the owner, not the IP. The caller is authenticated, so the account
    is the honest unit — and an IP key would throttle a family sharing one
    address while an attacker simply changes address.
  */
  it('is keyed on the owner', () => {
    const route = readFileSync('src/app/api/ai/intake/route.ts', 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      ' ',
    );
    expect(route).toMatch(/rateLimit\(\s*`ai-intake:\$\{auth\.ownerId\}`/);
    expect(route, 'an authenticated endpoint must not key its limiter on the IP').not.toContain(
      'clientKey(',
    );
  });

  it('answers 429 with a Retry-After', () => {
    const route = readFileSync('src/app/api/ai/intake/route.ts', 'utf8');
    expect(route).toMatch(/status:\s*429/);
    expect(route).toContain("'Retry-After'");
  });
});
