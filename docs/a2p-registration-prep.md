# A2P 10DLC registration — everything that is not yours to supply

> Option 3 from the deliverability review. **Start this now, gate nothing on it, and write no SMS
> code until the campaign is approved.** The whole item is lead time: brand approval runs 1–3
> business days, campaign approval 3–7 but reported at 10–15 through mid-2026. Fees are noise at
> Relay's scale. Rationale and sourcing: `docs/deliverability-options-3-and-5.md`.
>
> ⚠️ Figures there were read 2026-08-14. Re-check at the provider before paying anything.

---

## The one question that decides which form you fill in

**Does Relay have a business Tax ID (a US EIN)?**

- **No EIN** → Sole Proprietor brand. Cheapest and fastest, but capped: one 10DLC number per
  campaign and low throughput.
- **Has an EIN** → Standard (or Low-Volume Standard) brand. More vetting, higher fee, higher
  throughput. Stripe is already live in this business, so this is the likelier answer.

Answer this before opening the console; the two paths ask for different things and a wrong start
costs a re-registration.

---

## 🔴 Three traps, in the order they will bite

1. **The OTP number has a lifetime limit of three uses, across all vendors.** Sole Proprietor
   verification sends a one-time code to a mobile number, and that number can only ever be used
   three times for this purpose anywhere. Do not spend one on a trial account or an experiment. Use
   the number you intend to keep.
2. **It must be a real mobile number.** VoIP numbers are rejected — including Twilio's own numbers,
   Google Voice, and most virtual numbers. A carrier-issued mobile line only.
3. **Campaign approval is the slow part, not brand approval.** Budget 2–4 weeks end to end and do
   not plan anything against a date inside that window.

---

## What you enter (yours)

Have these to hand before starting:

- Legal business name, exactly as registered
- EIN (or the decision that there isn't one)
- Registered business address
- Business website — `https://relaystandby.com`
- Your name, email, and a mobile number for OTP (see trap 1)
- Business type / industry classification

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

1. Answer the EIN question.
2. Check `/privacy` and `/terms` cover SMS; edit if not.
3. Register the brand. Wait for approval (1–3 business days).
4. Submit the campaign with the copy above. Wait (3–7 days, possibly 10–15).
5. **Only once approved:** build the opt-in screen and the send path, behind the existing
   notification seam, exactly matching the samples and the opt-in description registered above.

Step 5 is deliberately last. A send path written against an unapproved campaign has never touched
the real API — its response shapes and error handling are guesses — and this portfolio has a
standing rule against calling that done.
