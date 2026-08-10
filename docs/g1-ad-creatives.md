# G1 ad creatives — paste-ready (drafted 2026-08-07)

> For the **paid lanes only**. Per the 2026-07-03 channel-rules audit, the no-AI-content rules
> apply to organic participation in r/AgingParents and r/CaregiverSupport — **ads and owned
> channels have no such constraint**, so these are Claude-drafted by design. Any organic comment
> in those two subreddits must still be written in Steve's own voice.
>
> Budget ceiling **$250** and lane structure: `g1-channel-send-kit.md`. Thresholds and metric
> definitions: `g1-wtp-test-design.md`. Do not restate numbers from those here.

---

## ✅ Destination — live and clear to book (re-verified 2026-08-09)

**`relaystandby.com` is purchased, pointed at Vercel, and serving.** This section previously read
"it is not purchased yet" and told you not to book a flight; that was true on 2026-08-07 and false
by 2026-08-08. Measured this session, not inferred:

| Check | Result |
|---|---|
| `https://relaystandby.com/caregivers?src=…` | **200** |
| `https://relaystandby.com/caregivers/interest?src=…&cta=…` | **200** |
| `/terms`, `/privacy` (required by both ad platforms) | **200**, footer-linked |
| `/robots.txt`, `/sitemap.xml` | **200** |
| `relay-three-henna.vercel.app` | **308 → relaystandby.com** — the old surface no longer splits traffic |

The old vercel.app subdomain concern is closed: the display URL in every ad is now the real domain.
**No domain confound needs recording in the verdict line.**

**Known artifact, not a bug:** the DNS records are grey-cloud (DNS-only) at Cloudflare, so
Cloudflare's own analytics shows ~0 requests for this domain. That is proxy visibility, and it cost
an investigation once already. G1 reads from **Vercel Web Analytics**, which is unaffected.

---

## Pre-flight findings (audited 2026-08-07, before any spend)

### 1. Ad-policy compliance — self-check before submitting

Both platforms require a privacy policy for advertisers. **`/privacy` and `/terms` now exist and
are linked from the landing footer** — they did not before this audit, and the ad accounts would
likely have been rejected.

Checked against the categories that actually get creatives rejected:

| Policy area | Our position |
|---|---|
| Privacy policy present and linked | ✅ `/privacy`, footer-linked on the ad destination |
| Personal-attribute targeting | ✅ Copy never asserts the reader's health or family situation; it describes a scenario |
| Health claims | ✅ None. Hospitalisation is context, not a medical claim |
| Financial-service claims | ✅ We never claim to move money, hold funds, or be a financial institution |
| Testimonials / social proof | ✅ None used — we have no customers, and the creatives say nothing implying otherwise |
| Certifications / trust badges | ✅ None claimed. The only badge is a hackathon award, which is true and verifiable |
| Urgency manufacturing | ✅ No countdowns, no "act now", no scarcity |
| Data-collection disclosure | ✅ The landing collects nothing; signup is opt-in and disclosed |
| Destination matches ad | ✅ Every creative lands on `/caregivers`, which carries the same claim and price |

**The dry run is still worth doing.** Submit **R1 alone**, on a small budget, and let review pass or
reject it before building out the flight. Policy review is free and is the only authoritative
signal — this table is a self-assessment, not an approval.

### 2. Email deliverability — transport PROVEN; third-party delivery still unproven

**Confirmed 2026-08-07:** a test email sent through the app's own boundary was **received in the
Gmail inbox (not spam)** at `sgharlow@gmail.com`. The full path works —
`notifyX → sendEmail → Resend → a real inbox`.

That was only discoverable after fixing a bug in `sendEmail`, which never inspected the Resend
response. The SDK resolves with `{ data, error }` rather than throwing, so every rejected send was
reported as a success and `sendEmailBestEffort` never logged. The first test email was in fact
**rejected** and reported delivered. With the error surfaced:

| Recipient | Result |
|---|---|
| `sgharlow@gmail.com` (the Resend account address) | ✅ accepted, and received in the inbox |
| `sgharlow+relay@gmail.com` | ❌ rejected — a `+` alias is a DIFFERENT address to Resend |
| any third party | ❌ rejected — test mode permits only the account's own address |

**✅ CLOSED 2026-08-08 — the required work below was done.** `relaystandby.com` is verified in
Resend, `RESEND_FROM_ADDRESS=relay@relaystandby.com` is set in Vercel production (value confirmed
this session by `vercel env pull`, since the env listing shows only that a variable exists), and
SPF/DKIM/DMARC are published. A send to a **different domain that is not the Resend account
address** was accepted — the exact case the old shared-domain sender rejected outright. The
original text is kept below because the failure mode it describes is the one to re-check if the
sender is ever changed again.

⚠️ Two live traps this left behind: Windows `nslookup` reports the DMARC TXT record as **absent** —
a false negative; use node's `dns.resolveTxt`. And Yahoo-operated domains (including cox.net) do
not support `+tag` addressing, so a bounce there is not a DMARC problem.

⚠️ Still true: `relaystandby.com` has **no MX**, so mail can be sent from it but not received. The
public contact address is deliberately a personal Gmail until Cloudflare Email Routing exists —
see `docs/email-dns-runbook.md` §2. **This does not block either lane.**

ORIGINAL NOTE FOLLOWS.

**What is still unproven:** delivery to anyone who is not Steve. The sender is
`onboarding@resend.dev`, Resend's shared test domain, and shared-domain reputation is precisely
what causes spam-foldering on third-party inboxes. A successful send to your own address does not
predict that.

**Required before Lane B works past signup**, and before any invitation, owner challenge or
verifier request reaches a real person: verify `relaystandby.com` in Resend, add the generated
SPF/DKIM records in Cloudflare beside the existing A/CNAME, and set
`RESEND_FROM_ADDRESS=relay@relaystandby.com`. Then repeat this test to a recipient address that is
NOT Steve's — that is the only send that proves the notification layer.

**Lane A remains unaffected** — its conversion is an inbound `mailto:` that Steve receives, and it
does not depend on our sending at all.

### 3. Ad-blocker exposure — low, and the ratio is structurally safe

Verified on the live page: the analytics script is served **first-party** from
`https://relaystandby.com/b079b94dacb289b4/script.js` — same origin, randomized path — and there
are **zero third-party trackers**. Blocklists target known third-party tracker domains and paths,
so this configuration largely evades them.

More importantly, the gate metric is a **ratio**. Any blocking that occurs suppresses the numerator
and denominator together, so click-to-intent survives it. What blocking costs is *speed*: N
accumulates more slowly than the ad platform's click count suggests.

**Do not read a gap between platform clicks and N as broken measurement.** Cross-check N against
the pageview count for `/caregivers` in Vercel Analytics; a modest shortfall is expected and
benign.

---

## Claim discipline — what these ads may and may not say

Everything below is limited to what is built and live-proven. Nothing here needs a lawyer.

**Safe to claim (all live-verified):**
- Encrypted in the browser; the server only ever holds ciphertext.
- Access opens on a verified trigger and **closes itself** when the owner checks in.
- Trusted contacts confirm a trigger; they never see vault contents.
- Every open and release lands in a hash-chained audit log.
- Winner, Most Impactful — H0 Hackathon 2026.
- $119/yr, one price. Free plan keeps the first 10 items.
- **30-day money-back guarantee** (ratified 2026-08-09; `lib/offer.ts` is the single definition,
  and it is on the Terms and both price cards). Say "30-day money-back guarantee" — do not
  paraphrase it into "free trial", which is a different product and is not what is built.
- Cancel yourself at any time from the account page — this is a real self-serve button through
  Stripe's hosted portal, live-proven on production 2026-08-09, not an email-us process.

**Must NOT appear:**
- Any testimonial, customer count, "trusted by N families" — there are none.
- Estate/inheritance/legal-authority promises — **G2 counsel has not cleared**; estate is not
  built for a paying customer. Keep every creative on the *emergency/incapacity* case.
- Certifications, audits, compliance badges (no SOC 2, no pen test, no KYC).
- Medical or urgency-manufacturing claims — both platforms police this, and the caregiver
  audience is the wrong one to pressure.

---

## Reddit Ads — primary lane

**Destination:** `https://relaystandby.com/caregivers?src=reddit-ads`
**Objective:** Traffic · **Format:** Promoted post (text-tolerant)
**Targeting:** audiences of r/AgingParents, r/CaregiverSupport, r/Alzheimers, r/dementia,
r/eldercare. Interest-based, not subreddit posting — ads are platform-sanctioned and do not
violate those subs' promotion rules.

### R1 — the reversibility hook *(lead with this)*

> **Title:** Emergency access to a parent's accounts — that closes itself when they recover
>
> **Body:**
> Most families solve "what if something happens to Mom" the only way they know how: share every
> password with everyone, forever. That works right up until it doesn't, and it can't be undone.
>
> Relay is the reversible version. Your parent keeps control. If they're hospitalised, it opens
> exactly what you were granted — and when they check back in, it seals itself again.
>
> Encrypted in your browser, so we only ever hold ciphertext. Trusted contacts confirm a real
> emergency; they never see any of the contents.
>
> $119/yr for the whole family, with a 30-day money-back guarantee. Free plan keeps your first 10
> accounts.
>
> *Winner — Most Impactful, H0 Hackathon 2026*

### R2 — the specific-moment hook

> **Title:** The call comes at 6am. Then the lockouts start.
>
> **Body:**
> The bank. The insurance portal. The pharmacy. The email that resets all of them.
>
> You don't need her passwords forever. You need them for six weeks, and then you need that
> access to end.
>
> Relay opens only what she granted you, only when a real trigger fires, and closes itself when
> she recovers. Encrypted in your browser — we can't read it. $119/yr, 30 days to change your mind.
>
> *Winner — Most Impactful, H0 Hackathon 2026*

### R3 — the objection-first hook *(tests the "my phone does that" obstacle)*

> **Title:** Apple and Google both have a legacy feature. Neither helps with the hospital.
>
> **Body:**
> Platform legacy tools are one ecosystem each, death-only, and all-or-nothing. They do nothing
> for the six-week hospitalisation you're far more likely to actually face.
>
> Relay is one vault across everything she uses, for emergencies that are usually survivable —
> which is why access is reversible by default. Only a verified estate handoff is permanent.
>
> $119/yr. Encrypted in your browser. *Winner — Most Impactful, H0 Hackathon 2026*

---

## Meta Ads — secondary lane

**Destination:** `https://relaystandby.com/caregivers?src=meta-ads`
**Objective:** Traffic · **Format:** Single image, 1080×1080
**Targeting:** interests — family caregiving, eldercare, aging parents, power of attorney,
Alzheimer's/dementia caregiving. Age 40–65. Exclude under-30.

Meta truncates hard, so each variant is `primary text` / `headline` / `description`.

### M1 — reversibility

> **Primary text:** When a parent is hospitalised you need their accounts now — and you need that
> access to end when the crisis does. Relay opens exactly what they granted you, and seals itself
> again when they check back in. Encrypted in your browser; we only hold ciphertext.
>
> **Headline:** Emergency access that closes itself — $119/yr
>
> **Description:** 30-day money-back guarantee. Free plan keeps your first 10 accounts.

### M2 — the notebook

> **Primary text:** The password notebook can't be unshared. Once everyone has everything, that's
> permanent. Relay gives each person only what they were granted, only when a real emergency is
> verified — and takes it back automatically when your parent recovers.
>
> **Headline:** The reversible way to share a parent's accounts — $119/yr
>
> **Description:** 30 days to change your mind. Winner, Most Impactful — H0 Hackathon 2026.

### M3 — free-first *(feeds Lane B: measures WTP after the reveal)*

> **Primary text:** Add your parent's 8 most important accounts and we'll show you the one that
> unlocks all the others — the account that, if you can't get into it, makes every other password
> useless. Free for your first 10.
>
> **Headline:** See which account your family actually can't lose
>
> **Description:** Encrypted in your browser. $119/yr after the free plan.

---

## Image direction (Meta)

No stock photos of smiling seniors — the audience is exhausted by that and it reads as insurance
marketing. Two directions that fit the product:

1. **The lock that opens both ways.** A simple two-state graphic: OPEN (during) → CLOSED (after).
   Amber on near-black, matching the landing page so the click-through feels continuous.
2. **The dependency reveal.** A tiny node graph: one node labelled "her email" with six lines
   running out of it. Caption: *"If you can't get into this one, the other six don't matter."*
   This is literally what the product shows you, so it sets an accurate expectation.

---

## Which creative feeds which lane

Both lanes are fed by every creative — the split happens on the landing page, not in the ad.

| | Lane A (the ratified gate) | Lane B (product) |
|---|---|---|
| Visitor takes | the priced CTA | the "see it on your own family" link |
| Event | `caregiver_intent`, `cta=hero/nav/pricing` | `caregiver_intent`, `cta=start` |

R1/R2/M1/M2 lean price-forward and should skew Lane A. **M3 leans free-first and should skew Lane
B** — it is the one creative deliberately built to test whether the risk-graph reveal converts
better than the landing copy alone. If M3 underperforms on Lane A but overperforms on Lane B, that
is the signal that the product funnel is worth routing paid traffic through.

---

## Flight sequence

1. ~~Buy `relaystandby.com`~~ — **done**; the destination is live, see the top of this doc.
2. Create the ad accounts. Billing is Steve's card, by policy. **Walkthrough below.**
3. Launch **R1** alone first. It is the closest to the ratified positioning and gives a clean
   baseline before any variant muddies attribution.
4. Add **R2/R3** at day 2–3 once R1 has a CPC to compare against.
5. Add the **Meta lane** at day 3 if pace misses N=100-by-day-10.
6. Daily: check the snapshot. Record N, both ratios, and CPC per lane.
7. At N≥100 or window end: write the verdict line — metric, N, threshold, ship/kill — reading the
   gate on the **Lane-A-only ratio**, with the blended and Lane-B ratios reported alongside.

---

## One-sitting setup — Reddit Ads (lane 1)

> Everything a human has to type, in order, so account creation and launch is one uninterrupted
> sitting. **Nothing here spends until the final step.** Steve does this; Claude can drive the
> browser and read each screen back if you'd rather co-pilot it.

**Have ready before you start:** the card, and this file open. Nothing else — the creatives,
destination URLs and targeting are all below and are copy-paste.

| # | Screen | What to enter |
|---|---|---|
| 1 | ads.reddit.com → Sign up | Use the Reddit account you want permanently attached to billing. A brand-new account with no karma is fine for advertising. |
| 2 | Business details | Name: whatever you want on the invoice. Country **US**, currency **USD**. |
| 3 | Payment method | The card. **Reddit may place a small temporary authorisation — that is not the flight budget.** |
| 4 | Create campaign → Objective | **Traffic**. Not Conversions — we have no pixel and do not want one; the privacy page says there are no advertising or tracking cookies on the site, and a pixel would make that false. |
| 5 | Campaign budget | **Daily cap $25**, campaign lifetime cap **$150** for this lane. Leaves $100 of the $250 ceiling for Meta. |
| 6 | Ad group → Targeting | Location **United States**. Interests/communities: `r/AgingParents`, `r/CaregiverSupport`, `r/Alzheimers`, `r/dementia`, `r/eldercare`. **Community targeting, not posting** — ads are platform-sanctioned and do not violate those subs' promotion rules. |
| 7 | Ad group → Bid | Leave automatic for the first flight. A manual bid with no CPC history is a guess. |
| 8 | Ad → Format | **Promoted post**, text. |
| 9 | Ad → Title / Body | **R1**, copied verbatim from this file. R1 only — R2/R3 wait for step 4 of the sequence. |
| 10 | Ad → Destination URL | `https://relaystandby.com/caregivers?src=reddit-ads` — **the `src` is the whole measurement.** A URL without it is invisible to the gate and the spend is wasted. |
| 11 | Review & submit | Submit and **stop**. Policy review is free and is the only authoritative approval signal; the compliance table above is a self-assessment. |

**After approval, before you let it run a full day:** click your own live ad once, then confirm the
click was counted — see the verification step below. A flight that spends against a broken `src` is
the single most expensive failure available here.

## One-sitting setup — Meta Ads (lane 2, only if lane 1 under-delivers)

| # | Screen | What to enter |
|---|---|---|
| 1 | business.facebook.com → Create account | A Business account, not a personal boost. Boosted posts cannot carry a `src` parameter reliably. |
| 2 | Payment | The card. Same $250 ceiling — **$100 remaining** if Reddit took $150. |
| 3 | Campaign objective | **Traffic**. Same no-pixel reasoning as Reddit. |
| 4 | Audience | US, **age 40–65**, exclude under-30. Interests: family caregiving, eldercare, aging parents, power of attorney, Alzheimer's/dementia caregiving. |
| 5 | Placements | Automatic. |
| 6 | Ad creative | **M1** first. Image per the direction section above — no stock photos of smiling seniors. |
| 7 | Destination URL | `https://relaystandby.com/caregivers?src=meta-ads` |
| 8 | Publish | Submit for review and stop. |

## Verify the instrument before letting either lane run

The funnel has been silently dead before — `window.va` was undefined at the moment both trackers
fired, and optional chaining swallowed every event. It was invisible for weeks and was only found
by driving a real browser. **Do not trust a green suite here.**

After the first ad is approved, click your own ad, then:

1. Land on `/caregivers` and confirm the URL carries `?src=reddit-ads` (or `meta-ads`).
2. Click the priced CTA through to `/caregivers/interest`.
3. In Vercel Analytics → Events, confirm **`caregiver_qualified`** and **`caregiver_intent`** both
   appear, and that **both carry `src` = the lane**. Numerator and denominator must share the
   channel vocabulary or the ratio is not computable.
4. Submit the interest form once, then confirm a `caregiver_leads` row exists with the `src` and
   the click ID intact.
5. **Delete that test row before reading the gate.** `caregiver_leads` held **0 rows** at
   2026-08-09; the flight must start from zero or N is contaminated from the first day.

If any of steps 1–4 fails, **pause the campaign before fixing it.** Spend against a broken
instrument buys nothing, and a low reading from it would trip the <0.5% KILL threshold on evidence
that does not exist.
