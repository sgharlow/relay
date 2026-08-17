/**
 * G1 lane 1 — Google Ads search intent. THE authoritative definition.
 *
 * WHY THIS IS CODE AND NOT A MARKDOWN TABLE. `docs/g1-ad-creatives.md` §1b exists
 * because "the ads do not fit the fields as drafted" — every Meta headline in the
 * original draft overflowed, and the fix was to write the character count beside
 * each field so a later edit could be checked without re-deriving it. That is a
 * promise about a number in prose, and prose drifts. Today's sprint found the
 * same shape twice more: a free-plan cap hand-copied into eleven places, and an
 * image palette whose hexes were migrated while the English was not.
 *
 * So the copy that will be pasted into Google lives here, as data, and
 * `lib/ops/google-lane.test.ts` measures it against Google's real field limits.
 * An overflow is not a soft failure — Google truncates mid-word and the ad still
 * serves.
 *
 * 🔴 WHY SEARCH, AND WHY THIS LANE EXISTS AT ALL. Reddit was lane 1 until
 * 2026-08-16, when it turned out to sell no caregiver targeting whatsoever:
 * `dementia` and `Alzheimers` refused on ToS as health-condition targeting, and
 * r/AgingParents, r/CaregiverSupport and r/eldercare simply absent from the
 * targetable index. Full record: `PROJECT.yaml`
 * `ratified.g1-lane-1-is-google-search-intent`.
 *
 * Search does not have that wall, and the reason is worth stating because it
 * also constrains how this campaign may be built. Google's health restrictions
 * (adspolicy/answer/16701855, read from the primary source 2026-08-16) apply to
 * ADVERTISER-CURATED AUDIENCES — customer match, data segments, audience
 * expansion, lookalikes. They do not restrict keyword targeting in Search. A
 * query is something a person typed; an audience is an inference about who they
 * are. So this lane targets queries and MUST NOT attach an audience segment.
 *
 * Feature: relay-g1-wtp
 */

/** Google's Responsive Search Ad field limits. Not ours to negotiate. */
export const GOOGLE_LIMITS = {
  headlineChars: 30,
  descriptionChars: 90,
  minHeadlines: 3,
  maxHeadlines: 15,
  minDescriptions: 2,
  maxDescriptions: 4,
  displayPathChars: 15,
} as const;

/**
 * The only URL the ad points at.
 *
 * `?src=google-ads` IS THE MEASUREMENT. `GATE_LANES` in
 * src/app/caregivers/content.ts is an allow-list, so a URL without this
 * parameter — or with it misspelled — reads as `direct`, counts toward nothing,
 * and the spend buys a number of exactly zero. That failure is silent, which is
 * why it is pinned by a test rather than checked by eye at the sitting.
 */
export const FINAL_URL = 'https://relaystandby.com/caregivers?src=google-ads';

/** Shown under the headline. Cosmetic, but it is 2 × 15 characters and it truncates. */
export const DISPLAY_PATH = ['family', 'access'] as const;

/**
 * Headlines. Third person throughout, per §1a — never "you" joined to a health
 * event or a relative's condition. Google surfaces three at a time in an order
 * it chooses, so each one has to stand alone and none may contradict another.
 */
export const HEADLINES = [
  'Emergency Account Access',
  'It Opens. Then It Closes.',
  'Reversible Family Access',
  'Encrypted In The Browser',
  'Seals Itself On Check-In',
  'Not Password Sharing',
  'One Price, Whole Family',
  'For Families, Not Estates',
  'Verified Before It Opens',
  'Set It Up In An Afternoon',
] as const;

/**
 * Descriptions. Two are always shown; four is the maximum Google accepts.
 *
 * The price and the free cap are deliberately NOT written here as literals that
 * could drift — they are composed from the product's own values by
 * `pricedDescriptions()` below, and the test proves the composition still fits
 * inside 90 characters at the CURRENT price. A price change that would overflow
 * the field fails the build instead of truncating mid-sentence in a live ad.
 */
export const DESCRIPTIONS = [
  'Access opens only when a real emergency is verified, and seals when they check in.',
  'The reversible alternative to sharing every password with everyone, forever.',
  'Trusted contacts confirm the emergency. They never see what is inside.',
] as const;

/** Built from the product's own numbers, never from a literal typed twice. */
export function pricedDescription(priceYearlyUsd: number): string {
  return `$${priceYearlyUsd}/yr for the whole family, with a 30-day money-back guarantee.`;
}

export function freePlanHeadline(freeItems: number): string {
  return `First ${freeItems} Accounts Free`;
}

/**
 * KEYWORDS — phrase and exact only.
 *
 * ⚠️ NO BROAD MATCH. Broad match without conversion tracking is a budget
 * incinerator: Google widens to whatever it thinks is related, there is no
 * signal telling it what "good" looks like, and every widened click still enters
 * the denominator tagged `google-ads`. The gate kills below 0.5%, so paying to
 * widen the denominator is paying to kill the product.
 *
 * The themes are the wedge stated as things a person actually types at the
 * moment the need appears. That moment is a SITUATION, not a demographic, which
 * is the whole reason search fits this product better than interest targeting.
 */
/*
  ⚠️ REPLACED 2026-08-16 WITH TERMS THAT MEASURABLY EXIST.

  The first draft of this list was written from the wedge as we describe it, and
  Keyword Planner then reported FOUR of the five seeds at 0–10 searches per month
  in the US. Those were invented phrasings — plausible, well-formed, and typed by
  almost nobody. Bidding on a keyword with no volume is not a cheap experiment,
  it is a campaign that never serves.

  Every term below carries its measured US volume (Aug 2025 – Jul 2026). The two
  clusters are the only ones with any volume at all, and both are small. See the
  banner at the top of docs/g1-google-lane.md for what that means for the gate:
  the honest total is ~330/month at midpoint, and N ≥ 100 is out of reach inside
  the window. The list is kept correct so that IF this lane ever runs it bids on
  language people actually use, not language we invented.
*/
export const KEYWORD_THEMES = [
  {
    theme: 'managing an ageing parent’s money — the only cluster with real volume',
    keywords: [
      '"handling elderly parents finances how to"', // 10–100/mo
      '"managing elderly finances"', //                10–100/mo, CPC $3.03–$8.61
      '"managing finances for elderly parents"', //    10–100/mo
      '"managing parents finances"', //                10–100/mo
    ],
  },
  {
    theme: 'sharing credentials with family — small, and semantically contested',
    keywords: [
      '"share passwords with family"', //  10–100/mo — the strongest single term
      '"family sharing passwords"', //     10–100/mo
      '"lastpass emergency"', //           10–100/mo — competitor emergency-access intent
    ],
  },
] as const;

/**
 * NEGATIVE KEYWORDS — the half that decides whether this lane measures anything.
 *
 * Three populations type these queries and only one of them is the customer.
 *
 * 1. 🔴 ESTATE. `PROJECT.yaml` gates.g2-counsel-opinion.declined withdrew estate
 *    from the product PERMANENTLY — "estate stays out of USER_SELECTABLE_TRIGGER
 *    _TYPES permanently, now enforced as a closed door rather than a pending
 *    one" — and src/app/terms/page.tsx states it is not offered. Paying for a
 *    click from somebody searching probate is paying to send a person to a page
 *    that refuses them. It also pollutes the denominator with demand the product
 *    has decided not to serve, which biases the gate toward a kill on the wedge
 *    it IS serving.
 *
 * 2. 🔴 FRAUD. "How do I get into my mother's bank account" is typed by devoted
 *    daughters and by people planning to empty it. Nothing in an ad can tell
 *    them apart, and the second group costs money and converts at zero.
 *
 * 3. JOB SEEKERS. Caregiving is an occupation. Reddit's own index tagged its one
 *    caregiving community as "Career" — a useful reminder that "caregiver" is a
 *    job title at least as often as it is a family role.
 */
export const NEGATIVE_KEYWORDS = [
  // 1 — estate, withdrawn from the product permanently
  'estate', 'estate planning', 'inheritance', 'probate', 'executor', 'last will',
  'will template', 'deceased', 'after death', 'when someone dies', 'funeral',
  'digital legacy', 'legacy contact', 'beneficiary',
  // 2 — fraud and lockout intent
  'hack', 'crack', 'bypass', 'without permission', 'steal', 'forgot my password',
  'password reset', 'unlock account', 'recover my account',
  // 3 — job seekers and benefit seekers
  'jobs', 'job', 'hiring', 'salary', 'career', 'certification', 'training',
  'medicaid', 'medicare', 'insurance', 'benefits', 'grant', 'financial assistance',
  // 4 — facility shoppers, who look adjacent and are not this product
  'nursing home cost', 'assisted living cost', 'care home near me',
  // 5 — freeloaders on a paid-intent test
  'free', 'freeware', 'open source', 'diy', 'github', 'download',
  /*
    6 — ENTERPRISE INFOSEC. Added 2026-08-16 after Google's own onboarding
    auto-classified this business as "Network Security", which would have dropped
    Relay into the VPN / firewall / antivirus / SOC auction: B2B IT, $15–40 CPCs,
    and no overlap whatsoever with a daughter managing her father's accounts. The
    mis-classification was corrected at the source, and these are the belt to that
    braces — the same word that fooled Google's classifier can appear in a query.
  */
  'vpn', 'firewall', 'antivirus', 'ransomware', 'pentest', 'penetration testing',
  'soc 2', 'enterprise', 'for business',
  /*
    7 — MEDICAL ALERT DEVICES. Google's onboarding ALSO guessed "Medical Alarms"
    and "Hospice & Home Nursing Care" from the landing page, which is a direct
    warning about the neighbourhood this copy reads into. Relay is software; a
    click from someone shopping for a fall-detection pendant is a wasted click and
    a confused visitor.
  */
  'life alert', 'fall detection', 'medical alert', 'panic button', 'hospice',
  // 8 — professional services, adjacent to the estate exclusion above
  'attorney', 'lawyer', 'law firm', 'life insurance', 'notary',
] as const;

/**
 * Campaign settings that are NOT defaults and each cost money if missed.
 *
 * Every one of these was a default that would have been wrong, which is the same
 * lesson the Reddit sitting taught in a more expensive form: the platform's
 * out-of-the-box configuration is built to spend, not to measure.
 */
export const CAMPAIGN_SETTINGS = {
  type: 'Search',
  goal: 'none — "Create a campaign without a goal\'s guidance"',
  searchPartners: false,
  displayNetwork: false,
  audienceSegments: 'none — health restrictions forbid curated audiences, and an audience would change what the keyword is measuring',
  bidding: 'Maximize clicks WITH a maximum CPC bid limit',
  locations: 'United States, "Presence: people in or regularly in" — NOT "interest in"',
  language: 'English',
  adRotation: 'Do not optimize — rotate indefinitely',
} as const;
