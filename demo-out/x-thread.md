> ⛔ **HISTORICAL H0 ARTEFACT — DO NOT REUSE THIS COPY. IT SELLS A CAPABILITY RELAY DOES NOT HAVE.**
>
> Estate and inheritance were withdrawn from Relay PERMANENTLY on 2026-08-14 (PROJECT.yaml -> gates.g2-counsel-opinion.declined). Relay offers no estate or inheritance capability and confers no legal authority on anyone. The `estate` trigger type survives in the domain enum for compatibility only and is excluded from USER_SELECTABLE_TRIGGER_TYPES.
>
> PUBLICATION STATUS UNRECORDED — nobody has confirmed whether this thread was ever posted. If it was, the live copy sells estate to the public and Steve decides whether to delete or correct it.
>
> So the copy below is HISTORICAL and must not be reused, quoted, or pasted anywhere. Bannered rather than rewritten because these are records of what was published during H0, and editing them would destroy the record without changing anything a reader has already seen. Bannered 2026-08-29 (B39).

# Relay — X (Twitter) bonus build post

**Purpose:** H0 hackathon bonus "build post" (+ attribution + `#H0Hackathon`).
**To post:** paste each tweet below in order as a thread. After posting Tweet 1,
click it — the address bar shows `https://x.com/<yourhandle>/status/<id>`. That URL
is the bonus post link; paste it into the Devpost bonus build-post field
(`specs/DEVPOST-PASTE-MAP.md` row #6) and link to **Tweet 1** (it anchors the thread).

Each tweet is under 280 chars (links count as 23 on X). `#H0Hackathon` is in Tweet 1
and the required attribution statement is in Tweet 6, so the post satisfies the bonus
"+ attribution + #H0Hackathon" requirement wherever a judge enters the thread.

---

## Thread (post in order)

### Tweet 1
The hardest part of a digital-estate vault isn't storage — it's the *release*: the moment a system decides, on its own, to hand your private life to another person.

Meet Relay, my #H0Hackathon build on @awscloud Aurora DSQL + @vercel. 🧵

### Tweet 2
Relay grants scoped, REVERSIBLE access to the people who'll need it. The release runs a state machine: ARMED → PENDING → GRACE → RELEASED.

A missed check-in, emergency, or estate event moves it off ARMED — then N-of-M trusted verifiers must confirm before any door opens.

### Tweet 3
Why Aurora DSQL is the hero, not a detail 👇

Releasing a vault is irreversible — a stale read leaks data or opens the wrong door. So every transition is a strongly-consistent compare-and-set. If the row moved under you, you get a 40001 conflict → retry, or reset to ARMED.

### Tweet 4
Active-active multi-region matters because a release often lands DURING a regional disruption — that's *why* it's happening. Flip traffic to us-west-2 and access keeps serving, strongly consistent. "It can never double-release" is guaranteed by the DB, not a distributed lock.

### Tweet 5
And the DB never sees a secret. The browser AES-GCM-encrypts each item locally, then AWS KMS wraps the key — server stores ciphertext + wrapped key + metadata only. The importance engine that ranks your accounts runs over metadata, so it can't leak what it can't see.

### Tweet 6 (links + required attribution)
Open source (MIT). Built for Devpost's H0: Hack the Zero Stack with Vercel and AWS Databases — created for this hackathon.

🎬 Demo: https://youtu.be/FU3azKJOesY
🌐 Live: https://relay-three-henna.vercel.app
💻 Code: https://github.com/sgharlow/relay

#H0Hackathon

---

## Single-tweet fallback (if you'd rather not thread)

The hard part of a digital-estate vault isn't storage — it's the *release*: provably handing access to the right person, at the right moment, and never twice. Relay runs it as a strongly-consistent compare-and-set on @awscloud Aurora DSQL.

🎬 https://youtu.be/FU3azKJOesY · Built for Devpost's H0 hackathon · #H0Hackathon

---

## After posting
1. Copy the Tweet 1 URL (`https://x.com/<handle>/status/<id>`).
2. Paste it into Devpost's bonus build-post field.
3. Send it to me and I'll fill `specs/DEVPOST-PASTE-MAP.md` row #6 (currently `________________`).
