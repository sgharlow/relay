# Is the product complete and polished enough for editorial outreach?

> Assessment run 2026-08-16, prompted by `ratified.retire-paid-advertising`: op-eds in AARP,
> caregiver.com and comparable outlets become the route to visibility, so the product has to hold up
> to a reader who arrives from an article — and to the editor who checks before publishing.

## Verdict

**The product is in good shape. The gap is not the product — it is its identity as a provider.**

Under paid advertising nobody checks who you are. Under editorial, two people do: the editor,
before they publish, and the reader, before they hand a stranger their family's passwords. The site
was built for the first world and now has to live in the second.

Everything below is evidence, not impression.

## What was checked, and found sound

| Check | Result |
|---|---|
| Build, types, lint | clean |
| Test suite | 2492 passed, 1 skipped (the pre-existing beta-paywall skip, owned and dated) |
| Public pages | all 10 return 200; `/continue` correctly 307s |
| Internal link graph | 23 distinct links crawled from 9 seed pages — **zero broken** |
| Console | no errors or warnings on the public surface |
| Journeys | J1–J9 all `live`; J10 `withdrawn` deliberately, refused at the trust boundary |
| Accessibility | 0 serious/critical across 34 pages, owner mode included (sprint 4) |
| Design | a real system — semantic state palette (`sage` = closed/safe, `ochre` = in motion, `clay` = permanent), custom illustrations, serif display face |
| Funnel instrument | `verify:funnel` 7/7 live |
| Data | `caregiver_leads` at 0; schema and role checks green in both regions |

**Nothing in the shipping product is broken, half-built, or embarrassing.** That is worth stating
plainly, because the honest answer to "what else must we build" is *almost nothing*.

## What is actually missing

### 1. 🔴 Relay has no named provider. One unresolved fact blocks four surfaces.

The Terms of Service — a contract a paying customer enters — **name no party**. They say *"Relay is
early-stage software"* and *"Relay is provided as-is"*, and never say by whom. There is no About
page, no company, no named human, and the only contact anywhere is `hello@relaystandby.com`.

This is not a new question. The repo has hit it three times already and resolved it none:

| Surface | How it shows up |
|---|---|
| Legal | `/terms` and `/privacy` name no operating entity |
| Payment | Stripe's checkout header reads `Relay/ReportBridge/LearningAI365` — a shared personal account (`ratified.stripe-merchant-name`, left as-is for a flight that has now been cancelled) |
| SMS | `docs/deliverability-options-3-and-5.md` cannot choose a 10DLC registration route because it does not know *"If Relay has an EIN"* |
| **Editorial (new)** | an outlet needs an author bio and affiliation; most contributor guidelines require both, and a pitch from an unattributable site reads as spam |

**Why it matters more here than it did last week.** A caregiver deciding whether to store their
family's credentials is making a trust judgement about a counterparty, and there is currently no
counterparty to judge. The product's entire pitch is *"we cannot read it, and someone you trust has
to say yes"* — a strong claim, made by nobody in particular.

**The blocking fact is one question and it is not mine to answer:** is there a business entity, or
is this Steve personally? Everything downstream — what the Terms name, what the About page says,
which 10DLC route is even available, whether the Stripe merchant name is worth separating — follows
from it. It is not guessable and inventing it would be worse than leaving it blank.

### 2. The H0 hackathon badge, in front of a caregiver audience

`/caregivers` carries **"Winner — Most Impactful, H0 Hackathon 2026"**. It was added deliberately as
distribution ammunition for the H0 win, and for a technical audience it is a genuine credential.

For the audience an AARP or caregiver.com piece delivers, "hackathon" may read as *weekend project* —
and it sits on the page asking that reader to trust the product with their family's accounts. The
same fact could be framed as an award without the word that carries the wrong connotation.

**This is a positioning judgement, not a defect, and it is Steve's.** Flagged rather than changed:
the copy is ratified and pinned by `content.test.ts`, and changing ratified instrument copy on my
own initiative is exactly what that pinning exists to prevent.

### 3. Nothing an editor can cite

Beyond the entity question, an outlet needs a small, dull set of things that do not exist in any
citable form: a one-sentence description, a founder name and bio, a logo file, one screenshot, and a
contact route that is obviously monitored. `public/assets/brand/` has the marks; nothing assembles
them with the facts.

Cheap to build — **once question 1 is answered.** Before that it would be a page with a hole in the
middle.

## Decided this pass, so it stops recurring

- **J9 steps 5–7 dropped** (`ratified.j9-5-7-dropped`). Step 4, the graceful close, was built
  2026-08-08 and carries the payoff; 5–7 were enhancements to a complete journey, filed under a
  heading that already read *"Known gaps that are NOT defects"*. Deferred in sprints 4 and 5, and
  sprint 5 wrote *"do not carry it a third time"*. Decided rather than deferred a fourth time.

## Explicitly not worth doing

Recorded so the next pass does not re-litigate them:

- **More features.** Every journey the product claims is live and walked. Adding surface before the
  first reader arrives is the horizontal-build pattern the demand gate exists to stop.
- **Re-running the a11y or link audits.** Both are recent and clean; re-running them would produce
  activity, not information.
- **The `PROMPTS.md` palette table**, which lists paper/ink/ochre and omits `sage` and `clay`. It is
  wrong, and it is in a document retired with paid advertising. Fixing it would be tidying a file
  nobody will open. *(Noted because I asserted that three-colour palette this morning and it was
  incomplete — the product's palette is semantic, and `sage` is the resting state.)*

## The honest summary

One question — **who operates Relay?** — is worth more than all remaining engineering combined. It
unblocks the Terms, the About page, the press kit, the SMS registration route and the merchant name,
and it is the first thing both an editor and a cautious reader will look for.
