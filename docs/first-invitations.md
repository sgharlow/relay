# The first real invitations

Phase 0 is at N=0, and the security argument now rests on that number: principle 1 is conditional on
claim conversion, and adaptive minting assumes verifiers actually reach `confirmed`. This is the text
to send.

> ⚠️ **Written 2026-08-12, after building the half of the verification call that was missing.** The
> owner's screen has always said "They see the same four words on their own screen" — and until
> today nothing showed them to the contact. The call script below only became honest when that
> shipped. Do not send these from an older deploy.

---

## Before you send anything

1. **Set your name** — Account → Your name. Everything below says "Steve"; without it every message
   and every screen your people see says your email address instead.
2. **Get the code**, per person: People → the person → **Give them a code** → choose how they get it.
   You get a code like `4KMPQ-7XR2W`, a bare address (`relaystandby.com/claim`), and an expiry.
3. **Choose the channel deliberately.** "I will tell them myself" and "Email it to them" are the two
   arms Phase 0 measures. For the first batch, pick whichever actually reaches the person — the
   number that matters first is *does anyone claim at all*, not the split. The split gets interesting
   past ten.

⚠️ **The code is readable exactly once**, at the moment you issue it — only a hash is stored. Copy it
before you close the panel.

---

## To someone who would step in (a recipient)

> Hi [Name],
>
> I've finally sorted something I should have done years ago: a way for the people I trust to reach
> the handful of accounts that would actually matter if I were in hospital or unreachable. You're the
> first person I'd want to be able to do that.
>
> I'm not asking you to do anything today, and this doesn't give you access to anything now. It means
> that *if* something happens, and the people I've named agree it's genuine, the specific things I've
> set aside for you would open — and they close again the moment I check in.
>
> It takes two minutes. Go to **relaystandby.com/claim** and enter this code:
>
> **4KMPQ-7XR2W**
>
> You'll see who you're standing by for and roughly how much is set aside — never what it is. If
> you'd rather not, there's a "step down" button on that page and genuinely no hard feelings; I'd
> much rather know now than find out later.
>
> I'll ring you afterwards to check one thing. It takes thirty seconds and it's the bit that makes it
> actually secure.
>
> Steve

---

## To someone who would confirm it is real (a verifier)

> Hi [Name],
>
> Slightly odd favour. I've set up a way for my family to reach a few important accounts if I'm ever
> unreachable — but I didn't want that to be able to happen on its own, so it takes people who know
> me to confirm it's genuinely an emergency first. I'd like you to be one of them.
>
> What it actually involves: if it ever fires, you get one message asking one question — *is this
> real?* You answer yes, no, or "I don't know", and that's the whole job. You never see anything
> inside it, not before and not after. You're vouching for the situation, not handling anything.
>
> Two minutes now: **relaystandby.com/claim**, and enter this code:
>
> **4KMPQ-7XR2W**
>
> Then I'll call you to check four words match on both our screens — that's what stops someone else
> pretending to be you later.
>
> Please do say no if you'd rather not. It's better for me to know.
>
> Steve

---

## The call, once they've accepted

Thirty seconds, and it is not optional: **until you make it, their answer would not count towards
opening anything.**

1. You: People → the person → **Verified?** → the panel shows four words.
2. Them: sign in at relaystandby.com — the same four words are on their standby screen.
3. **You read yours out. They confirm theirs match.**

> "Can you open relaystandby.com and sign in? There should be four words on the screen. I'm going to
> read you mine — tell me if they're different."

**If they match** → mark them Verified. Done, permanently, unless they re-accept on a new account.

**If they do not match — stop.** Do not mark them. It means somebody other than the person you are
speaking to opened that invitation. Use **the words do not match** in the same panel: it removes
them, cancels the code, and puts them back to not-yet-invited so you can start again on a channel you
trust.

**If they can't sign in at all** — they never received it, or somebody else claimed it. Same
treatment: reject and reissue.

---

## What to expect, and what to watch

- **Accepting grants nothing.** They get a free standby account that holds nothing of theirs. It
  exists so that on the bad day they sign in as themselves rather than being emailed a credential.
- **Email is the part that fails.** Outlook files us at spam-confidence 5, and a previously bounced
  address is muted permanently with no error. If you email a code and nothing happens within a day,
  assume the channel and not the person.
- **Two verified verifiers is the first real milestone.** One works; two means your plan survives one
  of them being on the same flight as you.
- **Ask them to add a passkey** when they accept. It is what lets them back in on a new phone without
  you reissuing anything, and it is what stops Relay ever needing to email them a code.

## The three operator tools

Added 2026-08-14, because "onboard a founding family by hand" needs hands.

**See where somebody actually is.** Every step of this has a visible half (a
screen said yes) and a real half (a row exists), and this product's recurring
defect is the two disagreeing. This reads the database:

```
npx tsx --env-file=.env.local scripts/beta-status.ts <their-email>
```

It prints, per person: their state, whether a code was issued and through which
channel, whether they opened and claimed it, whether they hold a passkey, and
what the mail provider last said about their address. Never a code or a phrase
— states and dates only.

**Give a founding family the paid tier.** The free vault is ten items; a real
one is twenty-five. Both cap messages already say "email us, we are onboarding
founding families by hand", and this is the hand:

```
npx tsx --env-file=.env.local scripts/grant-founding-tier.ts <their-email>
npx tsx --env-file=.env.local scripts/grant-founding-tier.ts <their-email> --revoke
```

It refuses to touch anybody with a Stripe subscription, and marks the grant so
it can never be counted as revenue — the number G1 rests on.

**Prove the mail channel still works.** Sends one real message to an address you
control and waits for the provider's event to come back:

```
npx tsx --env-file=.env.local scripts/verify-delivery-webhook.ts <your-address>
```

Worth running before a batch of invitations. If it fails, the mail channel is
down and no amount of chasing people will help.

## What Relay now tells you about mail

Since 2026-08-14 Resend reports delivery outcomes back to Relay, and `/circle`
says so per person: *"Email to Alex did not arrive — it bounced or was
refused."* That is shown in CALM, which is the only time you can act on it.

⚠️ **Silence still is not reassurance.** A person with no line under them means
nothing has been heard about that address yet — not that it works. The first
real signal usually arrives when you send them something.

## What you are actually measuring

| Question | Where to read it |
|---|---|
| Did they claim at all, and by which channel? | `invitations` — `delivery_channel`, `opened_at`, `claimed_at` |
| Did they reach `confirmed`? | `/circle` — the light per person |
| Can they get back in without you? | `/circle` — the fallback line per person |

The last one is the one that decides whether adaptive minting's premise holds. If most verified
people never add a passkey, the release path is still emailing credentials to most of the circle, and
principle 1 stays conditional on a number that is not moving.
