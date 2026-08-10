/**
 * The ad platform's own identifier for the click you paid for.
 *
 * `src` is the channel WE tagged — useful, and the only thing the gate ratio
 * needs. A click ID is different: it is the platform's identifier for one
 * specific click, which is what lets you say "this lead came from the second
 * creative in the caregiving-interest set" rather than "reddit produced 40
 * leads", and what makes an offline conversion upload possible at all.
 *
 * It exists on the landing URL and nowhere afterwards, so it has to be parked
 * exactly the way the channel is: a visitor arrives on
 * /caregivers?src=reddit-ads&rdt_cid=…, reads, clicks through, and only then
 * submits on a page whose URL has never seen the ID.
 *
 * NOT A COOKIE, AND NOT A THIRD PARTY. sessionStorage, dying with the tab, sent
 * only to our own API. The privacy page states plainly that there are no
 * advertising or tracking cookies on this site, and that stays literally true —
 * which is worth more on a product asking for a parent's credentials than the
 * delivery optimisation a pixel would buy on a $250 test.
 *
 * Feature: relay-g1-wtp
 * Requirements: J1-R10
 */

export const CLICK_ID_STORAGE_KEY = 'relay.g1.clickid';

export interface ClickId {
  /** Which ad platform sold the click. */
  platform: string;
  /** Their identifier for it, verbatim. */
  id: string;
}

/**
 * Ordered, because a URL carrying two IDs is a mis-tagged campaign or a
 * redirect chain — and guessing which one was paid for would invent
 * attribution. First match wins, deterministically.
 *
 * gbraid and wbraid are not optional extras: Google sends them INSTEAD of gclid
 * for iOS traffic, which is a large share of this audience. Reading only gclid
 * makes that traffic look like it arrived with no click ID at all.
 */
const PARAMS: ReadonlyArray<readonly [param: string, platform: string]> = [
  ['gclid', 'google'],
  ['gbraid', 'google'],
  ['wbraid', 'google'],
  ['fbclid', 'meta'],
  ['rdt_cid', 'reddit'],
  ['msclkid', 'microsoft'],
  ['ttclid', 'tiktok'],
];

/** Stored and echoed back, so it is bounded. */
const MAX_LENGTH = 255;

export function clickIdFrom(search: string): ClickId | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }

  for (const [param, platform] of PARAMS) {
    const raw = params.get(param);
    if (!raw) continue;
    const id = raw.trim().slice(0, MAX_LENGTH);
    if (!id) continue;
    return { platform, id };
  }
  return null;
}

export function rememberClickId(clickId: ClickId | null): void {
  // A later untagged navigation must not erase the click that was paid for —
  // the same rule the channel already follows, and the same bug it once had.
  if (!clickId) return;
  try {
    window.sessionStorage.setItem(CLICK_ID_STORAGE_KEY, JSON.stringify(clickId));
  } catch {
    /* Storage unavailable (private mode, quota). Attribution is worth less than
       the page, so this never throws into a render. */
  }
}

export function recallClickId(): ClickId | null {
  try {
    const raw = window.sessionStorage.getItem(CLICK_ID_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClickId>;
    if (typeof parsed?.platform !== 'string' || typeof parsed?.id !== 'string') return null;
    if (!parsed.platform || !parsed.id) return null;
    return { platform: parsed.platform, id: parsed.id };
  } catch {
    // Corrupt storage must not break the conversion page — losing attribution
    // is a bad afternoon; a broken submit button is a lost lead.
    return null;
  }
}
