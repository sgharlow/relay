/**
 * The comparison matrix — factual claims about named companies.
 *
 * ⚠️ EVERY CELL IN THE COMPETITOR COLUMNS IS A PUBLIC CLAIM ABOUT SOMEONE
 * ELSE'S PRODUCT. Getting one wrong is a legal and reputational risk, and this
 * page is read by ad reviewers. Three rules, and they are not negotiable:
 *
 *   1. Assert only what the vendor PUBLISHES. Where a capability is simply not
 *      offered, say so. Where we do not know, the cell is `unknown` — never a
 *      guess dressed as a cross.
 *   2. Compare capabilities, never quality. No sneering; a reader deciding
 *      between these deserves a straight answer, not a pitch.
 *   3. Include rows Relay LOSES. A matrix where the new product wins
 *      everything convinces nobody, and the honest losses are what make the
 *      wins believable.
 *
 * VERIFIED 2026-08-08 against vendor documentation. Two claims inherited from
 * docs/COMPETITORS.md (authored 2026-07-01) were WRONG and are corrected here:
 * Bitwarden's Emergency Access is Premium-only, not free; and 1Password has no
 * emergency-access feature at all — its "Emergency Kit" is a printed PDF of
 * your own credentials, which is a different thing entirely. Re-verify before
 * changing any cell.
 *
 * Feature: relay-g1-wtp
 */

export type Cell = 'yes' | 'no' | 'partial' | 'unknown';

export interface ComparisonColumn {
  key: string;
  /** What a caregiver would call it, not the vendor's marketing name. */
  label: string;
  sublabel: string;
}

/**
 * Four alternatives, chosen as the four real CHOICES a caregiver faces rather
 * than four brands. Everplans, GoodTrust and Trustworthy are one category, so
 * listing all three would pad the table without informing anyone — and the
 * fourth column is what most families genuinely do today.
 */
export const COLUMNS: ComparisonColumn[] = [
  { key: 'relay', label: 'Relay', sublabel: '$119/year' },
  { key: 'organizer', label: 'Everplans', sublabel: 'The organizer · $99.99/year' },
  { key: 'pwmgr', label: 'Bitwarden Emergency Access', sublabel: 'The password manager · Premium only' },
  { key: 'platform', label: 'Apple / Google legacy features', sublabel: 'The phone · free' },
  { key: 'notebook', label: 'A shared note or password list', sublabel: 'What most families do · free' },
];

export interface ComparisonRow {
  question: string;
  /** Shown under the question when the distinction needs a sentence. */
  note?: string;
  cells: Record<string, Cell>;
  /** Marks rows where Relay is not the winner, so they are never quietly cut. */
  relayLoses?: boolean;
}

export const ROWS: ComparisonRow[] = [
  {
    question: 'Works while they are alive but cannot manage things',
    note: 'A stroke, a long hospital stay, dementia. Apple requires a death certificate before a legacy contact can request access.',
    cells: { relay: 'yes', organizer: 'yes', pwmgr: 'yes', platform: 'no', notebook: 'yes' },
  },
  {
    question: 'Someone has to confirm the situation is real',
    note: 'Bitwarden uses a waiting period you set (1 hour to 7 days) — if nobody declines, access opens on a timer rather than on a person confirming.',
    cells: { relay: 'yes', organizer: 'no', pwmgr: 'partial', platform: 'no', notebook: 'no' },
  },
  {
    question: 'Access can be taken back afterwards',
    note: 'They recover, they check in, and what opened closes again on its own.',
    cells: { relay: 'yes', organizer: 'no', pwmgr: 'no', platform: 'no', notebook: 'no' },
  },
  {
    question: 'Each person sees only what you chose for them',
    note: 'Rather than the whole vault, or the whole account, or the whole notebook.',
    cells: { relay: 'yes', organizer: 'partial', pwmgr: 'no', platform: 'no', notebook: 'no' },
  },
  {
    question: 'Covers accounts across everything they use',
    note: 'Not just one company’s ecosystem, and not just passwords.',
    cells: { relay: 'yes', organizer: 'yes', pwmgr: 'partial', platform: 'no', notebook: 'yes' },
  },
  {
    question: 'A record of who opened what, and when',
    cells: { relay: 'yes', organizer: 'unknown', pwmgr: 'unknown', platform: 'no', notebook: 'no' },
  },
  {
    question: 'Guided planning: templates, checklists, what to gather',
    note: 'Everplans is genuinely better at this. If what you want is help thinking it through, start there.',
    cells: { relay: 'no', organizer: 'yes', pwmgr: 'no', platform: 'no', notebook: 'no' },
    relayLoses: true,
  },
  {
    question: 'Already set up, nothing new to buy',
    cells: { relay: 'no', organizer: 'no', pwmgr: 'partial', platform: 'yes', notebook: 'yes' },
    relayLoses: true,
  },
  {
    question: 'Years of track record behind it',
    note: 'Relay is new. Everyone else in this table has been doing it longer, and that is a real reason to choose them.',
    cells: { relay: 'no', organizer: 'yes', pwmgr: 'yes', platform: 'yes', notebook: 'unknown' },
    relayLoses: true,
  },
];

export const VERIFIED_ON = '8 August 2026';

/** Rendered mark for each cell state. `unknown` must never look like a "no". */
export const CELL_MARK: Record<Cell, { mark: string; label: string }> = {
  yes: { mark: '●', label: 'Yes' },
  no: { mark: '—', label: 'No' },
  partial: { mark: '◐', label: 'Partly' },
  unknown: { mark: '?', label: 'Not published' },
};
