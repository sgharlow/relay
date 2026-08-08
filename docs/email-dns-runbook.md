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
