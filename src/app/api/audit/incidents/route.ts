/**
 * GET /api/audit/incidents — "what happened while you were away" (§8.2).
 *
 * Derived from the append-only log on every read, so it cannot drift from the
 * record it summarises. The raw entries stay available at /api/audit; this is a
 * reading of them, not a replacement.
 *
 * Metadata only — item TITLES, never ciphertext (CC2). The whole point is to
 * say what was opened, and a title is the least that can mean.
 *
 * Feature: relay-standby
 * Requirements: 8.6, J9-R4
 */

import { NextResponse } from 'next/server';

import { requireOwner, isResponse } from '../../../../../lib/http/owner-route';
import { query } from '../../../../../lib/db/connection';
import { buildIncidents, describeIncident } from '../../../../../lib/audit/incident-record';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const auth = await requireOwner();
  if (isResponse(auth)) return auth;

  const [entries, items, recipients, verifiers] = await Promise.all([
    query<{
      seq: number;
      actor: string;
      action: string;
      entity_id: string | null;
      detail: Record<string, unknown> | null;
      ts: string;
    }>(
      `SELECT seq, actor, action, entity_id, detail, ts
         FROM audit_log WHERE owner_id = $1 ORDER BY seq ASC`,
      [auth.ownerId],
    ),
    query<{ id: string; title: string }>(
      `SELECT id, title FROM vault_items WHERE owner_id = $1`,
      [auth.ownerId],
    ),
    query<{ id: string; name: string }>(
      `SELECT id, name FROM recipients WHERE owner_id = $1`,
      [auth.ownerId],
    ),
    query<{ id: string; name: string }>(
      `SELECT id, name FROM verifiers WHERE owner_id = $1`,
      [auth.ownerId],
    ),
  ]);

  // One map for both roles: an actor id is unique across them, and the sentence
  // only ever needs a human name.
  const personNames = new Map<string, string>();
  for (const r of [...recipients.rows, ...verifiers.rows]) personNames.set(r.id, r.name);

  const incidents = buildIncidents(entries.rows, {
    itemTitles: new Map(items.rows.map((i) => [i.id, i.title])),
    personNames,
  });

  return NextResponse.json({
    incidents: incidents.map((i) => ({ ...i, summary: describeIncident(i) })),
  });
}
