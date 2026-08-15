# A2P 10DLC registration — everything that is not yours to supply

> ## ⏸️ PARKED 2026-08-15 by Steve, in favour of the G1 ad sitting.
>
> **Not cancelled, and not blocked — a priority call, made with the numbers in front of him.**
> Registration is ~$60 one-time, ~$3–11/month forever, ~45 minutes of his time and 2–4 weeks of
> waiting, plus about a day of engineering after approval. On a product whose `wtp_evidence` and
> `demand_signal` are both still `none`, that lost to the G1 ad sitting, which is the actual
> critical path to the **2026-10-02** gate and has a submit-by of roughly **2026-08-26**.
>
> **What the park costs, stated so the decision can be re-made honestly:** the 2–4 week clock does
> not start. If SMS is wanted in, say, October, it arrives in November. That is the entire downside;
> nothing here expires and no work is wasted.
>
> **Already done and still good whenever this resumes** — none of it needs redoing:
> `/privacy` and `/terms` SMS disclosures (shipped, guarded, live) · the public `/sms` opt-in URL
> (shipped, guarded, live) · campaign copy, sample messages, opt-in description and keyword
> responses (below) · provider chosen (Twilio) · brand type settled (Standard, LLC).
>
> **To resume, three things:** check the EIN is 30–90 days old, put the LLC's legal name on the
> website (Twilio requires the site to bear a relationship to the business name, and it currently
> names no entity), then work the field table below off the CP 575.
>
> 🔁 **Re-raise at the next `/daily-priority`** per the blocker protocol — a parked item is deferred,
> never dropped.

> Option 3 from the deliverability review. **Start this now, gate nothing on it, and write no SMS
> code until the campaign is approved.** The whole item is lead time: brand approval runs 1–3
> business days, campaign approval 3–7 but reported at 10–15 through mid-2026. Fees are noise at
> Relay's scale. Rationale and sourcing: `docs/deliverability-options-3-and-5.md`.
>
> ⚠️ Figures there were read 2026-08-14. Re-check at the provider before paying anything.

---

## ✅ Settled 2026-08-15: Relay is an LLC → **Standard brand**

Steve confirmed the entity. That closes the fork, and it also **retires the trap this document led
with**: the OTP mobile number with a lifetime three-use limit is a **Sole Proprietor** mechanism.
Standard brands are not verified by OTP at all — they go through business vetting against public
records instead. Ignore anything below about OTP numbers; it does not apply to us.

---

## 🔴 The traps that DO apply, in the order they will bite

1. **The legal name and EIN must match the IRS record EXACTLY.** This is reported as the single
   commonest rejection reason. The authority is the **CP 575** EIN confirmation letter (or a **147C**
   if the CP 575 is lost) — not what the bank has, not what Stripe has, not what feels right.
   Punctuation, "LLC" vs "L.L.C.", and abbreviations all matter. **Find the CP 575 before you start.**
2. **There is a three-attempt limit here too, in a different form.** Repeated failed submissions
   produce a *"Maximum 3 tries exhausted"* state, after which you need a manual identity appeal —
   send the CP 575 or 147C to support, roughly 5–7 business days. So getting it right first time is
   worth ten minutes of checking the letter.
3. **Reported new for 2026, verify at your provider before relying on it:** the EIN must be at least
   **15 days old**, and **opt-in URLs must be live and carrier-verifiable**. The second one changes
   our build order — see below.
4. **Campaign approval is still the slow part.** Budget 2–4 weeks end to end and plan nothing
   against a date inside that window.

---

## 🔴 A correction to the build order I gave earlier

The earlier version of this file said, flatly, *"build no SMS code until the brand and campaign are
approved."* That is **wrong for the campaign stage**, and it is worth saying plainly rather than
quietly editing: if carriers must be able to **load and verify the opt-in URL**, then something
public has to exist before the campaign is submitted, not after it is approved.

The reasoning behind the original advice still holds and is unchanged: **do not build the SMS
send path on spec.** Response shapes and error handling written against an unapproved campaign have
never touched the real API, and calling that done is the trap.

What actually has to exist, and when:

| Stage | Needs | Build before? |
|---|---|---|
| **Brand** registration | Legal name, EIN (CP 575 exact), address, website | Nothing new |
| **Campaign** registration | A **publicly loadable** page showing the opt-in language | **Yes — a public page** |
| **First real send** | The signed-in opt-in screen, and the send path | Yes, after approval |

⚠️ **The signed-in opt-in screen is NOT carrier-verifiable** — a reviewer cannot get behind the
sign-in wall to look at it. What they can check is a public page that states the consent language,
what the messages are, and how to stop. That is a small, honest page describing a flow we are
committed to building, and Claude can write it on request.

---

## What you enter (yours)

Have these to hand before starting — **read them off the CP 575, not from memory**:

- **Legal business name**, character-for-character as the IRS has it
- **EIN**, same source
- **Registered business address**, as filed
- Entity type (LLC) and industry classification
- Business website — `https://relaystandby.com`
- Your name, email and a contact phone (a contact number, *not* an OTP verification — Standard
  brands are not verified that way)
- Not publicly traded, so the stock-exchange fields are N/A

---

## What goes in the campaign (already written — copy these)

### Use case

**Account Notification** (or *Low Volume Mixed* if the provider offers no closer match). Not
marketing, not 2FA — Relay's SMS carries no code.

### Campaign description

> Relay is a personal continuity service. An account holder names a small number of trusted contacts
> in advance, who agree to be contacted if that person becomes unreachable. This campaign sends
> those named contacts a short notification when their attention is genuinely needed — for example
> that a request has been raised and is waiting for them — directing them to sign in at
> relaystandby.com. Messages contain no codes, no links and no promotional content. Recipients are
> individually named by the account holder, have accepted an invitation, and separately opt in to
> SMS. Volume is very low and event-driven; most weeks send nothing at all.

### Sample messages

These must match what the product actually sends, so keep them in step with any future
implementation.

1. `Relay: someone has asked for access to a vault you are named on. Please sign in at relaystandby.com to answer. Reply STOP to opt out.`
2. `Relay: a request you were asked about is still waiting for an answer. Sign in at relaystandby.com. Reply STOP to opt out.`
3. `Relay: this is a practice run, nothing is wrong. Sign in at relaystandby.com and press "I got this". Reply STOP to opt out.`

⚠️ **No link and no code in any of them, deliberately.** That is core principle 1, and it also keeps
the campaign clearly out of the 2FA and marketing categories. The third mirrors the fire drill that
already ships.

### Opt-in description

> A contact opts in inside their own signed-in Relay account. After accepting an invitation they
> reach a settings screen where they may add a mobile number and tick a box reading: "Text me if
> something needs my attention. Message and data rates may apply. Message frequency varies. Reply
> STOP to cancel or HELP for help." Nothing is sent to a number until that box is ticked, and the
> box is unticked by default. The consent, the wording shown, and the timestamp are recorded against
> their account. Numbers are never uploaded, purchased, or collected from any third party.

⚠️ **This describes a screen that does not exist yet.** Build it before the first real send — but
after approval, not before. Registering an opt-in flow you do not implement exactly is the
compliance version of a false green.

### Required keyword responses

- **HELP** → `Relay: help at relaystandby.com or hello@relaystandby.com. Reply STOP to opt out.`
- **STOP** → carrier-standard opt-out confirmation; the account must also stop sending immediately.

### Links to supply

- Privacy policy — `https://relaystandby.com/privacy`
- Terms — `https://relaystandby.com/terms`

🔴 **Both pages need an edit first — checked 2026-08-14, and neither mentions SMS.**

- `src/app/privacy/page.tsx` says Relay stores *"the names, emails and phone numbers of people you
  designate"* — so numbers are already disclosed as collected, but nothing says they may be **texted**,
  or on what consent, or how to stop.
- `src/app/terms/page.tsx` does not mention messaging at all.

Reviewers read these, and a privacy policy silent on text messaging is one of the commonest
rejection reasons. The edit is small — a short paragraph on each covering: that SMS is opt-in, that
it is used only for account notifications, message-frequency and rates language, and STOP/HELP. Do
it before submitting the campaign, not after a rejection.

---

## The order to do it in

1. ✅ ~~Answer the EIN question.~~ **LLC → Standard brand.** Settled 2026-08-15.
2. ✅ ~~Check `/privacy` and `/terms` cover SMS.~~ **Both edited and shipped 2026-08-15**, guarded by
   `lib/ops/sms-disclosure.test.ts`.
3. **Find the CP 575** and copy the legal name, EIN and address off it verbatim. Ten minutes here
   buys you the three-attempt limit.
4. **Register the brand.** Approval 1–3 business days.
5. **Publish the public opt-in page** so the campaign's opt-in URL resolves for a carrier reviewer.
   Ask Claude and it gets written and deployed the same session.
6. **Submit the campaign** with the copy above. Wait — 3–7 days nominal, 10–15 reported through
   mid-2026.
7. **Only once the campaign is approved:** build the signed-in opt-in screen and the send path,
   behind the existing notification seam, matching exactly what was registered.

Step 7 stays last on purpose. A send path written against an unapproved campaign has never touched
the real API — its response shapes and error handling are guesses — and this portfolio has a standing
rule against calling that done. Step 5 moved *earlier* for a different reason: a carrier has to be
able to load the URL, and a page behind a sign-in wall is not loadable.
