/**
 * Tests for the outbound-mail transcript.
 *
 * The load-bearing one is the production guard. Message bodies carry live
 * access tokens — a recipient link is a bearer credential — so a recorder that
 * could arm on a production instance would turn a debugging aid into a
 * credential store.
 *
 * Feature: relay-h0-mvp
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  startTranscript,
  stopTranscript,
  getTranscript,
  isRecording,
  recordSend,
} from './transcript';

const msg = { to: 'sarah@example.com', subject: 'Your Relay access is now available', text: 'Open it here:\nhttps://relaystandby.com/access?token=abc.def.ghi\n' };

beforeEach(() => stopTranscript());
afterEach(() => {
  stopTranscript();
  delete process.env.VERCEL_ENV;
});

describe('production guard', () => {
  it('REFUSES to arm on Vercel production — bodies carry bearer tokens', () => {
    process.env.VERCEL_ENV = 'production';
    expect(startTranscript()).toBe(false);
    expect(isRecording()).toBe(false);
  });

  it('records nothing while disarmed in production', () => {
    process.env.VERCEL_ENV = 'production';
    startTranscript();
    recordSend(msg, { accepted: true });
    expect(getTranscript()).toHaveLength(0);
  });

  it('arms in preview and development', () => {
    for (const env of ['preview', 'development', undefined]) {
      stopTranscript();
      if (env) process.env.VERCEL_ENV = env;
      else delete process.env.VERCEL_ENV;
      expect(startTranscript()).toBe(true);
    }
  });
});

describe('recording', () => {
  it('is a no-op when never armed — the default must cost nothing', () => {
    recordSend(msg, { accepted: true });
    expect(getTranscript()).toEqual([]);
    expect(isRecording()).toBe(false);
  });

  it('captures recipient, subject and body', () => {
    startTranscript();
    recordSend(msg, { accepted: true });

    expect(getTranscript()[0]).toMatchObject({
      to: 'sarah@example.com',
      subject: 'Your Relay access is now available',
      accepted: true,
    });
  });

  it('extracts the links — the part a human is asked to act on', () => {
    startTranscript();
    recordSend(msg, { accepted: true });
    expect(getTranscript()[0].links).toEqual(['https://relaystandby.com/access?token=abc.def.ghi']);
  });

  it('captures MULTIPLE links and strips trailing punctuation', () => {
    startTranscript();
    recordSend(
      { ...msg, text: 'One (https://a.test/x) and two: https://b.test/y.' },
      { accepted: true },
    );
    expect(getTranscript()[0].links).toEqual(['https://a.test/x', 'https://b.test/y.']);
  });

  it('records a FAILED send with its reason — the useful case', () => {
    startTranscript();
    recordSend(msg, { accepted: false, error: 'Resend rejected the send: validation_error' });

    expect(getTranscript()[0]).toMatchObject({ accepted: false });
    expect(getTranscript()[0].error).toContain('validation_error');
  });

  it('preserves send order, which is what a family actually experiences', () => {
    startTranscript();
    recordSend({ ...msg, subject: 'first' }, { accepted: true });
    recordSend({ ...msg, subject: 'second' }, { accepted: true });
    recordSend({ ...msg, subject: 'third' }, { accepted: true });

    expect(getTranscript().map((e) => e.subject)).toEqual(['first', 'second', 'third']);
  });

  it('re-arming keeps existing entries rather than silently discarding them', () => {
    startTranscript();
    recordSend(msg, { accepted: true });
    startTranscript();
    expect(getTranscript()).toHaveLength(1);
  });

  it('stop clears, so one scenario cannot bleed into the next', () => {
    startTranscript();
    recordSend(msg, { accepted: true });
    stopTranscript();
    expect(getTranscript()).toEqual([]);
  });

  it('handles a body with no links at all', () => {
    startTranscript();
    recordSend({ ...msg, text: 'No action needed.' }, { accepted: true });
    expect(getTranscript()[0].links).toEqual([]);
  });
});
