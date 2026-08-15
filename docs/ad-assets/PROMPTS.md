# Ad image assets — generation prompts (Gemini)

> Closes the gap opened by `g1-ad-creatives.md` → "Image assets": *"⚠️ These do not exist yet.
> This section previously gave art direction and no files, which means the Meta lane stalls at
> 'upload image' with nothing to upload."*
>
> This file is the **production instruction**, not more art direction. Every prompt below is
> paste-ready. Output files land beside this one in `docs/ad-assets/`, committed, so the creative
> that ran is recoverable at verdict time (`g1-flight-log.md`).
>
> Copy, character limits, compliance rules and lane structure are NOT restated here — they live in
> `g1-ad-creatives.md`. Price, tier caps and the guarantee are NOT restated here — they live in
> `lib/offer.ts`, `lib/billing/entitlements.ts` and `PROJECT.yaml`. **Read the value from the
> source at generation time; do not copy a number out of this file into an ad.**

---

## 0. The rules every prompt below already obeys

Stated once, so a new prompt written later can be checked against them.

| Rule | Where it comes from |
|---|---|
| **No people.** No stock photos of smiling seniors, no families at a kitchen table, no hands holding phones | `g1-ad-creatives.md` "Image assets" — the audience is exhausted by insurance-marketing imagery, and it is the fastest way to read as a scam |
| **No second person attached to a health event or a relative** — in image text too | §1a. "A hospital stay can mean a family suddenly needs access" is compliant; "when your mum is in hospital" is the prohibited shape. Applies to a caption baked into a PNG exactly as it applies to a headline |
| **No badge, seal, shield, certificate, checkmark-in-a-rosette, or lock-with-a-tick** | Claim discipline: no certifications, no SOC 2, no audit. A generated "trust badge" is a fabricated credential even when it says nothing |
| **No testimonial, no star rating, no "trusted by N families", no face-with-a-quote** | Claim discipline — there are no customers |
| **No readable credential text.** Any handwriting or field content in an image is illegible by construction | An image containing something that reads as a real password is a liability and a review risk |
| **No medical imagery.** No hospital beds, IV drips, monitors, stethoscopes, pill organisers | Both platforms police health inference; the metaphor set below is deliberately mechanical instead |
| **One line of text maximum, or none.** The 20%-text rule is retired; text-heavy images still get throttled delivery | `g1-ad-creatives.md` |
| **Text ≥ 8% from every edge** | Placements crop differently |
| **No price, no plan name, no guarantee baked into the pixels** | These change in one place (`lib/offer.ts`, `entitlements.ts`). A number baked into a PNG is a second definition of a contract that must have exactly one — and it silently goes stale. Put price in the platform's text fields, where an edit is free |

**On text in the image at all:** Meta renders the headline and description *outside* the image, and
Reddit's free-form ad carries its own title and body. So in-image text buys very little and costs
delivery throttling plus a stale-copy risk. **Default to the clean plate.** Every concept below has
a `-clean` variant (no text) and a `-text` variant; generate the clean plate first and only reach
for the text variant if a lane visibly needs it.

## 0a. How to run these

1. Google AI Studio or the Gemini app → an image-generation model (Nano Banana / Gemini image).
2. Paste one prompt verbatim. Generate 3–4 candidates.
3. Judge against §5 (the acceptance checklist) — **not** against which looks prettiest.
4. Downscale/crop to the exact pixel dimensions in §1 in any editor. Ad platforms reject
   off-spec dimensions and silently letterbox near-misses.
5. Save to `docs/ad-assets/<name>.png` using the names in §1, and commit.

⚠️ **Generated images carry a SynthID watermark.** That is invisible, permitted on both platforms,
and not a problem — do not go hunting for a model that omits it.

⚠️ **Text baked by an image model is unreliable at small sizes and in long strings.** If you use a
`-text` variant, read every character back on a phone-sized preview before uploading. A subtly
misspelled word in the one line of copy is worse than no line at all.

---

## 1. The asset matrix — what has to exist, and for which lane

| File | Size | Lane / placement | Concept | Priority |
|---|---|---|---|---|
| `meta-m1-1080.png` | 1080 × 1080 | Meta feed, M1 reversibility | **A — the aperture** | needed before the Meta lane opens |
| `meta-m1-1080x1350.png` | 1080 × 1350 (4:5) | Meta feed, M1 | A, vertical crop | **recommended — see the note below** |
| `meta-m2-1080.png` | 1080 × 1080 | Meta feed, M2 notebook | **B — the copies that cannot be recalled** | needed before the Meta lane opens |
| `meta-m3-1080.png` | 1080 × 1080 | Meta feed, M3 free-first | **C — the dependency reveal** | needed before the Meta lane opens |
| `meta-f1-1080.png` | 1080 × 1080 | Meta feed, **F1 price-led / free on-ramp** | **D — the ten slots** | new creative, see §3. Only if F1 replaces an M variant; F1 runs on Reddit by preference |
| `story-1080x1920.png` | 1080 × 1920 (9:16) | Stories / Reels | A, vertical | **see the automatic-placements note** |
| `reddit-r1-1200x628.png` | 1200 × 628 | Reddit free-form, R1 | **E — the aperture, wide** | optional; the free-form ad runs text-only |
| `avatar-400.png` | 400 × 400 | Ad-account profile image, both platforms | **F — the relay mark** | needed at account creation, before any creative |

> ⚠️ **Two matrix gaps the existing plan does not name, both worth closing before spend.**
>
> **4:5 for Meta feed.** The plan specifies 1080 × 1080 only. Meta's feed gives a 4:5 image more
> vertical screen than a square at identical cost, and on a mobile-heavy audience that is free
> reach. Same concept, taller crop.
>
> **9:16 for automatic placements.** `g1-ad-creatives.md` Meta walkthrough step 7 sets **Placements:
> Automatic**, which serves into Stories and Reels. With only a square uploaded, Meta crops or pads
> it, and a composition centred for 1:1 loses its subject. Either supply the 9:16 asset or restrict
> placements to Feed — **decide deliberately; do not discover it in the delivery breakdown.**

### 🔴 THE PALETTE BELOW WAS STALE, AND IT WOULD HAVE PRODUCED OFF-BRAND ADS

Corrected 2026-08-15, before any asset was generated. Read this before generating anything.

This section used to say: *"Palette, taken from the shipped product so the click-through reads as
continuous — these are the real values in `opengraph-image.tsx` and `icon.svg`, not invented"*,
followed by a near-black-and-amber table. Three things were wrong with that, and the third is the
one that costs money.

1. **`#f59e0b` is not in the product at all.** It appears in no stylesheet, no component and no
   icon — it was invented, in the table that promised it was not. It was quoted into five prompts.
2. **The values attributed to `icon.svg` are the ones it stopped using on 2026-08-13.** That file's
   own header records the fix: *"🔴 IT WAS OFF-PALETTE… #0f172a with #3b82f6 and #fbbf24 — Tailwind
   slate, blue and amber. Every browser tab advertised a product that looked nothing like the one
   behind it."* The prompts inherited exactly the palette that comment was written to retire.
3. **The destination is not near-black.** `relaystandby.com/caregivers` renders
   `background: rgb(247, 244, 238)` with `rgb(31, 27, 22)` text — measured in a browser on
   2026-08-15, not read from a file. It is a warm, LIGHT page. A near-black creative landing on it
   is the opposite of "reads as continuous", which is the only reason this section exists.

**The shipped palette — "Warm Archive", from `src/app/globals.css` and `src/app/icon.svg`:**

| Role | Hex | Token |
|---|---|---|
| Background — warm paper, and it is LIGHT | `#f7f4ee` | `--paper` |
| Raised / sunken surfaces | `#fffdf9`, `#efeae0` | `--paper-raised`, `--paper-sunken` |
| Ink — all text, all primary buttons | `#1f1b16` | `--ink` |
| Muted text | `#6b6257` | `--ink-muted` |
| Ochre — in motion and REVERSIBLE (the access state) | `#b4703a` | `--ochre` |
| Ochre, deep / soft | `#a15d27`, `#f6ead9` | `--ochre-deep`, `--ochre-soft` |

✅ **`src/app/caregivers/opengraph-image.tsx` was on that old dark palette too, and was fixed on
2026-08-15.** It is the link preview for the page the ads land on, and it was the file this table
cited as proof its own palette came from the product — so the evidence for the dark palette was a
file nobody had migrated. `lib/ops/og-palette.test.ts` now fails if a share card paints a colour
that is not in `globals.css`.

> ### ✅ RULED 2026-08-15 (Steve): MATCH THE DESTINATION
> The creatives are **warm paper** — `#f7f4ee` ground, `#1f1b16` ink, `#b4703a` ochre — and every
> prompt below has been rewritten accordingly. The click-through reads as continuous, which is what
> this section always claimed and had stopped being true.
>
> **The alternative was real and was declined.** Dark creatives do carry in dark-mode feeds, and the
> brand has a sanctioned dark mode: `public/assets/brand/relay-mark-inverse.svg` defines it, ink
> ground with ochre lifted to `#f6ead9` "because `#b4703a` on `#1f1b16` measures about 3.4:1 and a
> brand mark that is hard to see is a brand mark that gets replaced by a wordmark." If a lane ever
> needs contrast, **that** is the dark to use — not the retired slate.
>
> What settled it was that this project has already answered the question twice, in red, in its own
> source. `src/app/icon.svg`: *"Every browser tab advertised a product that looked nothing like the
> one behind it."* `public/assets/brand/social-card.svg`: *"Both currently advertise a product that
> looks nothing like the one behind the link… a share card for this product competes in a feed full
> of shouting, and the thing being offered is calm."* Both treated the mismatch as a defect to fix,
> not a contrast to keep. The slate in these prompts was never an art direction — it was un-migrated
> legacy from before the Warm Archive system existed.
>
> `lib/ops/ad-copy.test.ts` fails if any colour in a prompt block is absent from the product, and
> `lib/ops/og-palette.test.ts` does the same for share cards, so this drift cannot recur silently.

---

## 2. The prompts

Each is one paste-ready block. The prose style is deliberate — these models respond to a described
scene, not to a keyword list.

### Concept A — the aperture that closes itself *(M1, R1, Stories)*

The reversibility claim, which is the one thing no rival does. A mechanical iris reads as *opens
and closes by itself*; a padlock reads as *shut*, which is the wrong half of the story.

**`meta-m1-1080-clean` — square, no text**

```
A high-end 3D render of a precision mechanical iris aperture, seen straight on and centred,
filling about 55% of a square frame. The iris is machined from deep ink-dark brushed metal
(#1f1b16) with fine concentric tooling marks. It is caught mid-motion, roughly one third open, and warm ochre light
(#b4703a) pours through the opening and spills onto the surrounding blades, catching every bevelled
edge. The background is a warm off-white paper field (#f7f4ee) with a very subtle vertical
gradient, empty and calm, no texture or pattern. A soft ochre glow bleeds a short distance into the
paper around the aperture. Bright, even studio lighting from the upper left, shallow depth of
field, sharp focus on the blade edges. Restrained, engineered, premium — the visual language of
security hardware, not of a hospital or a family album. No text, no letters, no numbers, no logos,
no watermarks, no people, no hands, no keyholes, no padlocks. Square 1:1 composition with generous
empty margin on all four sides.
```

**`meta-m1-1080-text` — square, one line**

```
[the prompt above, then:]
Across the lower third of the frame, in a clean modern geometric sans-serif, deep ink (#1f1b16),
one single line of text reading exactly: It opens. Then it closes itself. The text is horizontally
centred, sits well clear of the frame edges with at least 10% margin, is large enough to read on a
phone, and is the only text anywhere in the image. Spell it exactly as written.
```

**`meta-m1-1080x1350` — 4:5, the recommended feed size**

> Added 2026-08-15. The asset matrix has listed this file as **recommended** since the 4:5 note was
> written, and it was the only row in that table with no prompt to run — so the size the note calls
> "free reach" was the one size nobody could produce. Everything else there had a block.

```
[Concept A clean prompt, with these changes:]
Vertical 4:5 composition. The aperture stays centred horizontally and sits slightly above the
optical centre, with the extra vertical space distributed as calm empty field above and below it —
the frame is taller, not more crowded. Keep the subject clear of the top and bottom eighths, which
Meta may crop for different placements.
```

**`story-1080x1920` — vertical**

```
[Concept A clean prompt, with these changes:]
Vertical 9:16 composition. The aperture sits in the upper-middle of the frame, its centre about 40%
down from the top, leaving the lower third as an empty dark field with room for an overlay. The
amber glow falls downward into that empty space.
```

**`reddit-r1-1200x628` — wide**

```
[Concept A clean prompt, with these changes:]
Wide 1.91:1 landscape composition. The aperture is offset to the right third of the frame and the
left two thirds are an empty dark slate field, so the amber light reads as travelling leftward
across open space.
```

### Concept B — what cannot be unshared *(M2, the notebook)*

The M2 hook is that the password notebook is permanent. The image has to say *copies escaping
beyond recall*, without ever showing a legible credential.

**`meta-m2-1080-clean`**

```
A dark, moody still-life render, seen from directly above, on a deep near-black slate surface
(#f7f4ee). At the centre-left lies a small worn paper notebook, open, its pages covered in soft
indistinct handwriting — deliberately blurred and illegible, suggesting handwritten notes without
any readable word, letter or number anywhere. Rising from the open page and drifting up and to the
right are a dozen translucent duplicate copies of that same page, each fainter and more dispersed
than the last, scattering outward beyond the edge of the frame like something released that cannot
be gathered back. The duplicates are edged in muted warm grey (#6b6257); a single warm ochre
light (#b4703a) rakes across the notebook itself from the left, so the original is warm and the
escaping copies are cold. Photographic realism, shallow depth of field, sharp on the notebook and
soft on the furthest copies. Melancholy and quiet, not alarming. No readable text of any kind, no
numbers, no logos, no people, no hands, no phones, no computers. Square 1:1 composition with
generous dark margin around the subject.
```

**`meta-m2-1080-text`**

```
[the prompt above, then:]
In the upper right region, over empty dark background and clear of the notebook and the drifting
copies, one single line of text in a clean modern geometric sans-serif, deep ink (#1f1b16),
reading exactly: This cannot be unshared. It is the only text in the image, sits at least 10% in
from every edge, and is large enough to read on a phone. Spell it exactly as written.
```

### Concept C — the dependency reveal *(M3)*

`g1-ad-creatives.md` calls this out as the strongest option because it is literally what the product
shows after the seed — so it sets an accurate expectation rather than a promise.

**`meta-m3-1080-clean`**

```
A refined dark-mode data visualisation, centred in a square frame on a deep near-black slate
background (#f7f4ee). One large node glows warm ochre (#b4703a) slightly above centre, with
a soft halo. Six smaller nodes are arranged in a loose arc below and around it, each a dim
muted warm grey (#6b6257) with no glow of its own. Six thin luminous lines run from the
bright node to each of the small ones; the lines are brightest where they leave the amber node and
fade toward the grey ones, so the direction of dependency is unmistakable — everything hangs off
the single bright node. The lines are gently curved, not straight. Thin, precise, elegant strokes;
a faint darker grid is barely visible in the background. The aesthetic is a premium engineering
dashboard: restrained, technical, calm. No text, no labels, no letters, no numbers, no logos, no
icons inside the nodes, no people. Square 1:1 composition with generous empty margin.
```

**`meta-m3-1080-text`**

```
[the prompt above, then:]
Directly beneath the large amber node, in a clean modern geometric sans-serif, deep ink (#1f1b16),
a single short label reading exactly: the email account. Below the six grey nodes, in smaller
muted warm grey (#6b6257) type, one line reading exactly: If this one is locked, the other six do not
matter. Both lines are horizontally centred, at least 10% in from every edge, and are the only text
in the image. Spell both exactly as written.
```

⚠️ **The label is "the email account", never "her email" or "your parent's email".** §1a applies to
pixels. This is the one prompt in the file where the compliance rule is easiest to lose while
iterating.

### Concept D — the free plan *(F1 — new; see §3 for its copy)*

The free tier is a counted, bounded thing: **read the current caps from
`lib/billing/entitlements.ts` (`TIER_LIMITS.free`) before writing any number into the ad text** —
the prompt below deliberately builds the count into the *composition* rather than into a numeral,
so the image survives a cap change and only the platform text field needs editing.

**`meta-f1-1080-clean`**

```
A clean interface abstraction on a warm off-white paper background (#f7f4ee), seen
straight on. A neat grid of ten identical small rounded rectangular tiles, arranged five across and
two down, centred in a square frame. The tiles are dark slate with a thin border; each glows softly
from within in warm amber (#b4703a), and they brighten in sequence from the top-left tile to the
bottom-right so the leftmost are fully lit and the last one or two are only just beginning to
glow — a set being filled in, one at a time. Below the grid, well separated from it, four small
simple abstract person markers stand in a row: minimal geometric silhouettes, no faces, no detail,
drawn in deep ink (#1f1b16), evenly spaced. Thin elegant lines, generous negative space, a
premium product-design aesthetic. Nothing is locked, closed, warning-coloured or alarming; the mood
is open, calm and inviting. No text, no letters, no numbers, no logos, no icons inside the tiles,
no photographic people, no faces. Square 1:1 composition with wide empty margins.
```

**`meta-f1-1080-text`**

```
[the prompt above, then:]
Across the lower portion of the frame, below the four person markers and clear of every element, a
single line of text in a clean modern geometric sans-serif, deep ink (#1f1b16), reading exactly:
Start free. It is the only text in the image, horizontally centred, at least 10% in from every
edge, and large enough to read easily on a phone. Spell it exactly as written.
```

> **Why "Start free" and not "10 accounts free" in the pixels.** The caps are a live contract in
> `lib/billing/entitlements.ts` — and `free.recipients` has already moved once (1 → 4, on
> 2026-08-08). Baked into a PNG, the next change makes the running ad false with nothing to catch
> it. Counts go in the platform text field, where they are one edit away from correct. This is the
> "one authoritative definition per cross-boundary contract" rule applied to a JPEG.

### Concept E — the relay mark *(ad-account avatar)*

Needed at account creation on both platforms, before any campaign exists. A default avatar on an
advertiser profile is itself a small trust signal, and the mark already exists in the product
(`src/app/icon.svg`) — this is a faithful enlargement, not a redesign.

**`avatar-400`**

```
A minimal flat vector app icon on a square rounded-corner tile filled with warm off-white paper
(#f7f4ee). Centred within it: a single smooth arc sweeping from lower-left to upper-right in warm
ochre (#b4703a), with a medium-thick rounded stroke. At the lower-left end of the arc sits a SOLID
FILLED circle in near-black ink (#1f1b16) — the person who holds everything. At the upper-right end
sits an OPEN circle: the same size, drawn as a ring in warm ochre (#b4703a) with a thick stroke and
no fill — the person standing by, holding nothing. The contrast between the filled node and the
open one is the whole idea and must be unmistakable. The composition is balanced, geometric and
precise, with clean generous padding inside the tile. Absolutely flat design — no gradients, no
shadows, no highlights, no 3D, no texture. No text, no letters, no numbers. Square 1:1.
```

✅ **DONE 2026-08-15 — `avatar-400.png` exists**, rendered rather than generated, from
`docs/ad-assets/avatar-400.svg` via `node scripts/render-svg.mjs docs/ad-assets/avatar-400.svg 400 400`.
Regenerate with that command after any change to the mark. The prompt above is kept only in case a
softer, less literal avatar is ever wanted.

⚠️ **It is NOT a render of `src/app/icon.svg`, and this line used to say it was.** That file is the
**32px cut** and it deliberately drops the connecting arc — its own header explains why: "below
about 32px it renders as two grey pixels sitting in the gap that carries the whole idea, which is
worse than leaving it out." At 400 × 400 that constraint is gone, and rendering the 32px cut would
have shipped an avatar missing the one element the mark is *about*. The source is the FULL mark,
`public/assets/brand/relay-mark.svg`, on the paper tile icon.svg contributes.

---

## 3. F1 — the creative that carries the free plan *(new; copy, not just an image)*

> **Scope ruled by Steve 2026-08-12: G1 only, no beta-recruitment ads — and free is *mentioned*,
> not led.** F1 is therefore a **price-led** variant whose free on-ramp is stated plainly, not a
> free-first ad. The earlier free-led draft of this section is superseded and does not run.

Of the six existing creatives, M1 and M2 mention the free plan only in a 25-character description
field, and M3 — the one described as "free-first" — carries no price at all. F1 is the variant that
does both jobs in one: the price is the headline, and the free on-ramp is a full sentence rather
than a truncated fragment.

**Run it on the Reddit lane by preference.** Reddit is lane 1, its free-form body is effectively
unlimited, and the free plan needs a sentence to land honestly. The Meta version is provided for
completeness, but note that the Meta lane opens only if Reddit under-delivers and carries the
smaller share of the ratified ceiling — a fourth Meta variant would split that share too thin to
read. Adding it there means **replacing** a variant, not appending one.

⚠️ **Before running it, verify three things against the source and not against this file:**

1. `TIER_LIMITS.free` in `lib/billing/entitlements.ts` — the item and recipient caps. Both numbers
   below are read from there at time of writing and **both have moved before**.
2. `TIER_LIMITS.free.canRelease`. It is currently `true` **as a dated beta decision**, and the
   source carries the comment *"FLIP TO false WHEN BETA ENDS."* **No copy below depends on it** —
   deliberately. Never write an ad that promises the free plan will open access in an emergency,
   because the day that flag flips, a running ad becomes a false claim with nothing to catch it.
3. That signup still takes no card. The copy says so.

**F1 — Reddit free-form** *(preferred placement; title under ~80 chars, body effectively unlimited)*

> **Title (68 chars):** One price for the whole family — and the first ten accounts are free
>
> **Body:**
> Most families never write any of it down, because the moment you do, the only way to share it is
> to share everything with everyone, permanently. That works right up until it doesn't, and it
> can't be undone.
>
> Relay is the reversible version, and it is one price for the whole family — no per-person tier,
> no upsell for the second sibling. Access opens only what the owner granted, only when a real
> trigger is verified, and seals itself again when they check back in.
>
> Encrypted in the browser, so the server only ever holds ciphertext. There is nothing on our side
> to read.
>
> The first ten accounts are free to set up, with no card, if it makes more sense to see it on a
> real family before paying for it.
>
> *Winner — Most Impactful, H0 Hackathon 2026*

**F1 — Meta** *(only as a replacement for an existing M variant, not a fourth; field limits per
`g1-ad-creatives.md` §1b: ~125 primary before the fold, 40 headline, ~25 description)*

> **Primary text (first sentence = 103 chars, inside the fold):** One price covers a whole family's
> emergency access, and the first ten accounts cost nothing to set up. Relay opens exactly what the
> owner granted when a real trigger is verified, and seals itself again when they check back in.
> Encrypted in the browser; the server only ever holds ciphertext. 30-day money-back guarantee.
>
> **Headline (35):** $119/yr for the family — start free
>
> **Description (19):** First 10 items free

⚠️ The headline carries the price because `g1-channel-send-kit.md` requires it **visible pre-click
wherever the format allows**, and because this is the price-led variant. It is the one number in
this file written into ad copy — **check it against `PRICE_YEARLY_USD` in
`src/app/caregivers/content.ts` before pasting**, and re-count the field if it ever changes: at 35
of 40 characters there are only 5 to spare.

**Compliance note:** both are third person throughout. "A family", "most families", "the people who
might need them" — never "your mother", never "you" attached to a health event. This is §1a, and
the F1 copy was drafted under it rather than rewritten into it.

---

## 4. What each concept pairs with

| Creative | Concept | Why |
|---|---|---|
| M1 reversibility | **A — aperture** | The iris is the only metaphor here that closes on its own |
| M2 notebook | **B — escaping copies** | States the permanence problem the copy names |
| M3 dependency reveal | **C — node graph** | Literally the product's own output; sets an accurate expectation |
| **F1 price-led / free on-ramp** | **D — ten slots** | Counted, bounded, unlocked — an on-ramp, not a vault door. Reddit-first, so the image is optional |
| R1 Reddit | **E — aperture, wide** — or no image at all | Free-form ads run text-only; R1's body is the creative |

---

## 5. Acceptance checklist — run before any image is uploaded

Judge candidates against this, not against which is prettiest. A generated image that fails any row
is discarded and regenerated; it is not "fixed" in the ad platform.

- [ ] **No people, no faces, no hands** — including in reflections and in the far background
- [ ] **No badge, seal, shield, ribbon, certificate or checkmark-in-a-rosette** anywhere
- [ ] **No legible credential-shaped text** — no readable password, account name, or number
- [ ] **No text at all** (clean plates) — models add spurious letters at frame edges and inside
      UI-like elements; zoom the corners and check
- [ ] **`-text` variants: every character read back, on a phone-sized preview.** One misspelling and
      it is discarded, not retouched
- [ ] **No price, plan name, guarantee or cap number in the pixels** (§0)
- [ ] **No second person attached to a health event or a relative** in any baked text (§1a)
- [ ] **No medical objects** — beds, monitors, drips, pill organisers, stethoscopes
- [ ] **Palette matches §1** — the click-through has to read as continuous with the landing page
- [ ] **All meaningful content ≥ 8% in from every edge**, and the subject survives a centre-crop to
      1:1, 4:5 and 9:16
- [ ] **Exact pixel dimensions** per §1 — not "about right"
- [ ] **Legible at ~120px wide** — the size a feed thumbnail actually renders at. Check on a phone
- [ ] **Saved into `docs/ad-assets/` and committed** before the campaign goes live, so the verdict
      can be read against the creative that actually ran

---

## 6. Scope ruling, and what is still open

### Ruled 2026-08-12 (Steve) — closed, recorded so it is not reopened

**These ads serve the G1 WTP gate and nothing else. There is no beta-recruitment campaign.** The
lanes, ceiling, thresholds, srcs and the submit-by in `g1-ad-creatives.md` (~2026-08-26 as of the
2026-08-14 gate move — do not re-quote it from here) stand exactly
as written — this ruling changes nothing in that file, which is why nothing was edited there and no
new `PROJECT.yaml` entry was added. The free plan is **mentioned, not led** (§3).

**Consequently `BETA_SRCS` is NOT needed and was not built.** It would have been required only if
beta traffic and gate traffic shared the funnel. `isGateQualifyingSrc()` in
`src/app/caregivers/content.ts` is unchanged, and `SHOWCASE_SRCS` / `QA_SRCS` remain the only two
exclusion sets. ⚠️ **If a beta or founding-family campaign is ever revived, this becomes a
pre-flight blocker again:** every tagged non-excluded `src` counts toward N, free-signup conversions
emit no priced numerator, and the ratio would be biased **down** — toward a false KILL on the gate
that decides the product. A Vercel Analytics event cannot be deleted, so the exclusion has to exist
*before* the first such ad, not after.

### Still open — decisions this file cannot make

1. ~~**The landing page's own copy.**~~ ✅ **DECIDED AND SHIPPED 2026-08-14** — Steve took option
   (b): rewritten into third person before the first submission, while no traffic existed to
   invalidate. Three strings moved, not the one this item named (`SUBHEAD`, `OG_DESCRIPTION` — which
   is what a reviewer's crawler reads — and `DIFFERENTIATORS[2].relay`, which carried R3's exposed
   phrase verbatim). §1a's rule is now enforced by `content.test.ts` rather than stated in prose.
   Evidence and the before/after table: `g1-flight-log.md` §"RESOLVED 2026-08-14".
2. **What the destination says about the free plan.** `SECONDARY_CTA_LABEL` reads "free, 10 items"
   and says nothing about the recipient cap. F1 states the free on-ramp in the ad; the destination
   should confirm it, or the click bounces on a promise the page does not repeat.
3. **Placements: Automatic without a 9:16 asset** (§1). Decide deliberately — supply the vertical
   crop, or restrict to Feed.
