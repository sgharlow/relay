/**
 * "What happened while you were away" — the record §8.2 says we promise and
 * have never given.
 *
 * `src/app/how-it-works` tells customers: *"Margaret gets a record of exactly
 * what was opened while she was away."* The only surface was `/audit`, a raw
 * hash-chained table of `SEQ / TIME / ACTOR / ACTION / ENTITY / HASH`. The data
 * was all there, which is precisely why the gap survived: the log technically
 * satisfies the claim while answering none of the questions the person actually
 * has. §8.2 puts it as "a promise that outruns its implementation".
 *
 * IT MATTERS MORE UNDER THIS ARCHITECTURE THAN BEFORE. The post-incident record
 * is the emotional payoff of the whole reversibility story — the thing that
 * turns "access closed itself" from an absence into evidence of control. An
 * owner coming back from hospital does not want to verify a hash chain. They
 * want to know: did it open, who opened it, what did they see, and is it shut
 * now.
 *
 * DERIVED, NEVER STORED. Episodes are reconstructed from the append-only log on
 * every read, so this cannot drift from the record it summarises and adds no
 * second source of truth. The raw table stays exactly as it was underneath —
 * this is a reading of it, not a replacement, and somebody who wants to verify
 * the chain still can.
 *
 * Feature: relay-standby
 * Requirements: 8.6, J9-R4
 */

export interface IncidentEntry {
  seq: number;
  actor: string;
  action: string;
  entity_id: string | null;
  detail: Record<string, unknown> | null;
  ts: string;
}

export interface OpenedItem {
  title: string;
  at: string;
}

export interface Incident {
  startedAt: string;
  /** Null while it is still open — which is itself the headline. */
  endedAt: string | null;
  triggerType: string | null;
  /** Names, not ids. An owner should never be shown a UUID about their family. */
  confirmedBy: string[];
  /** Only what was actually decrypted, deduplicated, in the order opened. */
  opened: OpenedItem[];
  /** True when the owner's own check-in or stand-down closed it. */
  closedByOwner: boolean;
  /** A denial halted it before anything opened. */
  halted: boolean;
  /** Nothing was opened at all — common, and worth saying out loud. */
  nothingOpened: boolean;
  /**
   * Somebody LOOKED, even if they revealed nothing.
   *
   * 🔴 ADDED 2026-08-12, after walking a full release on production and reading
   * the summary it produced: "Nothing was opened, and it is closed again." The
   * recipient had signed in, seen their access plan, and read the TITLES of
   * three accounts — Gmail, Chase Bank, Blue Cross — and the sentence an owner
   * gets says nothing happened.
   *
   * `recipient_dashboard_viewed` was already in the log. This is §8.2's failure
   * shape exactly, one level in: the record technically holds the fact while the
   * experience omits it, which is why the audit summary was built in the first
   * place.
   */
  viewedBy: string[];
}

/** `verifier:<uuid>` → "Dr. Alex Chen", falling back to something human. */
function nameOf(actor: string, names: Map<string, string>): string {
  const id = actor.includes(':') ? actor.slice(actor.indexOf(':') + 1) : actor;
  return names.get(id) ?? (actor.startsWith('verifier') ? 'someone you trusted' : 'someone');
}

/**
 * Walk the log in sequence, attributing events to the episode that is open.
 *
 * Attribution is POSITIONAL rather than by id because `vault_item_decrypted`
 * records the item it opened, not the release it belonged to — so the only
 * honest link between an opening and an episode is that the opening happened
 * while that episode was open. That is also exactly what the sentence claims.
 */
export function buildIncidents(
  entries: IncidentEntry[],
  lookups: { itemTitles: Map<string, string>; personNames: Map<string, string> },
): Incident[] {
  const incidents: Incident[] = [];
  let current: Incident | null = null;

  const ordered = [...entries].sort((a, b) => a.seq - b.seq);

  for (const e of ordered) {
    const startsOne =
      e.action === 'trigger_initiated' || e.action === 'request_escalated_to_verifiers';

    if (startsOne && !current) {
      current = {
        startedAt: e.ts,
        endedAt: null,
        triggerType: typeof e.detail?.trigger_type === 'string' ? e.detail.trigger_type : null,
        confirmedBy: [],
        opened: [],
        viewedBy: [],
        closedByOwner: false,
        halted: false,
        nothingOpened: true,
      };
      incidents.push(current);
      continue;
    }

    if (!current) continue;

    if (e.action === 'verifier_confirmed') {
      const who = nameOf(e.actor, lookups.personNames);
      if (!current.confirmedBy.includes(who)) current.confirmedBy.push(who);
      continue;
    }

    if (e.action === 'vault_item_decrypted' && e.detail?.outcome === 'authorized') {
      const title = (e.entity_id && lookups.itemTitles.get(e.entity_id)) || 'An item';
      // Opening the same thing three times is one thing they saw, not three.
      if (!current.opened.some((o) => o.title === title)) {
        current.opened.push({ title, at: e.ts });
      }
      current.nothingOpened = false;
      continue;
    }

    if (e.action === 'recipient_dashboard_viewed') {
      const who = nameOf(e.actor, lookups.personNames);
      if (!current.viewedBy.includes(who)) current.viewedBy.push(who);
      continue;
    }

    if (e.action === 'release_halted_by_denial') {
      current.halted = true;
      continue;
    }

    // Closing edges. `owner_checkin` and `trigger_stood_down` are the owner's
    // own act; a safe reset is the machine failing closed, which is still a
    // close but not something to congratulate them for.
    if (
      e.action === 'release_transition_armed' ||
      e.action === 'trigger_stood_down' ||
      e.action === 'release_safe_reset_armed' ||
      e.action === 'trigger_cancelled'
    ) {
      current.endedAt = e.ts;
      current.closedByOwner =
        e.action === 'trigger_stood_down' || e.action === 'release_transition_armed';
      current = null;
    }
  }

  // Newest first: the thing somebody wants when they open this page is the last
  // thing that happened, not the first.
  return incidents.reverse();
}

/**
 * The sentence itself, written for somebody who has just got home.
 *
 * Kept next to the builder rather than in the component so the wording is
 * testable — this is the one paragraph in the product that has to be right
 * after the worst week of somebody's life.
 */
export function describeIncident(i: Incident): string {
  const when = new Date(i.startedAt).toLocaleDateString();

  if (i.halted) {
    return `On ${when} someone asked for access and one of the people you trust said no. Nothing opened.`;
  }

  const who =
    i.confirmedBy.length === 0
      ? 'nobody confirmed it'
      : i.confirmedBy.length === 1
        ? `${i.confirmedBy[0]} confirmed it was real`
        : `${i.confirmedBy.slice(0, -1).join(', ')} and ${i.confirmedBy.at(-1)} confirmed it was real`;

  if (i.nothingOpened) {
    /*
      🔴 "Nothing was opened" WAS SAID EVEN WHEN SOMEBODY HAD LOOKED, corrected
      2026-08-12 by reading the sentence a real release produced. Access had been
      live, the recipient had signed in, and they had seen the TITLES of three
      accounts — and the owner's summary told them nothing happened.

      Seeing what is set aside and revealing what is inside are genuinely
      different, and the distinction is worth keeping. Collapsing them to
      "nothing" is not.
    */
    const looked =
      i.viewedBy.length === 1
        ? `${i.viewedBy[0]} saw what was set aside for them but did not open any of it`
        : `${i.viewedBy.join(' and ')} saw what was set aside for them but opened none of it`;

    if (i.viewedBy.length > 0) {
      return i.endedAt
        ? `On ${when} an emergency was raised and ${who}. ${looked}, and it is closed again.`
        : `On ${when} an emergency was raised and ${who}. ${looked}. This is still open.`;
    }

    return i.endedAt
      ? `On ${when} an emergency was raised and ${who}. Nothing was opened, and it is closed again.`
      : `On ${when} an emergency was raised and ${who}. Nothing has been opened so far.`;
  }

  const count = i.opened.length;
  const things = `${count} ${count === 1 ? 'thing' : 'things'}`;

  return i.endedAt
    ? `On ${when} an emergency was raised, ${who}, and ${things} you had set aside ${count === 1 ? 'was' : 'were'} opened. It is closed again now.`
    : `On ${when} an emergency was raised, ${who}, and ${things} you had set aside ${count === 1 ? 'has' : 'have'} been opened. This is still open.`;
}
