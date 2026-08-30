# Outlook sender-support submission — ready to send

> This replaces option 5. The dedicated-IP version is refuted on mechanism and the subdomain version
> aims at the wrong half of the hypothesis — see `docs/deliverability-options-3-and-5.md`. This is
> free, changes no infrastructure, and is the only remaining action pointed at the measured symptom.
>
> **Steve does two things: opens a Resend ticket (step 1), then submits the Microsoft form (step 3).**
> Everything else below is already written.

---

## 🔴 Before anything: do not touch the evidence

The two test messages are sitting in **`skillcrossroads@outlook.com`**.

- **Do NOT click "It's not junk"** on either. That trains the filter, destroys the baseline, and
  removes the very thing this submission is built on.
- Do not delete them. Step 2 reads two fields out of their headers.
- Do not send anything else to that mailbox from Relay until this is closed.

---

## Step 0 — two minutes, and do it today regardless of everything else

**Stop throwing away the DMARC reports.** `dmarc@relaystandby.com` has been receiving aggregate
reports from `dmarcreport@microsoft.com` and from Google for at least a week. Several are already in
**Trash**, including one of the two Microsoft ones.

Add a Gmail filter — from `dmarcreport@microsoft.com` OR `noreply-dmarc-support@google.com` → apply a
label, never delete. Then **untrash the ones already in there.**

> ⚠️ **RE-MEASURED 2026-08-29 (C1.4). Two things above are wrong, and the second one ends this
> lane until a DNS record is fixed.**
>
> **1. Nothing is in Trash, and no rescue deadline is running.** All **10** aggregate reports for
> `relaystandby.com` are retained and carry the `DMARC` label — none carries `TRASH`
> (`from:(dmarcreport@microsoft.com OR noreply-dmarc-support@google.com) in:trash` returns
> nothing at all, across every domain). The 08-11..13 batch was rescued on 2026-08-15, and the
> 08-14..17 reports that a superseded note recorded as "in Trash now, expiring ~2026-09-14..16"
> are labelled and safe. **There is no two-minute rescue left to do and no clock counting down.**
>
> **2. ✅ THE FEED IS RESTORED — 2026-08-30. The prerequisite this submission was waiting on is
> met.**
>
> It *was* dead: found 2026-08-27 and re-measured 2026-08-29, `_dmarc.relaystandby.com` read exactly
> `v=DMARC1; p=none`, so no aggregate report could arrive from any receiver. The mailbox agreed
> independently and was the more convincing half — the newest of twelve reports was **2026-08-17**,
> on a domain that had been receiving them daily from both Google and Microsoft.
>
> C1.0 was executed on **2026-08-30**. The record now reads:
>
> ```
> v=DMARC1; p=none; rua=mailto:dmarc@relaystandby.com; fo=1
> ```
>
> `p=none` is deliberately unchanged — the step up to `quarantine`/`-all` is a separate decision
> that must wait until reports have accumulated, or it is taken blind, which is what this lane has
> said all along.
>
> Verified from **two independent resolvers** on 2026-08-30 (`cloudflare-dns.com` and `dns.google`),
> over DoH rather than the local resolver, which refuses on this machine. Re-derive rather than
> trust it:
>
> ```bash
> node -e 'fetch("https://cloudflare-dns.com/dns-query?name=_dmarc.relaystandby.com&type=TXT",{headers:{accept:"application/dns-json"}}).then(r=>r.json()).then(d=>console.log((d.Answer||[]).map(x=>x.data).join(" ")))'
> ```
>
> ⚠️ **RESTORED IS NOT YET PROVEN, and the difference decides when to send.** A DNS record that
> reads correctly is not the same claim as a report that arrived. Receivers send aggregate reports
> on a daily cycle, and as of 2026-08-30 none has arrived since the change — expected, not a
> finding. The register carries this as `wired`, not `live-proven`
> (`deferred.dmarc-had-no-rua-so-no-report-could-arrive`), and it closes when a report dated after
> 2026-08-30 lands.
>
> **What that means for this submission:** wait for one report before sending, so the
> receiver-side evidence cited below is current rather than historical. That is a day, not a
> blocker.
>
> Gmail, read-only, to check:
> `from:(dmarcreport@microsoft.com OR noreply-dmarc-support@google.com) to:dmarc@relaystandby.com`
> — count them and read the newest date. That date is the health of the feed.

🔴 **This has a real deadline.** Gmail purges Trash after 30 days and those reports arrived
2026-08-11 to 2026-08-13, so they are destroyed around **2026-09-10** — including one of only two
Microsoft reports this domain has ever received. Every report discarded is a week of receiver-side
evidence gone, and it is the only such stream we have.

> ⚠️ **Claude cannot do this, and it is not a policy choice.** Steve authorised it on 2026-08-14 and
> both attempts — `create_label` and `untrash_thread` — were refused by Google with *"Request had
> insufficient authentication scopes."* The Gmail connector holds **read-only** OAuth scopes, so it
> can find and read these reports and can move nothing. Filter creation is not exposed to it at all,
> at any scope. **This step is genuinely yours; do not wait on Claude for it.**
>
> The three trashed threads, so you can find them fast:
>
> | Received | From | Thread ID |
> |---|---|---|
> | 2026-08-12 | `dmarcreport@microsoft.com` ← **the important one** | `19ff4ba2c04e90c4` |
> | 2026-08-11 | `noreply-dmarc-support@google.com` | `19ff5db751e24c0f` |
> | 2026-08-13 | `noreply-dmarc-support@google.com` | `1a002aa0909b5b86` |
>
> Or just search Gmail for `in:trash subject:"relaystandby.com"`. Four more reports are already safe
> under an existing label; these three are the ones on the clock.

⚠️ It will **not** show junk placement — DMARC reports carry authentication results and policy
disposition, never a spam score. Its value is that it would reveal any sender emitting mail as
`relaystandby.com` that we do not know about, and it is the evidence base for moving off `p=none`.

---

## Step 1 — Resend ticket first (Steve, ~5 minutes)

The Microsoft form asks for **sending IPs**, and we do not own them — Resend does, and it rides
Amazon SES shared IPs. Two outcomes are both fine: Resend files the mitigation themselves (best), or
they confirm we may cite their IPs and we file it ourselves.

Send this to Resend support:

> **Subject:** Outlook.com filing our authenticated mail to Junk at SCL 5 — request for mitigation
> support
>
> Hello,
>
> We send low-volume transactional mail from `relay@relaystandby.com` (domain verified with you;
> return path on `send.relaystandby.com`). Every message we send to outlook.com/hotmail/live
> addresses is filed to Junk, and we have measured it carefully enough to rule out everything on our
> side.
>
> On 2026-08-14 we ran a contemporaneous A/B to a freshly created outlook.com mailbox that had never
> been contacted by us — control sent first, variant 90 seconds later, one variable changed
> (`text/plain` only vs `multipart/alternative`). Both arms:
>
> - `X-MS-Exchange-Organization-SCL: 5`
> - `X-Message-Delivery` byte-identical base64, decoding to `SCL=6`
> - `dest:J`, `RF:JunkEmail`, `OFR:SpamFilterAuthJ`
> - SPF, DKIM and DMARC all pass, `compauth=pass reason=100`, `BCL:0`, `ucf:0`, `jmr:0`
>
> `jmr:0` and `ucf:0` confirm no user-level rule or complaint is involved, and `compauth=pass
> reason=100` confirms authentication is not the issue. An earlier test on 2026-08-09 changing
> `Reply-To` produced the same score.
>
> The four messages left on four different shared IPs in your pool —
> `54.240.48.188`, `54.240.11.161`, `54.240.11.140`, `54.240.11.138` — and every one scored SCL 5,
> so this does not look like a single bad IP either.
>
> Two questions:
>
> 1. Are you able to raise a mitigation request with Microsoft on our behalf for this sending
>    infrastructure? Microsoft's sender support form asks for IPs we do not control.
> 2. If not, may we cite those IPs in a submission we file ourselves, and is there a reference or
>    contact you would like included?
>
> Happy to supply full raw headers for all four messages.
>
> Thank you,
> Steve

---

## ~~Step 2 — two fields only you can read~~ ✅ DONE 2026-08-15

Captured by browser automation against the live mailbox, read-only — the messages were opened, the
source read, and nothing was clicked, moved or marked. Values are in the submission below.

⚠️ **A date correction fell out of this.** These messages are timestamped **15 August 2026 UTC**
(`03:16:37Z` and `03:18:08Z`), not 14 August. Everything written about "the 2026-08-14 test" used the
local (PDT) date. The evidence is unchanged; only the label was off, and a submission to Microsoft
needs the UTC values, which are the ones quoted below.

🔴 **A SECOND DEADLINE, found in the mailbox and previously unknown.** Outlook shows
*"Items in Junk Email will be permanently deleted after 10 days."* These arrived 14–15 August, so
**they are destroyed around 2026-08-24** — sooner than the DMARC-in-Trash deadline. Everything
needed for this submission has now been extracted, so the messages are no longer load-bearing, but
if a re-read is ever wanted it has to happen before then.

---

## Step 3 — the submission (Steve pastes, signs in, sends)

**Where:** Microsoft's sender support route — `support.microsoft.com` → *Sender Support in
Outlook.com*, or the Postmaster troubleshooting page under *Sender services, tools, and issue
submission*. It requires signing in with a Microsoft account. (Verified present 2026-08-14; if the
page has moved, search "Outlook.com sender support" rather than guessing at a URL.)

**⚠️ Not the Office 365 IP Delist Portal.** That is for a *blocked* IP. Nothing here is blocked —
mail is accepted and filed to Junk, which is a filtering-decision issue, not a delisting one.

Paste this as the description:

> **Summary:** Authenticated, low-volume transactional mail from `relaystandby.com` is filed to Junk
> at SCL 5 for every outlook.com/hotmail/live/msn recipient, including on a freshly created mailbox
> with no prior contact and no user rules. We have eliminated every sender-side cause we can test.
>
> **Sending domain:** `relaystandby.com` (From: `relay@relaystandby.com`; return path
> `send.relaystandby.com`). ESP: Resend, on Amazon SES shared IPs.
>
> **Sending IPs observed:** `54.240.48.188`, `54.240.11.161`, `54.240.11.140`, `54.240.11.138`.
> These are our provider's shared IPs, not ours. All four scored identically.
>
> **What the mail is:** transactional notifications for a personal continuity service. A message
> tells a named, previously consented contact that something needs their attention and asks them to
> sign in to our site. There is no marketing, no list, no bulk send, and no purchased addresses.
> Recipients are individually named by the account holder and have accepted an invitation. Volume is
> very low and bursty by design — most weeks are near zero.
>
> **Test performed, 2026-08-14:** contemporaneous A/B to a newly created outlook.com mailbox never
> previously contacted by us. Control sent first, variant 90 seconds later, exactly one variable
> changed (`text/plain` only vs `multipart/alternative`).
>
> Both arms produced:
> - `X-MS-Exchange-Organization-SCL: 5`
> - `X-Message-Delivery`: byte-identical base64, decoding to `SCL=6`
> - `dest:J`, `RF:JunkEmail`, `OFR:SpamFilterAuthJ`
> - SPF pass, DKIM pass, DMARC pass, `compauth=pass reason=100`
> - `BCL:0`, `ucf:0`, `jmr:0`
>
> The HTML arm additionally fired ARA rules `9400799043` and `30041999003` and suppressed none.
>
> **Sample messages** (in `skillcrossroads@outlook.com`, retained un-actioned so the evidence is
> intact). Both were sent to that mailbox, both filed to Junk:
>
> - **Arm A — control, `text/plain` only.** Subject: *Action needed: confirm an emergency trigger
>   (RLY-CTRL-A118)*
>   Message-ID: `<010001a0036be47c-5479ede9-6ea8-4e22-bddc-b73bf4993441-000000@email.amazonses.com>`
>   Date: `Sat, 15 Aug 2026 03:16:37 +0000` · sender IP `54.240.48.188`
>
> - **Arm B — variant, `multipart/alternative`.** Subject: *Action needed: confirm an emergency
>   trigger (RLY-HTML-B227)*
>   Message-ID: `<010001a0036d45ff-ee477832-3060-447d-bb88-2cb529c4ae7c-000000@email.amazonses.com>`
>   Date: `Sat, 15 Aug 2026 03:18:08 +0000` · sender IP `54.240.11.161`
>
> The two are 91 seconds apart, to the same freshly created mailbox, differing only in body shape.
>
> **DMARC posture:** `v=DMARC1; p=none; rua=mailto:dmarc@relaystandby.com; fo=1`. We receive and
> read your aggregate reports (submitter `protection.outlook.com`) and are preparing to move to
> `p=quarantine`. SPF is published on the envelope domain `send.relaystandby.com`
> (`include:amazonses.com`); the apex carries MX records and can receive mail.
>
> **Your own aggregate reports corroborate this.** Report IDs
> `8e476174a8e7490fb13272a5b2eafef2` (2026-08-10→11) and
> `98d0152c24574e4eb5c9fb98b8ccaf61` (2026-08-11→12) each contain a single record, from
> `54.240.11.140` and `54.240.11.138` respectively — both `disposition: none`, both SPF **pass** and
> DKIM **pass**. The mail is double DKIM-signed (`d=relaystandby.com` selector `resend`, and
> `d=amazonses.com`), and `d=relaystandby.com` aligns with the header From under strict alignment,
> not merely relaxed.
>
> So by your own measurement there is exactly one sender on this domain, it is the one we operate,
> and it authenticates cleanly on every leg — while the same messages are filed to Junk at SCL 5.
>
> **Already eliminated by measurement:**
> - Authentication — `compauth=pass reason=100`, SPF/DKIM/DMARC all pass.
> - User-level rules or complaints — `jmr:0`, `ucf:0`, and a mailbox created minutes before the test.
> - Bulk classification — `BCL:0`.
> - Reply-To configuration — separately tested 2026-08-09, no change in score.
> - Message shape — the A/B above.
> - A single poor IP — four distinct IPs, identical score.
>
> **What we are asking:** a review of the filtering decision for `relaystandby.com`, and any
> guidance on what is driving SCL 5 given clean authentication and no negative recipient signal. We
> are a new domain (first sending 2026-06) with genuinely low volume, and if the answer is simply
> that reputation has not accrued we would like to know that so we can stop testing.
>
> Full raw headers for all four messages available on request.

---

## What "done" looks like

Microsoft's replies are often templated and slow. Treat any of these as a result worth recording in
`docs/g1-ad-creatives.md`:

- A mitigation is applied → **re-test to a fresh outlook.com mailbox** (a new one; not this one) and
  read the SCL. Do not declare success from the reply itself — the whole file is about not trusting
  a green signal you did not measure.
- They say reputation needs to accrue → that is a real answer. It closes the investigation and turns
  this into a waiting problem, which options 1, 2, 4 and the fire drill are already designed to
  survive.
- No reply within ~2 weeks → record that too, and stop. Nothing downstream is blocked on it.
