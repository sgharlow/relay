/**
 * Feature: relay-standby
 */

import { describe, it, expect } from 'vitest';

import { isMicrosoftMailbox, describeProviderRisk, MICROSOFT_MAILBOX_LABEL } from './mailbox-provider';

describe('isMicrosoftMailbox', () => {
  it.each([
    'someone@outlook.com',
    'someone@hotmail.com',
    'someone@live.com',
    'someone@msn.com',
  ])('recognises %s', (addr) => {
    expect(isMicrosoftMailbox(addr)).toBe(true);
  });

  it.each([
    'someone@outlook.co.uk',
    'someone@hotmail.fr',
    'someone@live.com.au',
    'someone@outlook.de',
  ])('recognises the country variant %s', (addr) => {
    expect(isMicrosoftMailbox(addr)).toBe(true);
  });

  it.each(['someone@gmail.com', 'someone@relaystandby.com', 'someone@icloud.com'])(
    'leaves %s alone',
    (addr) => {
      expect(isMicrosoftMailbox(addr)).toBe(false);
    },
  );

  it('ignores case and surrounding space', () => {
    expect(isMicrosoftMailbox('  Someone@OutLook.COM ')).toBe(true);
  });

  /*
    A SUBSTRING MATCH WOULD BE A SECURITY-SHAPED BUG IN A WARNING. `outlook.com`
    appears inside `outlook.com.example.net`, and inside a local part, and a
    check that fired on either would warn about addresses that have nothing to
    do with Microsoft — which is how a warning stops being believed.
  */
  it.each([
    'someone@outlook.com.example.net',
    'someone@notoutlook.com',
    'outlook.com@example.net',
    'someone@example.net',
  ])('does not fire on %s', (addr) => {
    expect(isMicrosoftMailbox(addr)).toBe(false);
  });

  it.each(['', '   ', 'not-an-address', 'someone@', '@outlook.com'])(
    'treats %j as unknown rather than throwing',
    (addr) => {
      expect(isMicrosoftMailbox(addr)).toBe(false);
    },
  );
});

describe('describeProviderRisk', () => {
  it('says nothing for a provider we have measured nothing about', () => {
    expect(describeProviderRisk({ name: 'Alex', email: 'alex@gmail.com' })).toBeNull();
  });

  it('warns about a Microsoft mailbox by name', () => {
    const text = describeProviderRisk({ name: 'Alex', email: 'alex@outlook.com' });
    expect(text).toBeTruthy();
    expect(text).toContain('Alex');
    expect(text).toContain(MICROSOFT_MAILBOX_LABEL);
  });

  /*
    A warning with no next action is just anxiety. Both levers the owner
    actually has must be in the sentence: say it out loud instead, and get us
    onto their contacts list — `jmr:0` on both junked test messages means no
    user rule matched, so a contacts entry is a real lever and not folklore.
  */
  it('gives the owner both things they can do about it', () => {
    const text = describeProviderRisk({ name: 'Alex', email: 'alex@outlook.com' }) ?? '';
    expect(text.toLowerCase()).toMatch(/phone|read it to|tell them/);
    expect(text).toContain('relay@relaystandby.com');
  });

  it('names the sender address it is given rather than a second hardcoded copy', () => {
    const text =
      describeProviderRisk({
        name: 'Alex',
        email: 'alex@outlook.com',
        senderEmail: 'someone-else@example.net',
      }) ?? '';
    expect(text).toContain('someone-else@example.net');
    expect(text).not.toContain('relay@relaystandby.com');
  });
});
