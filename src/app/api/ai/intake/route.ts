/**
 * POST /api/ai/intake — run the Intake Agent over the owner's vault metadata.
 *
 * Owner-authenticated. Reads ONLY via the ZK metadata query layer (never the
 * secret columns) and writes back classifications + clamped importance scores.
 * Returns the count scored plus a warning list of any items that fell back to
 * the default classification (Req 11.9).
 *
 * Feature: relay-h0-mvp
 * Requirements: 11.1, 11.5, 11.9
 */

import { NextResponse } from 'next/server';
import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { runIntake } from '../../../../../lib/ai/intake-agent';
import { rateLimit } from '../../../../../lib/http/rate-limit';
import {
  reserveIntakeRun,
  IntakeBudgetError,
  INTAKE_BURST_LIMIT,
  INTAKE_BURST_WINDOW_MS,
} from '../../../../../lib/ai/intake-budget';

/**
 * 🔴 THIS HANDLER WAS FIVE LINES AND SPENT MONEY ON DEMAND. It authenticated
 * and called straight through to OpenAI, with no rate limit, no daily cap and
 * no tier gate, behind a self-serve signup. Per-call cost was bounded by
 * runIntake's 300-item batch; call frequency was not bounded at all.
 *
 * Two layers now, for the reasons in lib/ai/intake-budget.ts: an in-memory
 * burst limit keyed on the OWNER (not the IP — the caller is authenticated, and
 * an IP key would punish a family sharing an address), and a rolling 24-hour
 * ceiling read from the database so every instance shares it.
 *
 * The handler deliberately still takes NO request argument. Neither guard needs
 * one — the burst limit keys on the owner and the ceiling reads the database —
 * so the signature is unchanged and no caller had to move.
 */
export async function POST(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const burst = rateLimit(`ai-intake:${auth.ownerId}`, INTAKE_BURST_LIMIT, INTAKE_BURST_WINDOW_MS);
  if (!burst.allowed) {
    return NextResponse.json(
      {
        error: 'RateLimited',
        message: 'Relay is still sorting the last batch. Give it a moment and try again.',
      },
      { status: 429, headers: { 'Retry-After': String(burst.retryAfterSeconds) } },
    );
  }

  try {
    await reserveIntakeRun(auth.ownerId);
  } catch (err) {
    if (err instanceof IntakeBudgetError) {
      return NextResponse.json(
        { error: 'RateLimited', message: err.message },
        { status: 429, headers: { 'Retry-After': String(err.retryAfterSeconds) } },
      );
    }
    throw err;
  }

  const result = await runIntake(auth.ownerId);
  return NextResponse.json({
    scored: result.scored,
    /*
      🔴 THIS KEY WAS MISSING AND THE OWNER WAS MISREPORTED BECAUSE OF IT.
      `runIntake` caps a run at 300 items (Req 11.10) and, since 2026-08-21,
      returns what the cap left behind rather than dropping it in silence — but
      this handler destructured `{ scored, warnings, results }`, so the number
      reached nobody. A 312-item vault was told "looked at 300 items and
      re-ordered them by what matters most" with nothing indicating twelve
      accounts had not been looked at at all. The library had stopped lying and
      the product had not been told; forwarding it is the other half.

      `?? 0` rather than a passthrough: `remaining` is optional in IntakeResult
      (hand-built fixtures outside lib/ai), and an absent key would leave the
      screen unable to tell "nothing was left behind" from "this build cannot
      say" — which is the silence this exists to end. Tightening the type to
      required belongs with lib/ai/intake-agent.ts and its fixtures.
    */
    remaining: result.remaining ?? 0,
    warnings: result.warnings,
    results: result.results,
  });
}
