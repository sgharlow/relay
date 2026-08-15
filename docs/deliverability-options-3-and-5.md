# Options 3 and 5 — the two that are not Claude's to execute

> Written 2026-08-14, after shipping options 1, 2 and 4 (see `git log`). Those three are code and
> are done. These two need money, business identity, or an infrastructure decision, so what follows
> is the homework rather than the work.
>
> ⚠️ **Every figure below was verified live on 2026-08-14 from the source named beside it.**
> Vendor pricing and carrier fees move — re-verify before acting on any of them, and do not quote
> them from this file into another document. If you only take one thing from each section, take the
> recommendation, not the number.

---

## Where the problem actually stands

Two hypotheses have been tested against a real Outlook mailbox and **both were refuted**:

| # | Hypothesis | Result |
|---|---|---|
| 1 | Reply-To pointed somewhere unhelpful (2026-08-09) | 🚫 Refuted — SCL unchanged |
| 2 | Message shape: every Relay message was `text/plain` only (2026-08-14) | 🚫 Refuted — both arms SCL 5, byte-identical `X-Message-Delivery`, and the HTML arm fired *two extra* ARA rules |

Authentication is flawless in every sample (`compauth=pass reason=100`, `BCL:0`, `ucf:0`, `jmr:0`)
and four distinct sending IPs across two runs all scored SCL 5 — so the IP is not the discriminator
either.

**What survives is shared-pool and new-domain sending reputation.** Options 3 and 5 are the two
proposals that claim to reach it. One of them does not, and that is the main finding here.

---

## Option 5 — move critical mail to a dedicated sending identity

### The dedicated-IP version is not available to Relay, and would be the wrong move if it were

**Not available.** Resend gates dedicated IPs at *"$30 / mo: Available on the Scale plan to
customers exceeding 3,000 emails sent per day"* (resend.com/pricing, read 2026-08-14). Scale starts
at $90/mo. Relay's own real-address delivery record is **14 delivered messages across 9 addresses**
— re-derive it, but it is not within three orders of magnitude of 3,000 *per day*.

**And wrong anyway.** A dedicated IP starts with no reputation at all and has to be warmed, which
takes weeks of *consistent* volume. Published floors from other vendors, read 2026-08-14: Mailgun
~50,000/week, Postmark ~300,000/month, with general guidance that below ~50,000/month a dedicated IP
*"struggles to generate enough signal to maintain a reputation, and inconsistent volume lets it
decay."*

Relay's sending profile is the worst possible fit for that. It is not merely low volume — it is
**bursty by design**. A release is a rare event; most weeks the product should send almost nothing.
A dedicated IP would sit cold between bursts and then be asked to carry the one message that
matters, on the one day it matters. That is strictly worse than riding a pool that is already warm.

> **Verdict: do not pursue a dedicated IP.** Not "blocked on budget" — refuted on mechanism.

### The dedicated-subdomain version attacks the wrong half

Moving the From address to something like `alerts.relaystandby.com` is cheap, reversible, and sits
behind the existing `sendEmail` seam. It is also pointed at the wrong half of the surviving
hypothesis: that hypothesis includes **new-domain** reputation, and a subdomain created this week is
by definition newer than the apex, which at least has whatever history it has accumulated since
2026-06. Expected effect: neutral at best, mildly negative at worst.

It is worth doing for *isolation* reasons — keeping Relay's reputation independent of a sibling
product's — but note that the Resend account being shared with report-bridge does not put them on
different IP pools, so it does not address the "shared pool" half either.

> **Verdict: not a fix. Only worth doing if isolation becomes desirable for another reason.**

### What IS available, free, and aimed at the measured symptom

**Microsoft's own sender support path.** Microsoft maintains a submission route for Outlook.com /
Hotmail / Live / MSN delivery problems (support.microsoft.com "Sender Support in Outlook.com", and
the Postmaster troubleshooting page under *Sender services, tools, and issue submission*, both read
2026-08-14). It asks for exactly the evidence this investigation has already captured: IPs, domains,
full headers, UTC timestamps, sample recipients, message IDs, and recent sending changes.

Relay has all of it: two message IDs (`RLY-CTRL-A118`, `RLY-HTML-B227`), full headers showing SCL 5
with `compauth=pass reason=100`, the ARA rule IDs (`9400799043`, `30041999003`), and four distinct
sending IPs.

- **Cost:** nothing. **Infrastructure change:** none. **Rollback:** not applicable.
- ⚠️ **One complication:** the form wants IPs, and Relay does not own them — Resend does. Expect to
  either file it alongside a Resend support ticket, or ask Resend to file it. That is the first
  step, not a blocker.
- 🔴 **DO NOT CLICK "IT'S NOT JUNK"** on the two test messages sitting in `skillcrossroads@outlook.com`.
  They are the evidence for this submission. Marking them trains the filter and destroys the
  baseline in the same click.

> **Recommendation: replace option 5 with this.** It is the only remaining action that targets the
> surviving hypothesis, and it is free.

---

## Option 3 — SMS for critical alerts only

The design constraint is settled and does not change: **the message carries no code and no link**,
so principle 1 stays intact. It is a nudge — *"something needs you, sign in the way you normally
do"* — exactly like the credential-free email notices that options 2 and 4 already fan out.

### The gate is US A2P 10DLC registration, and it is lead time, not difficulty

Figures below are Twilio's published fees plus carrier pass-throughs, read 2026-08-14. Other
providers differ; the registry (TCR) fees behind them do not.

| Item | Sole Proprietor | Standard brand |
|---|---|---|
| Brand registration | ~$4 one-time | ~$48+ one-time, includes secondary vetting |
| Campaign vetting | ~$15 one-time | ~$15 one-time |
| Campaign, monthly | ~$2/mo | ~$1.50–$10/mo |
| Carrier surcharge | ~$0.003–$0.005 per SMS | same |

**Timeline:** brand approval 1–3 business days; campaign 3–7 business days, but reported at
**10–15 days through mid-2026** on volume. Call it 2–4 weeks end to end, and treat that as the
number that matters — the money is noise at Relay's scale.

### Three traps worth knowing before starting

1. **Sole Proprietor is only for senders with NO business Tax ID.** If Relay has an EIN, that route
   is closed and it is a Standard (or Low-Volume Standard) brand — more vetting, higher fee.
2. **OTP verification must use a real US/Canada *mobile* number.** VoIP numbers, including Twilio's
   own, are rejected. And that number carries a **lifetime three-use limit across all vendors** —
   so it must not be spent on an experiment.
3. **Sole Proprietor campaigns allow exactly one 10DLC number** and low throughput.

### Recommendation

**Start the registration now, on its own clock, and gate nothing on it.** It is almost entirely
waiting, so the cost of starting early is a few dollars and the cost of starting late is two to four
weeks at the moment SMS is actually wanted.

**Build no SMS code until the brand and campaign are approved.** An SMS seam written against an
unapproved campaign is "wired, not live-proven" — response shapes and error paths that have never
touched the real API — and this portfolio has a rule about exactly that. The right first commit is
after there is a number that can send.

---

## Live verification, 2026-08-14 — read-only, against production

Every test in this repo mocks the database, so nothing in the 2,150-odd of them can catch a wrong
column name or a wrong assumption about what production actually contains. These checks were run
directly against the live cluster, SELECT-only, and are worth repeating before beta.

**1. The schema assumptions hold.** `email_secondary` exists on **both** `recipients` and
`verifiers` — migration 020 *is* applied, so the option-2 work will not 500 on the first `/circle`
load. Every column the fire drill and the silence sweep query (`audit_log.entity_id`, `ts`, `actor`,
`entity`, `detail`; `release_state.received_confirmations` / `required_confirmations`;
`verifier_confirmations.verifier_id`) is present.

**2. The Resend webhook is live and current** — 73 events, newest minutes before the check. So
`DeliveryLine` will have something to say. It was worth proving: that component renders *nothing*
until the webhook is configured, and shipping honest copy onto a surface fed by nothing would have
been its own kind of false green.

**3. A 75% "delayed" rate that is NOT ours.** 55 of 73 events are `email.delivery_delayed`, which
looks alarming until it is split by recipient domain:

| Recipient domain | Events | Delayed | Delivered | Bounced |
|---|---|---|---|---|
| `relay.test` | 18 | 18 | 0 | 0 |
| `gmail.com` | 14 | 0 | **14** | 0 |
| `*.report-bridge.com` (synthetic) | ~39 | ~38 | 0 | 1 |
| `outlook.com` | 3 | 0 | **3** | 0 |

Every delay is synthetic or test traffic. **Relay's real addresses are clean: 14/14 delivered to
Gmail, 3/3 "delivered" to Outlook, nothing bounced.** Never read this table without splitting it —
the webhook is account-scoped and `/api/resend/webhook` has no sender-domain filter.

**4. 🔴 The false green is sitting in production right now.** Those three `outlook.com` rows are
`email.delivered`, and we know from the A/B that at least two of those messages were filed to Junk.
That is the defect option 1 corrects, visible in live data rather than only in test headers.

**5. The roster is empty**, so the new per-person lines have nobody to render for yet. Expected
pre-beta, and consistent with the G1 baseline — but it does mean none of these surfaces has been
seen with real data, only rendered and screenshotted in isolation.

### A bug this found, and one it did not fix

`runHeartbeatSweep` excludes `is_demo_account` for a documented reason: `demo@relay.test` is live in
production, its owner address is in a reserved domain that cannot receive mail, and an unattended job
mailing it means **hard bounces on a Resend account shared with report-bridge**, where the reputation
cost lands on a different project. The 18 `relay.test` rows above are that address already collecting
delivery failures.

**The new verifier-silence sweep had no such guard and now does** — it joins `users` on
`is_demo_account = false`, as a join rather than a filter so a row that must never be mailed is never
fetched. Caught by asking production what was in the table, not by any test.

**The other two unattended senders were then checked, and are correctly unguarded.** An earlier
draft of this file flagged them as suspicious; that flag was wrong and is retracted here rather than
left to worry somebody.

| Path | Mails whom | Guarded? |
|---|---|---|
| `runHeartbeatSweep` | arms triggers, then owner + verifiers | ✅ yes — unattended *origination* |
| `sweepSilentVerifiers` | the **owner**, at `users.email` | ✅ yes — that is the reserved address |
| `resolveElapsedGrace` | recipients only | ⛔ correctly not — see below |
| `escalateLapsedRequests` | verifiers only | ⛔ correctly not — see below |

The last two mail **contacts, not the owner**, and the seed's contacts were deliberately made
deliverable (`lib/seed/demo-data.ts` sub-addresses them to a real inbox — the live table shows them
delivering 14/14). Only the owner address stays `demo@relay.test`. And a demo can only reach those
states through `/api/demo/simulate`, which is explicit and driven by a person who meant it, so
completing it is the intended behaviour rather than a stray send.

The rule that falls out — *guard unattended origination, and guard unattended owner-directed mail* —
is now pinned by a cross-cutting test in `lib/ops/outbound-mail-bounds.test.ts`, deliberately narrow
so it does not force the guard onto the two paths that must not have it.

## The authentication posture, and a telemetry stream nobody was reading

Read live from DNS on 2026-08-14. "SPF/DKIM/DMARC pass" was already established by the header
analysis; *passing* and *a strong posture to a receiver deciding how to treat a new domain* are not
the same question, and the second one had never been asked.

```
_dmarc.relaystandby.com   v=DMARC1; p=none; rua=mailto:dmarc@relaystandby.com; fo=1
relaystandby.com    TXT   v=spf1 include:_spf.mx.cloudflare.net ~all
relaystandby.com    MX    route1/2/3.mx.cloudflare.net
send.relaystandby.com TXT v=spf1 include:amazonses.com ~all
send.relaystandby.com MX  feedback-smtp.us-east-1.amazonses.com
```

Everything here is *correct*. The apex SPF authorises Cloudflare's routing servers and not Amazon,
which looks alarming for about ten seconds until you remember SPF is checked against the envelope
sender — that is on `send.relaystandby.com`, which includes `amazonses.com`. That is why SPF passes.
The apex now has MX records too, so the domain can receive mail, which is itself a mild positive
signal and closes the old "no apex MX" note.

**🔴 The finding: Microsoft has been sending us DMARC aggregate reports, and they are being thrown
away.** `rua=` is set with `fo=1`, the domain has a catch-all, and `dmarc@relaystandby.com` is
receiving reports from `dmarcreport@microsoft.com` (submitter `protection.outlook.com`) as well as
from Google. Several — including one of the two Microsoft reports — are sitting in **Trash**. The one
receiver-side telemetry channel this domain has was configured, has been flowing for at least a week,
and has never been read by anybody.

⚠️ **Be clear about what it will and will not say, so nobody raises their hopes.** A DMARC aggregate
report gives per-source-IP counts with SPF/DKIM alignment results and the **policy disposition**
applied. It does **not** report spam scoring or folder placement — there is no SCL in it, and no
"we junked this". So it will *not* explain the filing on its own.

What it is genuinely good for, and why it is worth preserving anyway:

1. **It would reveal a sender we do not know about.** If anything other than Resend/SES is emitting
   mail as `relaystandby.com`, that is a real and unconsidered reputation cause, and this is the only
   place it would show up. Nobody has looked.
2. **It is the evidence base for moving off `p=none`.** The domain is at monitoring only. Going to
   `p=quarantine` once the reports confirm every legitimate source aligns is the standard
   reputation-building step for a new domain, and it materially strengthens the Microsoft submission
   — "we monitor DMARC and are moving to enforcement" is a different conversation from "we pass".

### Two more things the mailbox settled

**The ESP has never once complained about us.** A 60-day sweep for bounce, complaint, suppression,
reputation or sending-review notices from Resend or SES found **nothing** — only invoices, a
subprocessor notice and a product newsletter. That is a meaningful negative: if our complaint rate or
bounce rate were the problem, this is where it would have shown up first, and it hasn't. It is
consistent with everything else — our mail is clean, well-authenticated, and unwanted only by
Microsoft's filter.

**The Resend plan is Transactional Pro** (confirmed from the renewal notice, renews 2026-08-15). So
the dedicated-IP path is gated **twice** over, not once: it needs a plan upgrade to Scale *and*
>3,000 emails/day. That strengthens rather than changes the verdict above.

### 🔴 A deadline nobody set

Gmail purges Trash after **30 days**. The trashed DMARC reports were received 2026-08-11 to
2026-08-13, so they are destroyed around **2026-09-10**. After that the earliest receiver-side
evidence this domain has ever produced is gone permanently, including one of only two Microsoft
reports. Rescuing them is a two-minute job with a real expiry date on it.

### Recommended, in order

1. **Stop discarding them** (free, no risk): a Gmail filter that labels anything from
   `dmarcreport@microsoft.com` / `noreply-dmarc-support@google.com` and never trashes it — **and
   untrash the ones already in there, before ~2026-09-10.** Do this before anything else, because
   every report thrown away is a week of evidence gone.
2. **Read the last two weeks** and confirm 100% of volume is Resend/SES and aligned. That is a
   fifteen-minute job with any free DMARC XML viewer.
3. **Only then**, consider `p=none` → `p=quarantine`, and `~all` → `-all`.

🔴 **Step 3 is a DNS change to a working mail setup and is Infrastructure-Change-Policy gated.** It
carries real risk — an SPF or DMARC edit that gets it wrong stops mail leaving at all, and this
domain's SPF has already been silently rewritten once by enabling Cloudflare Email Routing. It needs
a documented problem, a snapshot of the current records, and Steve's explicit go. **Not done here,
and it must not be done casually as a "best practice" tidy-up.**

## What none of this changes

Beta is not blocked. The calm-day path is email-free by design (`BETA_INVITE_CHANNEL='owner'`, claim
needs no email, contacts sign in by claim code or passkey), and options 1, 2 and 4 have shipped:
the screen no longer claims a junked message arrived, credential-free notices reach a second address,
a rehearsal measures whether a human can actually be reached, and a release that nobody answers now
tells the owner to pick up a phone.
