/**
 * Tests for the post-incident record (§8.2).
 *
 * ⚠️ THIS FILE DID NOT EXIST until 2026-08-12. `incident-record.ts` shipped as
 * the answer to "Margaret gets a record of exactly what was opened while she was
 * away" with no tests at all — the summary an owner reads after the worst week
 * of their life, unguarded. It is the derived sentence, so it cannot drift from
 * the log; it can still be WRONG about it, and was.
 *
 * Feature: relay-h0-mvp
 * Requirements: 8.6
 */

import { describe, it, expect } from 'vitest';

import { buildIncidents, describeIncident } from './incident-record';


describe('🔴 somebody looked, even though they opened nothing — 2026-08-12', () => {
  function view(actor: string, ts: string) {
    return { seq: 9, actor, action: 'recipient_dashboard_viewed', entity: 'release_state', entity_id: 'rs-1', detail: {}, ts };
  }

  it('says who looked rather than "Nothing was opened"', () => {
    // Walked on production: access was live, the recipient signed in and read
    // the titles of three accounts, and the owner's summary said nothing
    // happened. §8.2's failure shape one level in — the log held the fact and
    // the sentence dropped it.
    const incidents = buildIncidents(
      [
        { seq: 1, actor: 'owner:o-1', action: 'trigger_initiated', entity: 'release_state', entity_id: 'rs-1', detail: { trigger_type: 'emergency' }, ts: '2026-08-12T10:00:00Z' },
        view('recipient:r-1', '2026-08-12T10:05:00Z'),
        { seq: 3, actor: 'owner:o-1', action: 'owner_checkin', entity: 'release_state', entity_id: 'rs-1', detail: {}, ts: '2026-08-12T11:00:00Z' },
      ] as never,
      { personNames: new Map([['r-1', 'Jordan Rivera']]), itemTitles: new Map() },
    );

    const text = describeIncident(incidents[0]);
    expect(text).toContain('Jordan Rivera saw what was set aside');
    expect(text).not.toContain('Nothing was opened');
  });

  it('still says "Nothing was opened" when nobody even looked', () => {
    const incidents = buildIncidents(
      [
        { seq: 1, actor: 'owner:o-1', action: 'trigger_initiated', entity: 'release_state', entity_id: 'rs-1', detail: { trigger_type: 'emergency' }, ts: '2026-08-12T10:00:00Z' },
        { seq: 2, actor: 'owner:o-1', action: 'owner_checkin', entity: 'release_state', entity_id: 'rs-1', detail: {}, ts: '2026-08-12T11:00:00Z' },
      ] as never,
      { personNames: new Map(), itemTitles: new Map() },
    );
    // Either closed ("Nothing was opened, and it is closed again") or still
    // open ("Nothing has been opened so far") — what matters is that it does not
    // claim anybody saw anything.
    const text = describeIncident(incidents[0]);
    expect(text).toMatch(/Nothing (was|has been) opened/);
    expect(text).not.toContain('saw what was set aside');
  });

  it('counts one person once however many times they looked', () => {
    const incidents = buildIncidents(
      [
        { seq: 1, actor: 'owner:o-1', action: 'trigger_initiated', entity: 'release_state', entity_id: 'rs-1', detail: { trigger_type: 'emergency' }, ts: '2026-08-12T10:00:00Z' },
        view('recipient:r-1', '2026-08-12T10:05:00Z'),
        view('recipient:r-1', '2026-08-12T10:06:00Z'),
        view('recipient:r-1', '2026-08-12T10:07:00Z'),
      ] as never,
      { personNames: new Map([['r-1', 'Jordan Rivera']]), itemTitles: new Map() },
    );
    expect(incidents[0].viewedBy).toEqual(['Jordan Rivera']);
  });
});
