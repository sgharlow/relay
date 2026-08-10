# Email DNS runbook — relaystandby.com

> Written 2026-08-08 after two Resend-accepted sends failed to land at a `cox.net` address.
> DNS changes are Steve's to apply per the standing infra policy; this file holds the exact values.
>
> **Updated 2026-08-08 after reading the Resend send log.** The first diagnosis in this file was
> wrong and is corrected in §1a. Both sends **bounced** — they were rejected at SMTP, not filtered.
> A bounce is a different failure from the one DMARC explains, and the log said so plainly. The
> lesson is the one already in `feedback-live-execution-beats-green-suites`: I reasoned from DNS I
> could query instead of the delivery log I could not, and reached a confident wrong answer.

## What is already correct

Verified live via DoH, so this is observed state and not the Resend dashboard's opinion:

| Record | Value | Status |
|---|---|---|
| `send.relaystandby.com` TXT | `v=spf1 include:amazonses.com ~all` | ✅ |
| `send.relaystandby.com` MX | `10 feedback-smtp.us-east-1.amazonses.com` | ✅ |
| `resend._domainkey.relaystandby.com` TXT | DKIM public key | ✅ |

SPF and DKIM authentication is set up properly. The Resend domain verification worked.

## 1a. What the send log actually said — the real cause

| To | Status | Subject |
|---|---|---|
| `sgharlow+relay@cox.net` | **Bounced** | Margaret Chen set something up for you |
| `sgharlow+relay@cox.net` | **Bounced** | Relay — third-party deliverability test |
| `sgharlow@gmail.com` | Delivered | Relay deliverability test #2 |

**Bounced, not filtered.** Cox rejected these at SMTP. A DMARC-driven failure at Yahoo looks like
quarantine or a silent drop, not a bounce, so the DMARC gap in §1 is *not* what happened here.

**Leading hypothesis: plus-addressing.** `cox.net` is served by `mta5/6/7.am0.yahoodns.net` — Yahoo
infrastructure. **Yahoo does not support `+tag` sub-addressing.** It treats `+` as an ordinary
character in the local part, so `sgharlow+relay@cox.net` is simply an unknown mailbox and rejects
with user-unknown. Gmail *does* support plus-addressing, which is exactly why the gmail send landed
and both cox sends did not. One variable, and it explains every row in the table.

Two consequences worth knowing:

- A hard bounce normally lands the address on **Resend's suppression list**. `sgharlow+relay@cox.net`
  may now be blocked at Resend regardless of what DNS says — resending to it proves nothing.
- The delivered row was sent from **`onboarding@resend.dev`**, not from our domain. So until test #3,
  `relay@relaystandby.com` had **never been proven to deliver anywhere**. The cox failure was
  masking an unproven variable rather than testing it.

**Test #3** (2026-08-08) separated the two: `sgharlow@gmail.com` proved the sending domain works at
all, and `sgharlow@cox.net` — same mailbox, no `+relay` tag — tested the addressing hypothesis. Both
went through `lib/notify/email.ts`, so the result also covers the production code path.

### Test #3 result — hypothesis confirmed, one problem left

| To | Status | Read |
|---|---|---|
| `sgharlow@gmail.com` | Delivered | **In the inbox.** First proof `relay@relaystandby.com` delivers. |
| `sgharlow@cox.net` | Delivered | Accepted by Yahoo's MX — **but not in the inbox.** |

**Plus-addressing is settled.** The identical mailbox bounced twice with `+relay` and was accepted
without it. Nothing else changed between the two attempts that would flip a hard SMTP rejection into
an acceptance. Never test a non-Gmail provider with a tagged address again.

**Reply-To is live-proven**, not merely wired: the reply to test A arrived, which exercises the whole
header path end to end.

**What remains is inbox placement at Yahoo, not authentication.** Resend marks `Delivered` when the
receiving MX returns SMTP 250 — Yahoo accepted the message and then decided where to file it. A
message that is accepted but absent from the inbox is in **Bulk/Spam**. Check that folder first; the
answer is almost certainly there.

That is a *reputation* problem, and it is the expected state for a domain whose first-ever messages
were sent this week:

- DMARC published minutes before the send. Yahoo caches DNS and builds sender history over days.
- Two hard bounces are the only prior history this domain has at Yahoo — the worst possible opening.
- Reputation is earned by consistent low-volume sending to engaged recipients, which is precisely
  what the G1 funnel will generate. Marking the message **Not Spam** in the Cox folder is the single
  highest-value manual action.

This does **not** block the ad flight. The G1 funnel's only email is the interest-form confirmation,
and Gmail — the largest consumer provider by a wide margin — is proven. It does mean Yahoo-family
recipients (`yahoo.com`, `aol.com`, `cox.net`) may land in Bulk for the first stretch, which matters
because the caregiver audience skews older and over-indexes on those providers. Recheck after the
first ~20 real sends.

## 1. DMARC — still required, just not the cause

There was **no `_dmarc` record**; one was added 2026-08-08 and is live. For a brand-new domain this
is still the highest-impact authentication gap and it needs to be right before paid traffic —
it simply was not what bounced these two messages.

Since February 2024 Yahoo and Google have required DMARC from bulk senders. Once ad traffic starts
and volume rises, an unauthenticated domain gets throttled or quarantined — so this belongs in place
before the spend, not after the first complaint.

**Live in Cloudflare DNS as of 2026-08-08** (verified by DoH, not by the dashboard):

| Field | Value |
|---|---|
| Type | `TXT` |
| Name | `_dmarc` |
| Content | `v=DMARC1; p=none; rua=mailto:dmarc@relaystandby.com; fo=1` |

`p=none` is deliberate: it asks receivers to report rather than reject, which is the correct
starting posture for a domain with no reputation. Tighten to `p=quarantine` only after the
aggregate reports show authentication passing consistently.

The `rua=` address needs to exist to receive reports — Email Routing (step 2) covers it.

## 2. Reply capability — Cloudflare Email Routing

`relay@relaystandby.com` currently **cannot receive replies**; the apex has no MX record. A
caregiver who gets *"someone is asking for access to your parent's vault"* and hits reply is
talking to nobody, which is a poor look for a product selling trust.

**Shipped in code as of 2026-08-08 — replies work now.** `lib/notify/email.ts` sets a `Reply-To`
header from `RESEND_REPLY_TO_ADDRESS` (set in `.env.local` and Vercel production; currently
`sgharlow+relay@gmail.com`, which is the same address the privacy and terms pages already publish).
That makes replies reach a human today without any DNS change. Pinned by four tests, including one
asserting the header is **omitted** rather than sent empty when the variable is unset.

Email Routing below is still worth doing — it makes `relay@relaystandby.com` itself receive mail, so
the From and Reply-To addresses match. Mismatched From/Reply-To is a mild spam signal and looks
slightly off to a careful reader, which is not what a trust product wants. Once it is enabled, point
`RESEND_REPLY_TO_ADDRESS` at `relay@relaystandby.com`; nothing else changes.

Cloudflare Email Routing forwards to an existing inbox, free, and adds the apex MX automatically.

**In the Cloudflare dashboard → Email → Email Routing → Enable.** It creates:

| Type | Name | Value | Priority |
|---|---|---|---|
| MX | `@` | `route1.mx.cloudflare.net` | 12 |
| MX | `@` | `route2.mx.cloudflare.net` | 46 |
| MX | `@` | `route3.mx.cloudflare.net` | 89 |
| TXT | `@` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | — |

Then add these custom addresses, both forwarding to a real inbox:

- `relay@relaystandby.com` → replies to notifications
- `dmarc@relaystandby.com` → the DMARC aggregate reports from step 1

⚠️ **Apex SPF interaction.** Email Routing adds an apex SPF record for *inbound* routing. Resend
sends from the `send.` subdomain, which carries its own SPF, so the two do not conflict — but do
**not** replace the `send.` record with the apex one, and do not merge them.

## 3. Diagnosing where the two sends actually went

Resend accepted both (message ids returned), so they left our side. The **Resend dashboard →
Emails** shows per-message status: `delivered`, `bounced`, `complained`, or `deferred`.

That distinction decides the next move, and no amount of resending will reveal it:

| Dashboard says | Meaning | Action |
|---|---|---|
| `bounced` | Cox rejected at SMTP | Read the bounce reason; usually policy/reputation |
| `delivered` | Cox accepted it | It is in spam or a Yahoo policy folder — DMARC is the fix |
| `deferred` | Greylisted, still retrying | Wait; new-domain greylisting is normal |

The API key in `.env.local` is **send-only**, so this cannot be queried programmatically. The
dashboard is the fastest path.

## 4. Retesting

Run `npx tsx --env-file=.env.local _send-test.ts` (gitignored scratch script), then read the Resend
log — **not** the local console. `ACCEPTED` only means Resend took the message; the bounces above
were all "accepted" too. That distinction is the entire point of this file.

Prefer a **consumer** address for the test (Gmail, Outlook.com, Yahoo/Cox). A corporate mailbox is
the hardest possible target — enterprise filters such as Microsoft 365 and Proofpoint are far more
aggressive than consumer providers, so a failure there tells you nothing you did not already know,
and a success there does not predict consumer delivery. Test the audience you are actually
emailing: caregivers on consumer email.

**Avoid `+tag` addresses when testing non-Gmail providers.** Yahoo, and therefore Cox, reject them.
Any bounce from a tagged address is about the tag, not about your domain's reputation.

## 5. What still is not proven

Delivery to **Outlook.com / Hotmail** has never been tested, and Microsoft consumer filtering is
stricter than Gmail's. Worth one send before paid traffic, since the caregiver audience skews older
and Hotmail/Outlook addresses are common in that cohort.

---

## 6. Cloudflare Email Routing — LIVE and proven (2026-08-09)

Steve enabled Email Routing on the zone; the verification below was run immediately after and is
the record of what was actually measured, not what was expected.

### DNS as it now stands (read with node `dns.resolveTxt` — Windows `nslookup` false-negatives TXT)

| Record | Value | Meaning |
|---|---|---|
| `MX relaystandby.com` | `route1/2/3.mx.cloudflare.net` | Routing is live; the apex can now receive |
| `TXT relaystandby.com` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | **Added by Cloudflare when routing was enabled** |
| `TXT send.relaystandby.com` | `v=spf1 include:amazonses.com ~all` | **INTACT** — this is the one Resend needs |
| `MX send.relaystandby.com` | `feedback-smtp.us-east-1.amazonses.com` | Untouched |
| `TXT _dmarc.relaystandby.com` | `v=DMARC1; p=none; rua=…; fo=1` | Untouched |
| `A relaystandby.com` | `76.76.21.21` | Site unaffected |

### ⚠️ The risk this created, and why it was tested rather than reasoned about

Enabling routing **rewrote the apex SPF**. SPF is evaluated against the envelope return-path, which
for Resend is `send.relaystandby.com` — so outbound is unaffected. But had the return-path been the
apex, the new record would have started failing SPF for every invitation, owner challenge and
verifier notification **the instant routing went on**, silently and with no code change to blame.

So both legs were sent through the app's own path (`lib/notify/email.ts`) and **read in the
mailbox**:

| Leg | To | Result |
|---|---|---|
| A — outbound control | `sgharlow@gmail.com` | ✅ **INBOX**, not spam — outbound survived the SPF change |
| B — inbound routing | `hello@relaystandby.com` | ✅ **INBOX** — routing forwards to the real mailbox |
| C — the From address | `relay@relaystandby.com` | ✅ **INBOX** — replies to notifications reach a human |
| D — catch-all probe | `support@relaystandby.com` | ❌ **never arrived** |

### 🚨 THERE IS NO CATCH-ALL — **SUPERSEDED 2026-08-09, see §7**

> A catch-all was enabled the same day and is proven delivering. The `support@` observation below
> was additionally confounded by Gmail's same-account deduplication; §7 has the correction and the
> rule that came out of it. The text is kept because the reasoning it records is still how the
> question should be approached.

Leg D is the finding to remember. Resend **accepted** the send — a 200 and a message id — and
Cloudflare then dropped it, because routing only delivers addresses that have been explicitly
created. Searched `in:anywhere` (spam and trash included); it is a real absence, not a delay.

Consequences:

- A customer who guesses `support@`, `info@` or `contact@relaystandby.com` gets **silence**, and
  nothing anywhere records that it happened.
- `lib/contact.ts` is therefore typed against a `ROUTED_ADDRESSES` list with a test asserting
  membership, so a plausible edit cannot quietly redirect the public address into a black hole.

**One-click improvement, Steve's call:** Cloudflare → Email → Routing → **Catch-all address** →
forward to the same inbox. It costs nothing and converts silent loss into delivered mail.

### Still not proven

`RESEND_REPLY_TO_ADDRESS` is a Vercel *sensitive* variable and reads back empty, so what a customer
sees in Reply-To could not be confirmed from here. It reaches a working inbox either way, and the
From address now routes. Changing it to `hello@relaystandby.com` would make From and Reply-To match
— but it could not be verified or reversed from a session, so it was deliberately left alone.

Outlook.com / Hotmail delivery (§5) remains untested and is still worth one send before paid
traffic.

---

## 7. Catch-all enabled — and §6's `support@` finding CORRECTED (2026-08-09)

**§6's "THERE IS NO CATCH-ALL" is superseded.** Steve enabled the catch-all; it forwards to
`sgharlow@gmail.com` and is Active alongside the explicit `hello@`, `relay@` and `dmarc@` rules.

### Proven delivering

Three *different invented* addresses arrived, which is what distinguishes a real catch-all from a
few hand-created aliases — plus `admin@` and `info@`, plus `hello@`/`relay@` with no regression.

### ⚠️ The trap that nearly produced a false finding

`support@` appeared to fail **five times** — in a burst, sent alone, and spaced 8s apart — while
every other address succeeded. Two wrong conclusions were within reach: "catch-all is broken" and
"there is a Drop rule on support@". Both were wrong, and the dashboard disproved the second.

**Cloudflare itself supplied the answer**, via an automated notice it sends for exactly this case:

> Are you missing an email sent from sgharlow@gmail.com to support@relaystandby.com? Some email
> clients, such as Gmail, deduplicate emails. An email sent from the same account may not show up
> in your inbox.

**Gmail deduplicates by Message-ID.** Routing forwards the message *to the same Gmail account that
sent it*, so Gmail sees a Message-ID already in Sent and suppresses the inbox copy. Verified: the
test message exists with label **`SENT` only**, no `INBOX` copy — and the very existence of
Cloudflare's notice proves Cloudflare **received and forwarded** the message to `support@`.

**RULE: never test a forwarding rule by sending from the account it forwards to.** Absence is
unfalsifiable there — a working route and a broken one look identical. Send from an unrelated
address, which is why the probes in §6 used the app's own Resend path rather than the destination
inbox.

### 🔴 CONFIRMED 2026-08-09 — Resend SUPPRESSION, read from the dashboard

The hypothesis below is **confirmed**. Resend's Emails list shows both `support@relaystandby.com`
sends with status **`Suppressed`** and no Sent timestamp, while every other address on the same
path in the same minutes reads **`Delivered`**.

**The trap, precisely:** `emails.send` returned **200 with a message id** for every suppressed
send. The application saw success. Nothing was ever transmitted. `sendEmail` was hardened in
§1a to stop treating a Resend *error* as success — suppression is not an error, so it sails
straight through that guard.

`support@` earned its suppression by hard-bouncing on the very first probe, when no route existed
for it. **One bounce, and that recipient is muted indefinitely** — the address now routes perfectly
(catch-all delivers it) and Resend still will not send to it.

ORIGINAL HYPOTHESIS FOLLOWS.

The five `support@` failures above were sent through **Resend**, not from Gmail, so same-account
dedup does not explain them. Every other address on the same path arrived. The leading hypothesis
is a **Resend suppression**: `support@` is the one address probed *before* any route existed, so it
hard-bounced, and ESPs suppress previously-bounced recipients — while `emails.send` still returns
`200` and a message id. It could not be confirmed from here: the API key is **send-only** and
`GET /emails/:id` returns **401**.

**This matters beyond the test.** Relay's invitations, owner challenges and verifier notifications
all go through this path. If a recipient bounces once — full mailbox, temporary outage — every
later send to them may be silently suppressed while the code records success. That is precisely the
failure mode `sendEmail` was hardened against at the API level, reappearing one layer down.

Worth checking in the Resend dashboard: **Suppressions / bounced addresses**, and whether
`support@relaystandby.com` is listed. If it is, the hypothesis is confirmed and the product needs a
view on suppression before it depends on notifying people at a crisis moment.

---

## 8. Outlook delivery — ACCEPTED by Microsoft (2026-08-09)

A realistic verifier-confirmation notification (not a bare ping — content shape is an input to
filtering, and a terse token message is itself spam-shaped) was sent to `relaystandby@outlook.com`.

**Resend reports `Delivered`.** Microsoft **accepted** it: not rejected, not dropped, not deferred.
So authentication and reputation cleared the door — SPF, the apex-aligned DKIM at
`resend._domainkey.relaystandby.com`, and DMARC all pass, and the domain is on no blocklist
(Spamhaus DBL, SURBL both clean).

⚠️ **`Delivered` is the ESP's word for "the receiving server took it" — it says NOTHING about
which folder.** Inbox vs Junk is decided after acceptance and is invisible from this side. It has
to be read in the mailbox; **check Junk explicitly**. The apex-SPF question raised as a possible
cause is moot: it did not block acceptance.

## 9. 🔴 The suppression risk this exposed — OPEN, and it is a product risk

`sendEmail` cannot tell a suppressed send from a delivered one. Both return 200 and a message id.
That matters far beyond a test address, because these ride the same path:

- verifier confirmation requests — the message that releases access during an emergency
- owner challenges, invitations, access-request notifications

**A recipient who bounces once — full mailbox, a bad afternoon at their provider, a typo'd address
that later gets fixed — is muted from then on, while the code records success.** For a product
whose entire function is reaching a human at the worst moment of their week, that is a silent
single point of failure, and it is the exact shape the portfolio rule about dead-man's switches
exists to prevent: the absence of the signal is not monitored.

**Immediate: ✅ DONE 2026-08-09.** `support@relaystandby.com` removed from Resend → Suppression
list by Steve, and re-verified end to end: a send through `lib/notify/email.ts` arrived in the
**INBOX**. Resend → Cloudflare catch-all → mailbox all work for the address that started this
investigation. Note the removal is manual and per-address — it does not change the behaviour below.

**Structural (design, NOT yet built — G1 sequencing applies):** subscribe to Resend webhooks
(`email.bounced`, `email.complained`, `email.delivery_delayed`), persist per-recipient delivery
state, and surface "we could not reach X" to the OWNER — who is the only person able to fix a bad
address for a verifier. A release that silently waits on an unreachable verifier is worse than one
that fails loudly.

Do not treat `recordSend()` as covering this: it records what the app attempted, not what the
provider did with it.
