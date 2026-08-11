# G1 ad creatives + flight runbook — paste-ready (drafted 2026-08-07, revised 2026-08-10)

> **Revision 2026-08-10 — read this before using an earlier printout.** The plan was complete on
> measurement and incomplete on execution. Four things changed, all of which would have surfaced
> mid-sitting with the card already on file:
> **(1)** the compliance self-assessment was wrong about personal attributes and four creatives are
> rewritten (§1a); **(2)** the Reddit format that carries body text is a **Free-form ad**, and every
> Meta headline and description overflowed its field (§1b); **(3)** the $250 ceiling had no
> structural enforcement — both platforms have real caps and they are now steps in the walkthrough;
> **(4)** the calendar imposes a **serving-by 2026-08-18** deadline that was never written down.
> Added: image-asset specs, a rejection path, a daily operating rhythm with pause triggers, and an
> explicit who-does-what contract.
>
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
| Personal-attribute targeting | 🔴 **WRONG AS WRITTEN — corrected 2026-08-10, see §1a.** The copy did address the reader in the second person *about a family member's hospitalisation*, which is the exact shape Meta's policy names |
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

### 1a. 🔴 The personal-attributes row was wrong (found 2026-08-10, read from the policy itself)

The table above claimed the copy "never asserts the reader's health or family situation; it
describes a scenario." That was a self-assessment written from memory of the policy. Read from
Meta's published standard, it is false for four of the six creatives.

Meta's Privacy Violations and Personal Attributes standard prohibits ads that "assert or imply
personal attributes," listing **"physical or mental health (including medical conditions)"** among
them, and separately prohibits ads that **"imply knowledge of Medical information of a user or
user's family."** Its own examples turn on the second person: *"Meet Hispanic men online now!"* is
allowed, *"Meet other black singles near you!"* is not; *"Depression getting you down?"* is not.
**The attribute is not the violation — the attribute attached to "you/your" is.**

Measured against that, the original drafts:

| Creative | The phrase | Why it is exposed |
|---|---|---|
| M1 | "When a parent is hospitalised **you** need **their** accounts now" | second person + a family member's hospitalisation |
| M2 | "takes it back automatically when **your parent** recovers" | asserts the reader has a parent who is recovering |
| R1 | "**Your parent** keeps control. If they're hospitalised…" | same shape as M2 |
| R2 | "**You** don't need **her** passwords forever" | same shape, plus a named relative |
| R3 | "the six-week hospitalisation **you're** far more likely to actually face" | asserts a prediction about the reader's own family |
| M3 | "Add **your parent's** 8 most important accounts" | ⚠️ weakest case — a family relationship, no medical claim. Lower risk, still rewritten for consistency |

**Honest calibration: this is a material rejection risk, not a certainty.** The framing is
conditional ("when a parent is hospitalised"), which is weaker than the policy's own examples, and
reviewers are inconsistent. But the fix costs nothing, a rejection costs days against a hard gate
date, and repeated rejections put an account at risk — so the creatives below are the rewritten,
third-person versions. **The originals are preserved under each variant**, because if review passes
the safe copy easily, the sharper second-person version is worth testing later.

**The rule to apply to any new creative:** describe the situation in the third person and let the
reader recognise themselves in it. Never join "you/your" to a health event or a relative's
condition. "A hospital stay can mean a family suddenly needs access" is compliant; "when your mum
is in hospital you need access" is the prohibited shape.

Reddit's ad policy was **not** readable from a primary source this session — `business.reddithelp.com`
returns a CSS error to every fetch. Treat the Meta-compliant copy as the safe default on both
lanes and confirm nothing further is required at submission time.

### 1b. Format and character limits — the ads do not fit the fields as drafted

Two mechanical problems that would have been discovered mid-sitting, with the card already on file.

**Reddit: the format is a Free-form ad, not a "Promoted post."** The body copy these creatives are
built around only exists in Reddit's **free-form** format (headline + rich body text). A standard
image/link ad carries a **headline only** — the body would have been silently dropped and R1 would
have run as a bare title. Limits: headline up to 300 characters (keep under ~100; Reddit's own
guidance favours under 80 for mobile), body effectively unlimited, brand display name **25
characters** — use `Relay`.

**Meta: every headline and description as drafted overflows.** The visible limits are ~125
characters of primary text before the "See More" fold, **40 for the headline**, and **~25 for the
description**.

| Field | Original draft | Length | Verdict |
|---|---|---|---|
| M1 headline | "Emergency access that closes itself — $119/yr" | 45 | ❌ truncates |
| M2 headline | "The reversible way to share a parent's accounts — $119/yr" | 57 | ❌ truncates |
| M3 headline | "See which account your family actually can't lose" | 48 | ❌ truncates |
| M1 description | "30-day money-back guarantee. Free plan keeps your first 10 accounts." | 68 | ❌ truncates |

Every Meta variant below is rewritten to fit, with the character count stated so a later edit can
be checked without re-deriving it. **The guarantee moved into the primary text** rather than being
squeezed into the description: 25 characters cannot hold "30-day money-back guarantee" and the
claim-discipline rule forbids paraphrasing it. The winner badge moved for the same reason — at 25
characters it would lose its track and read as a grand prize we did not win.

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

~~⚠️ Still true: `relaystandby.com` has **no MX**…the public contact address is deliberately a
personal Gmail until Cloudflare Email Routing exists.~~ **STALE — corrected 2026-08-10.** Both
halves are now false: Cloudflare Email Routing was enabled on 2026-08-09 (checklist 7d), the apex
now publishes `route1/2/3.mx.cloudflare.net`, and the public contact is `hello@relaystandby.com`
with a proven catch-all. **This does not block either lane.**

### 🔴 Outlook.com delivers to JUNK — measured at the mailbox 2026-08-10

The open item "Microsoft accepted, folder placement unread" is now **read, and the answer is bad.**
A verifier-confirmation email (`relay@relaystandby.com` → an `outlook.com` address, sent 2026-08-09
23:04) was found **in the Junk folder**, with Microsoft SafeLinks rewriting every URL.

**This is the durable lesson, and it is worth more than the finding:** Resend reported this class
of send as **`Delivered`**. An ESP's delivery status means *the receiving server accepted the
message* — it has no visibility into which folder the message was filed into. `Delivered` is a
proxy; the mailbox is ground truth, and here they disagree. Never again read `Delivered` as
"reached the inbox."

**DIAGNOSED from the message source 2026-08-10 — it is CONTENT SCORING, and authentication is
flawless.** The headers settle it and rule out every configuration theory:

| Header | Value | What it eliminates |
|---|---|---|
| `spf=pass` `smtp.mailfrom=send.relaystandby.com` | 54.240.11.140 (`amazonses.com`) | SPF |
| `dkim=pass header.d=relaystandby.com` | + a second pass on `d=amazonses.com` | DKIM |
| `dmarc=pass action=none` `header.from=relaystandby.com` | aligned | DMARC / alignment |
| **`compauth=pass reason=100`** | Microsoft's best composite-auth result | any auth doubt |
| `X-SID-Result: PASS` | sender-ID pass | spoof heuristics |
| **`BCL: 0`** | Bulk Complaint Level zero | "treated as bulk / poor reputation" |
| `ucf:0` `jmr:0` | no user rule, no blocked-sender entry | "Steve junked it himself once" |
| **`SCL: 5`** (and `SCL=6` in `X-Message-Delivery`) | Microsoft's spam band | — |
| `OFR:SpamFilterAuthJ` `dest:J` `RF:JunkEmail` | the **content filter** routed it to Junk | — |

So: perfectly authenticated, not bulk, not user-blocked, and junked anyway **on what the message
says**. Tightening DMARC to `p=quarantine` would buy nothing here — DMARC already passes — so that
DNS change is explicitly NOT indicated, and mail-DNS changes on this domain have already come one
misconfiguration away from silently breaking every notification.

**🚫 The Reply-To theory was TESTED AND REFUTED 2026-08-11.** Kept below because the fix was
shipped anyway and because the reasoning is worth not repeating. Test 1 changed
`RESEND_REPLY_TO_ADDRESS` to `hello@relaystandby.com` and re-sent with subject and body
byte-identical but for the case code. Result: `Reply-To: hello@relaystandby.com` confirmed on the
wire, and **the verdict did not move** — `SCL:5`, `X-Message-Delivery` SCL=6 (a byte-identical
base64 string to the baseline), `RF:JunkEmail`, `BCL:0`, and the **same 23 `ARA` rules fired**,
merely reordered. A hypothesis this clean deserved the experiment; the experiment says no.

⚠️ **The fix stays** — the privacy leak it closed was real and independent of deliverability.

**Superseded reasoning follows.**

**~~Prime suspect, and it is a one-line fix: the `Reply-To` is a personal Gmail.~~**

```
From:     relay@relaystandby.com        <- authenticated, DMARC-aligned
Reply-To: sgharlow+relay@gmail.com      <- free consumer webmail, plus-tagged
```

An authenticated corporate-domain `From` whose replies redirect to a freemail account is one of the
most heavily weighted business-email-compromise signals there is; it is the single clearly anomalous
thing in this message. Set by `RESEND_REPLY_TO_ADDRESS` (`lib/notify/email.ts`).

⚠️ **This is also a privacy leak that was believed closed.** Checklist 7d moved the public contact
to `hello@relaystandby.com` and verified the personal Gmail was gone from the shipped JS bundle —
but nobody checked the mail headers. **It still ships in the `Reply-To` of every outbound message**,
so every verifier, trusted contact and invited family member sees Steve's personal address. The
catch-all that makes `hello@relaystandby.com` a working reply target has been proven since 8-09.

Secondary contributors, in likely order: the message is **`text/plain` only** with no
`multipart/alternative` HTML part (unusual for brand transactional mail); the subject leads with
**"Action needed"**; and the body pairs a 6-digit code with a link — the phishing silhouette.
Microsoft never discloses which rule fired, so these are ranked suspicions, not findings.

**Fix and re-test, one variable at a time** — the SCL in the next message's headers is the readout:

| Test | Change | Result |
|---|---|---|
| 0 | *(baseline)* | SCL 5/6 → Junk |
| 1 | `RESEND_REPLY_TO_ADDRESS=hello@relaystandby.com`, nothing else | 🚫 **REFUTED** — SCL unchanged, same rules |
| 2 | not run: add an HTML `multipart/alternative` part | — |
| 3 | not run: subject without "Action needed" | — |

⚠️ Send each test to a **fresh** Outlook address, and do not click "It's not junk" on any of them —
that trains the filter and destroys the baseline the next test is measured against.

### What is left, and why the investigation stops here for now

With auth, bulk classification, user rules and Reply-To all eliminated by evidence, two candidates
remain, and **we control only one of them:**

1. **Message shape.** The mail is **`text/plain` only** — no `multipart/alternative` HTML part.
   Genuine brand transactional mail almost always carries both, so a bare-text message pairing a
   numeric code with a link is an unusual silhouette. This is the highest-value remaining test and
   it is a change to `lib/notify/email.ts`, not config.
2. **Shared-IP and new-domain reputation — largely outside our control.** The two sends left from
   `54.240.11.140` and `54.240.11.138`: Resend's **shared Amazon SES pool**. We do not own that IP
   reputation and cannot register it with Microsoft SNDS, and `relaystandby.com` itself has
   near-zero sending history. Microsoft consumer filtering is at its harshest on exactly that
   combination, and the usual remedy is time and engagement rather than a setting.

**Deliberately not pursued further before the flight.** It blocks neither lane — Lane A converts on
a form POST and the Lane-B numerator was live-proven to fire with no email verification step
anywhere in the path — and the G1 window has a hard serving-by date. **This is a pre-`customer-used`
defect, not a pre-flight one:** it must be closed before real families depend on a verifier
confirmation arriving, and it compounds the confirmed Resend suppression behaviour on the same path.
Every further test also costs another junked message to the same mailbox, which is not free.

**What it does and does not block:**

| | Affected? | Why |
|---|---|---|
| **Lane A** (the ratified gate) | ❌ No | Conversion is a form POST. The only email is the notification to Steve. The gate metric never depends on mail reaching the visitor. |
| **Lane B numerator** | ❌ No | Proven live 2026-08-10: signup → TOTP → seed → reveal → price → Stripe involves **no email verification step at all**. The numerator fires without a single message being delivered. |
| **The product after purchase** | 🔴 **Yes, materially** | Invitations, owner challenges and verifier confirmations — the exact message found in Junk — all ride this path. A trusted contact who never sees the confirmation silently stalls a release. |

**So it does not block the flight, and it is not a G1 measurement risk.** It is a product defect
for anyone who converts, and it compounds the already-confirmed Resend **suppression** behaviour:
that mutes a bounced recipient permanently while returning 200, and this files the survivors into
Junk. Two independent silent failure modes on the one path where silence is most expensive.

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
**Objective:** Traffic · **Format:** **Free-form ad** (the only format that carries body text — §1b)
**Brand display name:** `Relay` (25-char field) · **CTA button:** `Learn More`
**Targeting:** audiences of r/AgingParents, r/CaregiverSupport, r/Alzheimers, r/dementia,
r/eldercare. Interest/community targeting, not subreddit posting — ads are platform-sanctioned and
do not violate those subs' promotion rules.

### R1 — the reversibility hook *(lead with this)*

> **Title (78 chars):** Emergency access to a parent's accounts — that closes itself when they
> recover
>
> **Body:**
> Most families solve "what if something happens to Mom" the only way they know how: share every
> password with everyone, forever. That works right up until it doesn't, and it can't be undone.
>
> Relay is the reversible version. The account holder stays in control. If a trigger is verified,
> it opens exactly what was granted — and when they check back in, it seals itself again.
>
> Encrypted in the browser, so we only ever hold ciphertext. Trusted contacts confirm a real
> emergency; they never see any of the contents.
>
> $119/yr for the whole family, with a 30-day money-back guarantee. The free plan keeps the first
> 10 accounts.
>
> *Winner — Most Impactful, H0 Hackathon 2026*

<details><summary>Superseded second-person draft (2026-08-07) — do not submit without re-reading §1a</summary>

> Relay is the reversible version. **Your parent** keeps control. If **they're hospitalised**, it
> opens exactly what **you** were granted… Encrypted in **your** browser… Free plan keeps **your**
> first 10 accounts.

</details>

### R2 — the specific-moment hook

> **Title (47 chars):** The call comes at 6am. Then the lockouts start.
>
> **Body:**
> The bank. The insurance portal. The pharmacy. The email that resets all of them.
>
> A family doesn't need those passwords forever. They need them for about six weeks — and then
> that access needs to end.
>
> Relay opens only what the owner granted, only when a real trigger is confirmed, and closes
> itself again on their return. Encrypted in the browser — we can't read it. $119/yr, 30 days to
> change your mind.
>
> *Winner — Most Impactful, H0 Hackathon 2026*

<details><summary>Superseded second-person draft (2026-08-07)</summary>

> **You** don't need **her** passwords forever. **You** need them for six weeks… Relay opens only
> what **she** granted **you**… and closes itself when **she recovers**.

</details>

### R3 — the objection-first hook *(tests the "my phone does that" obstacle)*

> **Title (77 chars):** Apple and Google both have a legacy feature. Neither helps with the
> hospital.
>
> **Body:**
> Platform legacy tools are one ecosystem each, death-only, and all-or-nothing. They do nothing
> for a six-week hospitalisation — which is the far more common case.
>
> Relay is one vault across every service an account holder uses, built for emergencies that are
> usually survivable — which is why access is reversible by default. Only a verified estate
> handoff is permanent.
>
> $119/yr. Encrypted in the browser. *Winner — Most Impactful, H0 Hackathon 2026*

<details><summary>Superseded second-person draft (2026-08-07)</summary>

> …the six-week hospitalisation **you're** far more likely to actually face… one vault across
> everything **she** uses.

</details>

---

## Meta Ads — secondary lane

**Destination:** `https://relaystandby.com/caregivers?src=meta-ads`
**Objective:** Traffic · **Format:** Single image, 1080×1080 (assets: see "Image assets" below)
**Targeting:** interests — family caregiving, eldercare, aging parents, power of attorney. Age
40–65. Exclude under-30.

> ⚠️ **Expect some of these interests to be missing from the picker.** Meta has spent several
> years removing detailed-targeting options it classes as sensitive, health causes among them, and
> in 2026 extended that enforcement to audiences and custom conversions whose *names* imply a
> sensitive trait. **"Alzheimer's / dementia caregiving" is the one most likely to be gone** — it
> was in the original draft of this section and is removed here. If the remaining interests are
> also absent, do **not** hunt for a proxy that smuggles the same signal back in: fall back to
> **broad targeting with the age band only** and let the creative do the qualifying. A narrow
> audience that trips an enforcement sweep costs the account; a broad one only costs CPC.

Meta truncates hard: ~125 characters of primary text before the "See More" fold, **40** for the
headline, **~25** for the description. Counts are stated so an edit can be checked without
re-deriving them. Each primary text is written so its **first sentence lands inside the fold.**

### M1 — reversibility

> **Primary text (first sentence = 118 chars, inside the fold):** A hospital stay can mean a
> family suddenly needs access to accounts — and needs that access to end when the stay does.
> Relay opens exactly what the owner granted, and seals itself again when they check back in.
> Encrypted in the browser; the server only ever holds ciphertext. 30-day money-back guarantee.
>
> **Headline (35):** Access that closes itself — $119/yr
>
> **Description (24):** Free plan keeps 10 items

### M2 — the notebook

> **Primary text (first sentence = 88 chars):** The password notebook can't be unshared. Once
> everyone has everything, that's permanent. Relay gives each person only what the owner granted,
> only when a real emergency is verified — and takes it back automatically when the owner checks
> in. 30-day money-back guarantee. Winner, Most Impactful — H0 Hackathon 2026.
>
> **Headline (33):** Reversible access, not a notebook
>
> **Description (24):** Free plan keeps 10 items

### M3 — free-first *(feeds Lane B: measures WTP after the reveal)*

> **Primary text (first sentence = 95 chars):** Add the 8 accounts a family would need first, and
> Relay shows which one unlocks all the others — the account that, if it's locked, makes every
> other password useless. Free for the first 10 items.
>
> **Headline (33):** Find the account that unlocks all
>
> **Description (25):** Encrypted in your browser

<details><summary>Superseded second-person drafts (2026-08-07) — rejected on §1a and on length</summary>

> **M1:** "When a parent is hospitalised **you** need **their** accounts now…" · headline 45 chars
> · description 68 chars.
> **M2:** "…takes it back automatically when **your parent** recovers." · headline 57 chars.
> **M3:** "Add **your parent's** 8 most important accounts…" · headline 48 chars.

</details>

**On the badge and the guarantee:** both were moved out of the 25-character description and into
the primary text. "Winner, Most Impactful — H0 Hackathon 2026" does not fit, and truncating it to
"H0 Hackathon 2026 winner" drops the track and reads as a grand prize — a claim we cannot make.
"30-day money-back guarantee" does not fit either, and the claim-discipline rule forbids
paraphrasing it into anything shorter.

---

## Image assets

> ⚠️ **These do not exist yet.** This section previously gave *art direction* and no files, which
> means the Meta lane stalls at "upload image" with nothing to upload. What is needed is stated
> here precisely enough to produce or commission without another decision.

**Where they live:** `docs/ad-assets/` — committed, so the creative that ran is recoverable at
verdict time. Naming: `meta-m1-1080.png`, `meta-m2-1080.png`, `meta-m3-1080.png`, plus
`reddit-r1-1200x628.png` if the Reddit lane uses an image.

| Spec | Value |
|---|---|
| Meta feed (primary) | **1080 × 1080**, 1:1, PNG or JPG |
| Reddit free-form | **1200 × 628** (1.91:1) or 1080 × 1080 |
| Colour | Amber on near-black, matched to the landing page so the click-through reads as continuous |
| Text in image | Short. The old 20%-text rule is retired, but text-heavy images still get throttled delivery — keep it to one line |
| Must NOT contain | Stock photos of smiling seniors (the audience is exhausted by them and it reads as insurance marketing); any price other than $119/yr; any testimonial, badge or certification beyond the H0 award |
| Safe zone | Keep text ≥ 8% from every edge — placements crop differently |

Two directions, either of which fits the product:

1. **The lock that opens both ways.** A two-state graphic: OPEN (during) → CLOSED (after). Pairs
   with M1/M2.
2. **The dependency reveal.** A small node graph: one node labelled "the email account" with six
   lines running out of it, captioned *"If this one is locked, the other six don't matter."* Pairs
   with M3 — it is literally what the product shows, so it sets an accurate expectation.
   ⚠️ Label the node "the email account", **not** "her email" — §1a applies to image text too.

**Not on the critical path.** Meta is lane 2 and only launches at day 3 if Reddit under-delivers,
and the Reddit free-form ad can run text-only. Produce these before the Meta lane opens, not
before the flight starts.

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

## The date the calendar actually imposes

The gate hard-stops **2026-09-15** (`PROJECT.yaml`) and the window is **4 weeks from the day the
first ad is approved and serving** (decision #4). Those two facts multiply out to a deadline this
plan never stated:

> **The first ad must be APPROVED AND SERVING by 2026-08-18** to get a full 4-week window inside
> the hard stop. Ad review is typically ~24h and can run longer on a brand-new account, so
> **submit by 2026-08-16.** Slipping does not move the hard stop — it shortens the window, and at
> a flight already expected to land short of the honest N, every lost day comes straight off N.

| Date | What must have happened |
|---|---|
| **2026-08-16** | R1 submitted for review (both accounts created, caps set, pre-flight passed) |
| **2026-08-18** | R1 approved and serving → **window start recorded in `g1-flight-log.md`** |
| ~2026-08-20 | R2/R3 added, once R1 has a CPC to compare against |
| ~2026-08-21 | Meta lane opens *only if* pace misses N=100-by-day-10 |
| **2026-09-15** | Gate hard stop — verdict written regardless of N |

## Flight sequence

1. ~~Buy `relaystandby.com`~~ — **done**; the destination is live, see the top of this doc.
2. **Pre-flight sitting** — the instrument checks in "Verify the instrument" below, including the
   one path that has never been proven live (part 1 step 5). Nothing spends. Do this first.
3. Create the ad accounts and **set the structural spend caps**. Billing is Steve's card, by
   policy. **Walkthrough below.**
4. Launch **R1** alone first. It is the closest to the ratified positioning and gives a clean
   baseline before any variant muddies attribution.
5. Add **R2/R3** at day 2–3 once R1 has a CPC to compare against.
6. Add the **Meta lane** at day 3 if pace misses N=100-by-day-10.
7. Daily: check the snapshot. Record N, both ratios, and CPC per lane.
8. At N≥100 or window end: write the **five-line verdict** (`g1-flight-log.md`) — reading the gate
   on the **Lane-A-only ratio**, with the blended and Lane-B ratios reported alongside.
   ⚠️ Per `PROJECT.yaml ratified.g1-flight-power`, a ship or kill call on the ratio alone is **not
   permitted** for this flight — lines 3 and 4, the leads and what they say, carry the decision.

### What "Traffic, no pixel" costs, and why we accept it

Both lanes run the **Traffic** objective with no conversion pixel — deliberately, because
`/privacy` states there are no advertising or tracking cookies on the site, and a pixel would make
that false. The consequence is worth writing down before the numbers look wrong:

**Without a pixel, the platforms can only optimise for *link clicks*, not *landing page views*.**
A link click is counted when the tap happens; a landing page view requires the page to actually
render. So the platform's click count will exceed N even before ad-blocking is considered — a
visitor who taps and backs out mid-load is billed and never reaches the instrument.

Combined with the ad-blocker suppression already described, **expect the platform click count to
run meaningfully above N, and do not read that gap as broken measurement.** Cross-check N against
the `/caregivers` pageview count in Vercel Analytics: pageviews should sit between the platform
clicks and N. If N approaches zero *while pageviews track clicks*, that is a broken instrument and
the campaign pauses. If N and pageviews move together below the click count, that is the tax, and
it is priced in.

---

## Who does what — the co-pilot contract

Settled once here so it is not renegotiated at every screen.

| Step | Owner | Why |
|---|---|---|
| Pre-flight instrument checks | **Claude drives, Steve watches** | It is browser work with an exact pass/fail; nothing spends |
| Account creation, business details | **Steve types, Claude reads the screen back** | The account is permanently attached to Steve's identity and the platforms' ToS govern automated signup |
| **Card entry** | **Steve, alone** | Billing is Steve's card by policy. Claude never handles card details and they are never pasted into chat |
| **Spend caps** | **Steve sets, Claude verifies the number on screen** | The one control that makes the $250 ceiling structural |
| Campaign / ad-group / targeting fields | **Claude dictates, Steve enters** | Every value is pre-committed in this file; the job is transcription, not judgement |
| Creative copy | **Claude supplies verbatim, Steve pastes** | Copy is claim-controlled — §1a and the claim-discipline list |
| **Submit for review** | **Steve presses it** | Outward-facing and irreversible-ish |
| Post-approval verification click | **Steve clicks once, Claude confirms the payload** | It permanently injects one event; only one person should be able to cause it |
| Daily snapshot | **Claude reads and writes the log, Steve confirms spend** | Spend is only visible in the billing UI Steve is signed into |

## One-sitting setup — Reddit Ads (lane 1)

> Everything a human has to type, in order, so account creation and launch is one uninterrupted
> sitting. **Nothing here spends until the final step.**

**Have ready before you start:** the card, this file open, and the pre-flight from "Verify the
instrument" already passed. Nothing else — the creatives, destination URLs and targeting are all in
this file and are copy-paste.

| # | Screen | What to enter |
|---|---|---|
| 1 | ads.reddit.com → Sign up | Use the Reddit account you want permanently attached to billing. A brand-new account with no karma is fine for advertising. |
| 2 | Business details | Name: whatever you want on the invoice. Country **US**, currency **USD**. |
| 3 | Payment method | The card. **Reddit may place a small temporary authorisation — that is not the flight budget.** |
| 4 | **Brand display name** | `Relay` — the 25-character name shown on the ad itself. Set it deliberately; the default is often the raw account handle. |
| 5 | Create campaign → Objective | **Traffic**. Not Conversions — we have no pixel and do not want one; the privacy page says there are no advertising or tracking cookies on the site, and a pixel would make that false. |
| 6 | Campaign budget | **Daily cap $25**, and set a **campaign LIFETIME cap of $150** for this lane. Leaves $100 of the $250 ceiling for Meta. The lifetime cap is the structural control — a daily cap alone will happily spend $25 × 14 days. |
| 7 | Ad group → Targeting | Location **United States**. Interests/communities: `r/AgingParents`, `r/CaregiverSupport`, `r/Alzheimers`, `r/dementia`, `r/eldercare`. **Community targeting, not posting** — ads are platform-sanctioned and do not violate those subs' promotion rules. |
| 8 | Ad group → Bid | Leave automatic for the first flight. A manual bid with no CPC history is a guess. |
| 9 | Ad → Format | **Free-form ad** — the format that carries body text. A standard image/link ad is headline-only and would silently drop the entire body of R1 (§1b). |
| 10 | Ad → Headline / Body | **R1**, copied verbatim from this file — the rewritten version, not the superseded draft. R1 only; R2/R3 wait for step 5 of the flight sequence. |
| 11 | Ad → CTA button | `Learn More`. Not `Sign Up` — the landing page is a landing page, and a CTA that promises signup mis-sets the click. |
| 12 | Ad → Destination URL | `https://relaystandby.com/caregivers?src=reddit-ads` — **the `src` is the whole measurement.** A URL without it is invisible to the gate and the spend is wasted. Extra parameters the platform appends (`rdt_cid`, etc.) are harmless: `src` is read with `URLSearchParams`, and click IDs are separately captured to `caregiver_leads` (migration 019). |
| 13 | Review & submit | Submit and **stop**. Policy review is free and is the only authoritative approval signal; the compliance table above is a self-assessment. |

**After approval, before you let it run a full day:** the part-2 verification click below. A flight
that spends against a broken `src` is the single most expensive failure available here.

## One-sitting setup — Meta Ads (lane 2, only if lane 1 under-delivers)

| # | Screen | What to enter |
|---|---|---|
| 1 | business.facebook.com → Create account | A Business account, not a personal boost. Boosted posts cannot carry a `src` parameter reliably. |
| 2 | Payment | The card. Same $250 ceiling — **$100 remaining** if Reddit took $150. |
| 3 | **Payment settings → Account spending limit** | Set it to **the remaining ceiling**. This is an account-level hard stop: when it is reached Meta pauses every campaign in the account immediately, regardless of what any campaign budget still has left. **Set this before the first campaign, not after.** |
| 4 | Campaign objective | **Traffic**. Same no-pixel reasoning as Reddit. |
| 5 | Campaign budget | Daily budget, **plus the optional "Campaign spending limit"** as a second cumulative cap. Belt and braces: the account limit protects the ceiling, the campaign limit protects the lane split. |
| 6 | Audience | US, **age 40–65**, exclude under-30. Interests: family caregiving, eldercare, aging parents, power of attorney. **If those interests are missing from the picker, go broad with the age band — do not substitute a proxy** (see the targeting note above). |
| 7 | Placements | Automatic. |
| 8 | Ad creative | **M1** first, rewritten version. Image per "Image assets" — 1080×1080, no stock photos of smiling seniors. |
| 9 | Destination URL | `https://relaystandby.com/caregivers?src=meta-ads` |
| 10 | Publish | Submit for review and stop. |

## Make the $250 ceiling structural, not a convention

The ceiling is ratified, and right now the only thing enforcing it is remembering to check. That is
the failure shape the portfolio rule about structural safety exists for: one forgotten pause and
the ceiling is a number in a document. Both platforms offer a real cap — use them.

| Platform | Control | Where |
|---|---|---|
| Reddit | **Campaign lifetime budget** ($150) | Campaign budget screen, step 6 |
| Meta | **Account spending limit** (remaining ceiling) — pauses every campaign in the account on contact | Payment settings, step 3 |
| Meta | **Campaign spending limit** (per-lane) | Campaign budget screen, step 5 |

**Verify each cap by reading it back off the screen after saving.** A cap that was typed but not
saved looks identical to one that was, until the bill arrives.

⚠️ **Do not chase a new-advertiser spend-match credit.** Reddit's offers are structured around
spending $500–$1,000 to unlock a matching credit — five to ten times the ratified ceiling. Taking
one would convert a $250 directional test into a four-figure commitment for a product with
`wtp_evidence: none`. If a small unconditional credit is offered at signup, take it and record it
in the flight log as reduced cost per click; anything conditional on spend is declined.

## If a creative is rejected

Rejection is expected traffic, not a crisis — but it is handled deliberately, because repeated
rejections are what put an ad account at risk, and the account is not replaceable inside this
window.

1. **Read the stated reason before changing anything.** The policy name in the rejection is the
   only information that matters; "learn more" links to the specific standard.
2. **If it names personal attributes / sensitive categories:** the fix is §1a — go further into the
   third person. Do not appeal first; edit and resubmit once.
3. **If it names something else:** appeal once with the compliance table above as the argument.
   Meta and Reddit both route appeals to a human reviewer and it is free.
4. **Never resubmit the same creative unchanged more than once.** Two identical rejections are
   treated as a pattern.
5. **If both R1 and its edit are rejected, stop and re-scope with Steve** before spending anywhere.
   A category-level rejection is evidence about the channel, and belongs in the flight log — it is
   a real finding about whether this product can be advertised at all.

## Daily operating rhythm, and when to pull the cord

One pass a day, same order, into the `g1-flight-log.md` snapshot table. Numbers are read fresh from
the dashboards every day — never carried forward from yesterday's row.

| Read | From |
|---|---|
| Spend to date, impressions, clicks, CPC | the ad platform's billing/campaign view (**Steve is signed in**) |
| N (gate-qualifying `caregiver_qualified`), Lane-A intents, Lane-B intents | Vercel Analytics → Events |
| `/caregivers` pageviews | Vercel Analytics — the cross-check against clicks |
| Lead count and **the lead notes themselves** | `caregiver_leads` |

**Pause triggers — any one of these stops the lane the same day:**

- **N is flat while pageviews track clicks.** The instrument is broken, not the market. Pause,
  diagnose, resume. This is the failure the whole verification section exists to catch.
- **CPC above ~$3 after 30+ clicks.** The ceiling buys too few visitors at that price to produce a
  reading; pause and revisit targeting before burning the lane.
- **Spend pacing to exhaust the lane before day 5.** The window needs days, not just clicks — a
  one-day burn produces N with no chance to iterate copy.
- **Junk rows appearing in `caregiver_leads`.** Escalation is Cloudflare Turnstile, never
  reCAPTCHA (checklist 7g).

**Not a pause trigger:** a low intent ratio. That is the measurement, and pausing on it is how a
directional flight gets talked into an unearned kill. The verdict rule already forbids calling
ship or kill on that line alone.

## Verify the instrument before letting either lane run

The funnel has been silently dead before — `window.va` was undefined at the moment both trackers
fired, and optional chaining swallowed every event. It was invisible for weeks and was only found
by driving a real browser. **Do not trust a green suite here.**

> 🔴 **Read this before you click anything.** An earlier version of this section told you to verify
> by clicking your own live ad, i.e. with `src=reddit-ads`. That injects **one qualified and one
> intent at 100% conversion into the real lane** — a full percentage point on a 2% ship line at
> N=100, biasing toward a **false PASS**. And while step 5 below can delete the `caregiver_leads`
> row, **a Vercel Analytics event cannot be deleted**: that half of the contamination is permanent.
>
> So the verification is split in two. **Part 1 exercises the whole funnel under a QA source the
> gate ignores** (`QA_SRCS` in `src/app/caregivers/content.ts`, pinned by `content.test.ts`).
> **Part 2 is a single click on the real ad**, which exists only to prove the ad platform passes
> `src` through — the one thing part 1 cannot cover — and is recorded as a known offset in
> `docs/g1-flight-log.md`.

### Part 1 — full funnel, gate-safe (do this first, before the ad is even approved)

> **Step 5 is the one that has never been proven live.** Everything else in this list has been
> walked on production at least once. The Lane-B numerator is **unit-pinned only** — and the defect
> it replaced shipped for two days with the suite green, which is precisely why a passing test is
> not accepted as the proof here. Budget a real signup, TOTP enrolment, seed and reveal for it.

**Pre-flight gate — all of these must be true before any money is committed:**

| | Condition | How it is checked |
|---|---|---|
| 1 | Steps 1–6 below pass on production | driven in a real browser, payloads read off the wire |
| 2 | `caregiver_leads` = **0 rows** | live query, not a remembered number |
| 3 | The test account and test lead row from step 5 are **deleted** | live query |
| 4 | `docs/g1-flight-log.md` window start is still **blank** | it is filled on the approval day, not the submit day |
| 5 | The known-offsets table has the part-2 row ready to fill | so the offset is recorded the day it happens, not reconstructed |

⚠️ **One unproven path is knowingly accepted:** delivery to Outlook.com / Hotmail has never been
tested, and the caregiver cohort skews to those addresses. Microsoft **accepted** a send
(`Delivered` in Resend), but folder placement was never read. This does not touch Lane A, whose
conversion is a form post — but a Lane-B signup whose verification mail lands in an Outlook junk
folder is a conversion we paid for and lost silently. One send to a real Outlook address settles
it; do it in the pre-flight sitting if there is time, and record the result either way.

1. Open `https://relaystandby.com/caregivers?src=qa` in a **fresh browser profile or a new private
   window.** Not optional: the channel is parked in `sessionStorage` and survives the visit, so a
   profile that has ever carried another `src` will re-attribute this walk to it. That is exactly
   how a stray `src=visual-check` intent reached production analytics on 2026-08-10.
2. Confirm on the wire (devtools → Network → the first-party `…/event` POST) that
   **`caregiver_qualified`** carries `"src":"qa"`.
3. Click the priced CTA through to `/caregivers/interest`, and confirm **`caregiver_intent`**
   carries `"src":"qa"` and `"cta":"hero"`. **Both events must carry the same `src`** — numerator
   and denominator share one vocabulary or the ratio is not computable.
4. Submit the interest form once; confirm a `caregiver_leads` row with the `src` and click ID
   intact.
5. 🔴 **Lane B — the never-live-proven path.** From `/caregivers?src=qa`, take the subordinate link
   → sign up → **enrol TOTP** → seed → reveal → price card. Confirm the price CTA emits
   **`caregiver_intent`** with `"src":"qa"` and `"cta":"start"` *before* the Stripe redirect, and
   that it emits **exactly one**. **Do not complete the checkout** — stop at Stripe's hosted page.
   This path emitted no numerator at all between 2026-08-08 and 2026-08-10 (`lib/analytics/lane-b.ts`);
   the fix is pinned by `lane-b.test.ts` and has never been observed on the wire. If this step
   fails, **the flight does not launch** — a Lane-B visitor who buys would count in the denominator
   and not the numerator, which biases the gate toward a false KILL.
6. **Delete the test lead row and the test account before reading the gate.** `caregiver_leads` held
   **0 rows** at 2026-08-09; the flight must start from zero or N is contaminated from day one.

### Part 2 — one real click, to prove the platform passes `src` through

7. After the ad is approved, click it **once**. Confirm the landing URL carries `?src=reddit-ads`
   (or `meta-ads`) and that `caregiver_qualified` reports that value.
8. **Stop there — do not click the CTA.** One qualified with no intent is a conservative
   contamination (it moves the ratio *down*, never up), whereas completing the funnel would inflate
   it.
9. Record the click in `docs/g1-flight-log.md` under "known offsets", so the verdict subtracts it.

If any step 1–7 fails, **pause the campaign before fixing it.** Spend against a broken instrument
buys nothing, and a low reading from it would trip the <0.5% KILL threshold on evidence that does
not exist.
