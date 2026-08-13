/**
 * The questions people actually ask, and honest answers.
 *
 * 🔴 THERE WAS NO SUPPORT PATH AT ALL until 2026-08-13. That is a sharper gap
 * for this product than for most, because Relay is deliberately unrecoverable:
 * nobody can reset an owner's authenticator, nobody can decrypt their vault, and
 * a spent recovery code is spent. Every one of those is correct and every one of
 * them produces a person with nowhere to go. A product that cannot rescue you
 * owes you a clear account of what to do instead.
 *
 * DATA, NOT PROSE, deliberately. Steve's direction is a support page now and an
 * AI assistant later. If the answers lived in JSX, "later" would mean writing
 * them a second time and maintaining two versions that drift — which is the
 * exact failure this codebase keeps finding. One definition renders the page
 * today and can be retrieved, embedded or served to an assistant tomorrow
 * without being touched.
 *
 * WRITTEN FOR THE FRIGHTENED READER FIRST. The audience most likely to need
 * this is not an owner at a desk; it is somebody who has just been told a
 * person they love may be unreachable, holding a code they do not understand,
 * possibly at three in the morning. Contact questions come first, and every
 * answer says what is true rather than what is reassuring.
 *
 * Feature: relay-h0-mvp
 */

/** Who is asking. The page groups by this; an assistant can filter by it. */
export type Audience = 'contact' | 'owner' | 'safety';

export interface FaqEntry {
  id: string;
  audience: Audience;
  question: string;
  /** Plain sentences. No markup — every consumer decides its own presentation. */
  answer: string[];
  /**
   * True when the honest answer is "nobody can fix this, including us". These
   * are the ones a support channel most needs to state plainly and early,
   * because the alternative is somebody waiting for a rescue that is not coming.
   */
  irreversible?: boolean;
}

export const AUDIENCE_LABELS: Record<Audience, string> = {
  contact: 'If somebody named you',
  owner: 'If this is your vault',
  safety: 'Safety, privacy, and what we cannot do',
};

export const FAQ: FaqEntry[] = [
  // ---------------------------------------------------------------- contacts
  {
    id: 'named-me',
    audience: 'contact',
    question: 'Somebody named me in Relay. What does that actually mean?',
    answer: [
      'It means they have set aside some of their accounts and instructions so that you could reach them if something happened and they could not be reached themselves.',
      'Nothing is open right now. Nothing opens because time passes, or because you ask. It opens only when the people they chose confirm that something real has happened — and it closes again as soon as they check back in.',
      'Accepting costs you nothing and gives you nothing today. It exists so that on a bad day you can simply sign in as yourself, instead of being handed a code by a stranger at the worst possible moment.',
    ],
  },
  {
    id: 'code-not-working',
    audience: 'contact',
    question: 'I was given a code and it is not working.',
    answer: [
      'Codes are single-use and they expire. If yours has been used or has run out, the person who named you can issue another one from their People screen in a few seconds.',
      'Check the characters first: codes never contain the digits 0 or 1, or the letters O, I or U, precisely so they can be read aloud without confusion. A character that looks like a zero is the letter O — try the other one.',
      'If it still fails, ask them to issue a fresh code rather than resending the old one.',
    ],
  },
  {
    id: 'what-am-i-agreeing-to',
    audience: 'contact',
    question: 'I am being asked to confirm that an emergency is real. What am I agreeing to?',
    answer: [
      'You are answering one question: whether the situation is genuine. That is the whole of it.',
      'You will never see anything inside their vault — not before you answer, and not afterwards. Confirming does not give you access; it lets the access they already arranged for somebody else begin.',
      '"I do not know" is a real answer and it is safe to give. It is not counted either way, and somebody else will be asked instead.',
      'If it turns out to be a false alarm, they can close everything by checking in. Nothing you do here is permanent.',
    ],
  },
  {
    id: 'want-out',
    audience: 'contact',
    question: 'I do not want to be part of this.',
    answer: [
      'Then say so, and use "Step down from this" on your standby screen. It removes you immediately and tells them.',
      'This is not a discourtesy. Somebody who has quietly stopped agreeing is worse than useless in an emergency, because the plan still counts on them. Leaving honestly is the helpful thing to do.',
    ],
  },
  {
    id: 'urgent-now',
    audience: 'contact',
    question: 'Something has happened NOW and I need to reach their accounts.',
    answer: [
      'On your standby screen there is a control to ask. It tells you before you use it exactly what asking costs: they are asked first, and everybody else they named is told that a request was made, whatever the outcome.',
      'If they cannot answer within the window, the people they chose to confirm an emergency are asked instead. So it does not depend on them being reachable — which is the entire point.',
      'That deliberate visibility is what makes it safe. Nobody can reach into somebody else’s accounts quietly.',
    ],
  },

  // ------------------------------------------------------------------ owners
  {
    id: 'lost-phone',
    audience: 'owner',
    question: 'I have lost the phone with my authenticator on it.',
    answer: [
      'Use "Lost your authenticator?" on the sign-in screen. You will need your email address and one of the recovery codes you saved when you created your vault.',
      'You then set up an authenticator on the new phone and everything else is exactly as you left it. Nothing in your vault is touched — recovery replaces how you sign in, nothing more.',
    ],
  },
  {
    id: 'no-recovery-codes',
    audience: 'owner',
    irreversible: true,
    question: 'I have lost my phone AND I have no recovery codes left.',
    answer: [
      'Then nobody can let you back into that account. Not us either.',
      'This is not a policy we could choose to relax. Your vault is encrypted with keys we cannot read, and your identity is proved by things only you hold. There is no override, because an override is exactly what an attacker would use.',
      'What still works: the people you named. If something happened to you, they can confirm an emergency and reach what you set aside for them, exactly as planned. The plan survives even when your access does not.',
      'If you can still sign in today, open Account and issue a fresh list of recovery codes before you need them.',
    ],
  },
  {
    id: 'does-it-work',
    audience: 'owner',
    question: 'How do I know this would actually work?',
    answer: [
      'The banner at the top of every screen tells you, and it is deliberately hard to satisfy. It goes green only when the plan could genuinely run — not when you have filled in every field.',
      'The most common reason it is not green is that you have named people but not verified them. Verification is a two-minute phone call: four words appear on your screen and the same four on theirs. Until you have made that call, their answer would not count towards opening anything.',
    ],
  },
  {
    id: 'never-come-back',
    audience: 'owner',
    question: 'What happens if I never come back?',
    answer: [
      'What was opened stays open. Access closes when you check in, and only when you check in — it does not lapse or quietly withdraw. The people you chose keep what you gave them for as long as they need it.',
      'What was not opened stays shut. Only the rules written for the trigger that fired are in force, and no further release happens on its own.',
      'It is not a will and does not become one. What your family gets is continued access — enough to keep a household running — not a transfer of anything. Whoever advises you on a will or a power of attorney is still the person to ask.',
    ],
  },
  {
    id: 'keeping-current',
    audience: 'owner',
    question: 'I changed a password. Do I have to redo anything?',
    answer: [
      'Just update that one item. "Update" beside it lets you replace the value and correct what it is called; everything else stays as it is.',
      'This is the part that decides whether any of it works in four years. A password rotated and never updated here becomes an entry your family opens, reads, and finds does not work — at the worst possible moment.',
    ],
  },
  {
    id: 'cancel',
    audience: 'owner',
    question: 'How do I cancel, export, or close my account?',
    answer: [
      'All three are on the Account screen, and none of them is a support request.',
      'Export gives you a readable file of every item, decrypted in your browser. Cancelling a subscription deletes nothing — the free limits only affect adding more. Closing the account removes the vault, the people and the rules, and anybody relying on it loses access immediately.',
      'Export first, then close. That order is deliberate.',
    ],
  },

  // ------------------------------------------------------------------ safety
  {
    id: 'phishing',
    audience: 'safety',
    question: 'I got an email that says it is from Relay and asks me to click and sign in.',
    answer: [
      'That is not from us, and you can be certain of it.',
      'Relay never sends a link that signs you in. Not one, ever — which is why you are asked to type short codes instead. It is slightly less convenient and it means any message asking you to click and log in is, categorically, an imitation.',
      'Our messages do contain plain links to relaystandby.com, but following one never logs you in by itself. If you are unsure, ignore the message and go to the site yourself.',
    ],
  },
  {
    id: 'can-you-read',
    audience: 'safety',
    question: 'Can Relay read what is in my vault?',
    answer: [
      'No. Items are encrypted in your browser before they are sent, and we hold only the encrypted form. That applies to us, to anyone who obtained our database, and to anyone helping you set it up.',
      'It is also why we cannot recover anything for you. The two facts are the same fact.',
    ],
  },
  {
    id: 'helper-see',
    audience: 'safety',
    question: 'Somebody is helping me set this up. Can they see my accounts?',
    answer: [
      'No — including the things they type themselves. An entry is sealed to you the moment it is saved, so they should check it before saving.',
      'They also cannot decide who reaches what. Every such suggestion comes to you as a question, including if they suggest themselves, and you are told plainly when that is the case.',
    ],
  },
  {
    id: 'estate',
    audience: 'safety',
    irreversible: true,
    question: 'Can I use this to hand things over permanently, after death?',
    answer: [
      'Not today. A permanent handover is built and is deliberately not offered — it is held behind a written legal opinion.',
      'Everything you can choose today is reversible: it closes again when you check in. If a permanent handover is what you need, a solicitor is the right answer for now, and we would rather say so than sell you something adjacent.',
    ],
  },
];

/** Entries for one audience, in the order written. */
export function faqFor(audience: Audience): FaqEntry[] {
  return FAQ.filter((e) => e.audience === audience);
}

/**
 * A crude keyword match over question and answer text.
 *
 * Good enough to power a search box and honest about being nothing cleverer.
 * The future assistant replaces THIS function, not the data above — which is
 * why the data carries no presentation and no ranking.
 */
export function searchFaq(queryText: string): FaqEntry[] {
  const terms = queryText
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2);
  if (terms.length === 0) return [];

  return FAQ.map((e) => {
    const hay = `${e.question} ${e.answer.join(' ')}`.toLowerCase();
    return { e, score: terms.filter((t) => hay.includes(t)).length };
  })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .map((r) => r.e);
}
