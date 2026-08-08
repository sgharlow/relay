# G1 ad creatives — paste-ready (drafted 2026-08-07)

> For the **paid lanes only**. Per the 2026-07-03 channel-rules audit, the no-AI-content rules
> apply to organic participation in r/AgingParents and r/CaregiverSupport — **ads and owned
> channels have no such constraint**, so these are Claude-drafted by design. Any organic comment
> in those two subreddits must still be written in Steve's own voice.
>
> Budget ceiling **$250** and lane structure: `g1-channel-send-kit.md`. Thresholds and metric
> definitions: `g1-wtp-test-design.md`. Do not restate numbers from those here.

---

## ⚠️ Domain status — resolve before booking

**Chosen: `relaystandby.com`** (decided 2026-08-07). Every destination URL below already assumes
it. **It is not purchased yet.** Registrar: **Cloudflare** (at-cost pricing, free WHOIS privacy).

Vercel's CLI refuses domain purchase by an agent — and per the standing infra policy, **DNS
changes are Steve's to apply, not Claude's**. Both steps below are his.

### 1. Buy (Cloudflare)

Cloudflare Registrar → Register → `relaystandby.com`. Cloudflare Registrar requires its own
nameservers, which is fine — we point records at Vercel rather than delegating the zone.

### 2. Point it at Vercel

In Vercel, add the domain to the `relay` project:

```
vercel domains add relaystandby.com relay
```

Then in Cloudflare DNS (values confirmed 2026-08-07 against a live Vercel domain on this account):

| Type | Name | Value | Proxy |
|---|---|---|---|
| A | `@` | `76.76.21.21` | **DNS only (grey)** |
| CNAME | `www` | `cname.vercel-dns.com` | **DNS only (grey)** |

**Grey cloud, not orange.** Proxying breaks Vercel's certificate issuance, and if it is ever
turned on, Cloudflare SSL mode MUST be **Full (strict)** — Flexible produces a redirect loop with
Vercel. This is the same configuration `learningai365.com` already runs.

**Known artifact, not a bug:** grey-cloud means Cloudflare's own analytics will show ~0 requests
for this domain. That is a proxy-visibility artifact and cost an investigation once already. G1
reads from **Vercel Web Analytics**, which is unaffected.

### Until it resolves

The live destination is `relay-three-henna.vercel.app`. **Do not book a flight against it.** For a
product whose proposition is *"trust us with your parent's passwords"*, a random subdomain in the
ad's display URL is a substantive conversion risk — and a measurement risk, because a weak read
would be attributable to the domain rather than the offer, biasing toward a **false kill** on a
gate that can archive the product.

If you fly without it anyway, record the domain as a known confound in the verdict line so a
sub-2% read is not over-interpreted.

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
> $119/yr for the whole family. Free plan keeps your first 10 accounts.
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
> she recovers. Encrypted in your browser — we can't read it. $119/yr.
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
> **Description:** Free plan keeps your first 10 accounts.

### M2 — the notebook

> **Primary text:** The password notebook can't be unshared. Once everyone has everything, that's
> permanent. Relay gives each person only what they were granted, only when a real emergency is
> verified — and takes it back automatically when your parent recovers.
>
> **Headline:** The reversible way to share a parent's accounts — $119/yr
>
> **Description:** Winner, Most Impactful — H0 Hackathon 2026.

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

1. **Buy `relaystandby.com` and point it at Vercel** — blocking; see the domain status above.
2. Create the ad accounts. Billing is Steve's card, by policy.
3. Launch **R1** alone first. It is the closest to the ratified positioning and gives a clean
   baseline before any variant muddies attribution.
4. Add **R2/R3** at day 2–3 once R1 has a CPC to compare against.
5. Add the **Meta lane** at day 3 if pace misses N=100-by-day-10.
6. Daily: check the snapshot. Record N, both ratios, and CPC per lane.
7. At N≥100 or window end: write the verdict line — metric, N, threshold, ship/kill — reading the
   gate on the **Lane-A-only ratio**, with the blended and Lane-B ratios reported alongside.
