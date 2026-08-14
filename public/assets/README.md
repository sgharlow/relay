# Relay — visual assets

A set of graphical elements for relaystandby.com, derived from the four reference
renders in the repo root (`relay1.png` … `relay4.png`) and translated into the
product's own design language.

Every file here is hand-authored SVG. Nothing fetches anything.

---

## What the references got right, and what had to change

The four renders share one set of ideas, and they are the right ideas — they are
the product's actual differentiators:

| Idea in the references | Kept as |
|---|---|
| People arranged around a vault | `circle-of-trust.svg` — the hero |
| N-of-M shown as lit nodes on a ring | `quorum-ring.svg` |
| A baton handed from one person to the next | `the-handoff.svg` |
| States distinguished by colour | `state/*.svg` |

What could not survive is the **register**. Three things about the references
work against this particular product:

**1. The vault is the hero and people are decoration.** In every reference a
bank door dominates the frame and the humans stand on rings around it, which
reads as a facility with staff. Relay's own name for that journey is *building
the circle of trust*, and the argument the product actually makes is that PEOPLE
are the lock. So the composition is inverted: people are the subject and the
vault is the least interesting object in the picture.

**2. They all depict an emergency.** A baton en route, `50% TO UNLOCKED`,
`5 of 6 approvals received`, `INITIATING HANDOFF`. That is the worst day of
somebody's life, and the product spends essentially all of its existence in
`ARMED`. A prospect deciding whether to trust a startup with their bank logins
should first be shown the calm.

**3. The colour semantics are inverted relative to the product's own.**
`src/app/globals.css` is explicit, and it is worth quoting because it is unusual
and correct:

> *Each colour has exactly one job and appears nowhere else … there is no
> "success" colour: nothing in Relay is a success. Things are either armed, or
> someone is having the worst week of their life.*

| Token | Job | In the references |
|---|---|---|
| `--sage` `#4f7a6b` | **armed, closed, safe** — the resting state | used as neon-green "VERIFIED / success" |
| `--ochre` `#b4703a` | **in motion, and reversible** | roughly matches their amber ✓ |
| `--clay` `#b2402c` | **permanent only** — estate handoff, closing an account | used as red for "has not replied yet" |

That last row is the load-bearing one. Painting *"this person has not answered
yet"* in red would tell a worried reader that an ordinary, entirely reversible
wait is **irreversible** — the exact opposite of the product's central promise.
So there is **no red anywhere in this set**. A person who has not answered is
drawn as an *absence*: an empty seat, an unfilled ring.

Also dropped: the robotic hand in `relay2.png`. For a product whose whole
argument is that a machine never opens anything on its own, a robot arm passing
the credential is the worst available messenger.

---

## The rules the set follows

1. **Nothing is connected at rest.** The hero's people do not touch the vault.
   `key-stays-with-you.svg` shows an empty space where a key would be. The
   absence carries the meaning — it is the same device in three drawings.
2. **Faces are never drawn.** A face forces a decision about whose family this
   is, and the buyer is meant to see their own. It is also the only version that
   does not age.
3. **Words live on the page, not in the picture** — except `social-card.svg`,
   where the image *is* the message to every platform that renders it.
4. **One object, drawn once.** The same vault appears in the hero, the quorum
   centre, at-rest and the social card. The same "settled ground" ellipse means
   *this person is confirmed* in every drawing and in the `standby` icon.
5. **Ink for structure, colour for state.** Icons are ink only; if an icon
   carried state colour it would compete with the state marks, which are the
   only things allowed to mean a state.

---

## Files

### `brand/`
| File | Use |
|---|---|
| `relay-mark.svg` | the mark, 32px and up, on light grounds |
| `relay-mark-inverse.svg` | the same on ink — `--ochre` on `--ink` measures ≈3.4:1, so it lifts to `--ochre-soft` |
| `relay-icon-16.svg` | the small cut. Below ~32px the arc becomes mud, so it is dropped rather than rendered badly |
| `social-card.svg` | 1200×630 Open Graph card, in-palette |

### `illustration/`
| File | Where it belongs |
|---|---|
| `circle-of-trust.svg` | the landing hero |
| `quorum-ring.svg` | the full explainer version — needs ~140px or more |
| `quorum-mark.svg` | the small cut of the same idea, for 64px and below |
| `the-handoff.svg` | how-it-works — the product's name, drawn once |
| `reversible.svg` | the single most valuable claim to a caregiver: *it comes back* |
| `key-stays-with-you.svg` | `/security` — client-side encryption without the vocabulary |
| `no-sign-in-links.svg` | `/security`, `/help` — the anti-phishing promise |
| `at-rest.svg` | the standby dashboard's empty state |

### `state/` — `armed` · `pending` · `grace` · `released` · `stood-down`
One shape family, filling as a release advances. Never red.

### `icon/` — `vault` · `people` · `standby` · `check-in` · `sealed-record` · `break-glass`
24px grid, 1.75 stroke, ink only.

### `contact-sheet.html`
Open `/assets/contact-sheet.html` to review the whole set at the sizes each asset
is actually used. This is how the set was iterated: four rounds, each one fixing
something only visible once rendered.

---

## Using them

**Always as `<img>`, with `alt=""` when decorative.**

```tsx
<img src="/assets/illustration/circle-of-trust.svg" alt="" width={1100} height={372}
     className="h-auto w-full" />
```

Every file uses `var(--token, #fallback)`. Served as an `<img>` the fallbacks
apply, and those *are* the current token values — so the rendering is identical
to the themed one today, and the files stay ready to be inlined if a dark mode
ever arrives and someone raises the colour ceiling for that page.

⚠️ **Do not inline them into JSX today.** `lib/ops/raw-color.test.ts` is a
ratchet: any page not already on its list may contain **zero** hex literals, and
inlining an SVG imports its fallbacks straight into the page. The build fails,
correctly.

Decorative assets take `alt=""` — everything they say is already in the
surrounding text. Every file carries its own `<title>` and `<desc>` for the case
where one is opened directly.

---

## Where these are used

Wired in on 2026-08-13 and verified rendered, not assumed:

| Asset | Page |
|---|---|
| `circle-of-trust.svg` | `/` — below the headline and CTAs |
| `reversible.svg` · `key-stays-with-you.svg` · `quorum-mark.svg` | `/` — one per claim in the three-up |
| `the-handoff.svg` | `/how-it-works` — above the timeline |
| `key-stays-with-you.svg` · `no-sign-in-links.svg` | `/security` — above the prose |
| `at-rest.svg` | the standby dashboard, **only** when nothing is open |

Two app files were also brought into the palette. Both had been off it since
before the design system existed, and both are among the most-seen surfaces the
brand has:

- **`src/app/icon.svg`** — every browser tab. Was `#0f172a` / `#3b82f6` /
  `#fbbf24` (Tailwind slate/blue/amber).
- **`src/app/opengraph-image.tsx`** — every link pasted into Slack, iMessage or
  LinkedIn. Rebuilt from `social-card.svg`'s design in Satori-safe flexbox, with
  two changes of substance beyond colour: the state row now **returns to Armed**
  rather than ending at Released, and the withdrawn estate claim is gone.

### Two rules learned by rendering, not by reasoning

**Assets get `<img>`, never inlined JSX.** `lib/ops/raw-color.test.ts` is a
ratchet: a page not already on its list may contain *zero* hex literals. Inlining
an SVG would import its `var(--token, #fallback)` fallbacks straight into the
page and fail the build. As `<img>` the fallbacks are used — which are the
current token values, so it is visually identical.

**Anything below ~80px needs its own cut.** Twice now the full-size asset turned
to mud when shrunk: the brand mark's arc below 32px (`relay-icon-16.svg`) and the
quorum ring's centre, arc and dashes below ~140px (`quorum-mark.svg`). Both were
found by rendering at the real size and looking. Neither was visible in the code.

---

## If a photographic or rendered hero is ever wanted

SVG is the right medium for everything above: it scales, themes, prints (the
guide has printable fallbacks), stays a few KB against the references' 2–7 MB,
and needs no external request under the site's CSP. But if a rendered image is
wanted for an ad or a press kit, these are the prompts — written to the same
rules, so the output would sit beside the set rather than fight it.

**Hero — the circle at rest**
> Wide editorial illustration, warm off-white paper background (#f7f4ee). Five
> simplified faceless human figures in soft charcoal line-work (#1f1b16), evenly
> arranged in an open ring around a small, plain, closed safe. The safe is
> understated and matte, not chrome or high-tech; a single muted sage-green
> (#4f7a6b) indicator light on its front. Three figures stand on pale sage-green
> discs, two on plain ground. Nothing connects the figures to the safe. Generous
> negative space, flat matte finish, no glow, no neon, no lens flare, no grid or
> HUD overlay, no text. Calm, patient, domestic rather than institutional.
> Muted warm palette only: off-white, charcoal, sage green, ochre (#b4703a).

**The handoff**
> Two simplified faceless figures in charcoal line-work on warm off-white paper.
> A small ochre (#b4703a) capsule travels along a gentle arc from the first
> figure toward the second. The arc behind the capsule is solid; ahead of it,
> dotted. Human hands only if hands appear at all — no robotics, no machinery,
> no energy effects, no sparks. Flat, matte, calm. No text.

**Negative prompt for both**
> neon, glow, bloom, lens flare, dark background, black background, HUD, sci-fi
> interface, holographic, circuit board, robotic hand, chrome, brushed metal,
> red alert, warning colours, percentages, progress numerals, text, watermark

**What to check before using any render.** The set's rules are easy to lose in
generation: no red anywhere; the figures must not touch the vault; the safe must
stay less interesting than the people; and no words baked into the image.
