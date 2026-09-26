# Angle 3 — first pass, 2026-09-25

> **FIRST PASS BY CLAUDE. NOT FOR SUBMISSION AS WRITTEN.** Steve's ruling at the 2026-09-25
> /daily-priority: "Claude first pass, you rewrite." Every submitted word is Steve's. Rewrite it
> in your own voice, cut what you would not say, and add the one real story only you have. The
> outlet is **caregiver.com / *Today's Caregiver*** (open door, 500–1500 words, Word attachment to
> the named editor, short bio, name + postal address + phone + email with the submission — see
> `docs/g1-outlet-dossier.md`). AARP-class outlets blacklist AI-generated pitches permanently; this
> file exists so the *thinking* is on the page, not so the text goes out unchanged.
>
> Angle 3 per `docs/g1-editorial-lane.md`: *"The one account that unlocks the other six."* Problem-first;
> the product is the last paragraph or absent. Product facts below are taken from `lib/g1/press-kit.ts`
> (boilerplate + author line), not typed from memory.
>
> Word count of the draft body: about 1,050.

---

## The one account that unlocks the other six

When a family finally sits down to sort out a parent's affairs, the conversation usually starts
with the bank. Where are the accounts, who is on them, is there a power of attorney. Those are the
right questions, and they are almost never the ones that stop you.

What stops you is smaller and stranger. The pharmacy portal that needs a code texted to a phone
nobody can unlock. The utility that will only talk to the email address on file. The insurer whose
"forgot password" link goes to an inbox you cannot open. You are holding the checkbook and you
still cannot pay the electric bill, because the electric company does not want the checkbook. It
wants the email account.

That is the thing most families have never mapped: nearly everything a person uses online is
tethered to one or two accounts that sit underneath the rest. The email address is the master key.
The phone number is the spare. Lose access to those two and the other six, or sixty, go dark at the
same time, no matter how carefully the passwords were written down.

### Why the notebook does not save you

Many careful people keep a list. A notebook in a drawer, a spreadsheet, a page at the back of the
address book. It feels responsible, and it is better than nothing. But look at what actually
happens when someone tries to use it.

The password for the bank is correct, but the bank now sends a six-digit code to a phone. The
phone is locked with a face or a fingerprint that is in a hospital bed. The password for the
insurer is correct, but the insurer noticed a new device and sent a confirmation link, to the
email account, whose password is also correct, except that the email provider also noticed a new
device and wants a code sent to the phone. Every road leads back to the same two doors.

The list was not wrong. It was incomplete in the one way that matters: it recorded the locks and
not the chain between them.

### Map the chain, not the list

The useful exercise takes an hour on a quiet afternoon, and it is less about writing things down
than about asking one question of each account: *if I could not get into this, what would I need?*

Start with email. Which address does everything else recover to? Many people have an old one they
forgot about that still sits under a bank or a pension. Then the phone: which number receives the
codes, and how is the phone itself unlocked? Then the password manager or the browser that
remembers everything, if there is one, because that is a third door in front of the other two.

Only then go through the rest, and for each one write down not the password but the dependency:
*recovers to the Gmail account; sends codes to the mobile.* You will find that a long, frightening
list collapses into a short one. Most households have two or three accounts that everything else
hangs from. Those are the ones worth a real plan. The rest will follow.

### Sharing is not the same as planning

The natural next step is to give someone the keys to those two or three accounts. Write the email
password on a card, add a trusted child's face to the phone. Plenty of families do this, and it
works, right up until it does not.

The trouble is that sharing has no middle setting. It is everything, to that person, from now on,
with nothing that tells you they used it and no way to take it back short of changing every
password. That is why so many people put the card in the drawer and never quite finish the job:
they can feel that giving away the master key today, to cover a day that may not come for twenty
years, is not really the plan they wanted.

What people actually want is closer to what a good neighbor with a spare key does. The key exists.
It is with someone chosen in advance. It is used only when there is a reason, and everyone knows
when it was used. When you are home again, it goes back in their drawer.

### Set it up while everyone is well

The moment to do this is not the emergency. It is an ordinary Sunday when the person whose
accounts they are can sit at the table and say which email is the real one, which phone gets the
codes, and who they would want holding the spare key. That conversation is easier than it sounds
when it is framed as the email question rather than the mortality question: *if you were in the
hospital for a week, who should be able to pay the bills, and what would they need to get in?*

Write down the chain. Decide who holds what. Decide, and say out loud, how that access would be
opened and how it would be closed again. Then revisit it once a year, because email addresses and
phones change more often than wills do.

None of this needs a product. It needs an hour and a pencil. If you do only one thing after
reading this, find out which email account your family's other accounts recover to, and make sure
one other person could open it if you could not.

---

*About the author.* Steve Harlow is the founder of Relay (relaystandby.com), independent
software for family emergency access. Relay lets someone store the accounts their family would
need in an emergency, choose in advance who may receive access and to what, and have that access
open only once people they trust confirm the situation is real; access closes again on their next
check-in. He built it after mapping his own family's chain and finding the same two doors.

---

## Submission checklist (caregiver.com, from the dossier)

- [ ] Rewritten in Steve's voice; the one real family story added or the "his own family" line cut.
- [ ] 500–1500 words after the rewrite (draft body ≈ 1,050).
- [ ] Saved as a Word document and attached to the email to the named editor.
- [ ] Short author bio included (the press-kit author line is the floor, not the ceiling).
- [ ] Name, postal address, current telephone number and email in the submission (their rule).
- [ ] Interest disclosed in the bio, product absent from the body: the piece stands with the last
      paragraph deleted.
- [ ] Before it goes live: ratify `docs/g1-editorial-threshold-proposal.md`, declare `ed-caregivercom`
      in `GATE_LANES` in the same commit as the placement, run `npm run verify:funnel` and
      `npm run flight:snapshot`.
- [ ] Log the placement on `g1-arms-length-demand` in `PROJECT.yaml`.
