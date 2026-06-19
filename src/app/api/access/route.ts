/**
 * GET /api/access — Recipient access dashboard.
 *
 * Auth: a recipient JWT (Authorization: Bearer, or `?token=`). Returns the
 * recipient's scoped items — ranked full metadata when RELEASED, limited
 * descriptive fields otherwise (Req 7.3). Stale tokens (version mismatch) → 403.
 *
 * Feature: relay-h0-mvp
 * Requirements: 7.1–7.4, 7.6, 7.7
 */

import { NextResponse, type NextRequest } from 'next/server';
import { getAccessDashboard, AccessError } from '../../../../lib/access/dashboard';

export async function GET(req: NextRequest): Promise<NextResponse> {
  const authz = req.headers.get('authorization');
  const token = authz?.startsWith('Bearer ') ? authz.slice(7) : req.nextUrl.searchParams.get('token') ?? undefined;
  if (!token) {
    return NextResponse.json({ error: 'Unauthorized', message: 'Recipient token required' }, { status: 401 });
  }

  try {
    return NextResponse.json(await getAccessDashboard(token));
  } catch (err) {
    if (err instanceof AccessError) {
      return NextResponse.json({ error: 'AccessError', message: err.message }, { status: err.httpStatus });
    }
    throw err;
  }
}
