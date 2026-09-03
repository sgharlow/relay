/**
 * Tests for lib/kms/kms-client.ts
 *
 * Validates: Requirements 2.2, 2.4, 17.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateDataKey,
  decryptDataKey,
  wrapsWithContext,
  KMS_CONTEXT_ERA_OWNER_V1,
  _setKmsClientForTesting,
} from './kms-client';
import {
  GenerateDataKeyCommand,
  DecryptCommand,
  type KMSClient,
} from '@aws-sdk/client-kms';

// A stub KMSClient whose send() inspects the command type.
function stubClient(send: (cmd: unknown) => Promise<unknown>): KMSClient {
  return { send: vi.fn(send) } as unknown as KMSClient;
}

beforeEach(() => {
  process.env.KMS_KEY_ID = 'arn:aws:kms:us-east-1:123:key/abc';
});

afterEach(() => {
  _setKmsClientForTesting(null);
  vi.restoreAllMocks();
});

describe('generateDataKey', () => {
  it('returns base64 plaintext + wrapped key and the CMK id', async () => {
    const plaintext = new Uint8Array([1, 2, 3, 4]);
    const wrapped = new Uint8Array([9, 8, 7]);
    _setKmsClientForTesting(
      stubClient(async (cmd) => {
        expect(cmd).toBeInstanceOf(GenerateDataKeyCommand);
        return { Plaintext: plaintext, CiphertextBlob: wrapped, KeyId: 'cmk-1' };
      }),
    );

    const out = await generateDataKey();
    expect(out.plaintextDataKey).toBe(Buffer.from(plaintext).toString('base64'));
    expect(out.wrappedDataKey).toBe(Buffer.from(wrapped).toString('base64'));
    expect(out.kmsKeyId).toBe('cmk-1');
  });

  it('throws when KMS_KEY_ID is unset', async () => {
    delete process.env.KMS_KEY_ID;
    await expect(generateDataKey()).rejects.toThrow(/KMS_KEY_ID/);
  });

  it('throws when KMS returns an empty plaintext blob', async () => {
    _setKmsClientForTesting(stubClient(async () => ({ CiphertextBlob: new Uint8Array([1]) })));
    await expect(generateDataKey()).rejects.toThrow(/empty key blob/);
  });
});

describe('decryptDataKey', () => {
  it('sends the wrapped key as CiphertextBlob and returns base64 plaintext', async () => {
    const wrappedB64 = Buffer.from([5, 6, 7]).toString('base64');
    const plaintext = new Uint8Array([42, 43]);
    _setKmsClientForTesting(
      stubClient(async (cmd) => {
        expect(cmd).toBeInstanceOf(DecryptCommand);
        const input = (cmd as DecryptCommand).input;
        expect(Buffer.from(input.CiphertextBlob as Uint8Array)).toEqual(Buffer.from([5, 6, 7]));
        return { Plaintext: plaintext };
      }),
    );

    const out = await decryptDataKey(wrappedB64, { era: null, ownerId: 'owner-1' });
    expect(out).toBe(Buffer.from(plaintext).toString('base64'));
  });
});

/*
  ── Phase B: the reading side, proven while nothing writes a context ────────
  docs/encryption-context-rollout.md. Every assertion below reads the REAL
  command input the client would send, not the stub — the stub only stands in
  for AWS. The three properties the rollout sheet requires are one test each.
*/

/** Captures the commands a call would have sent to KMS. */
function recordingClient(reply: unknown = { Plaintext: new Uint8Array([1]) }) {
  const sent: unknown[] = [];
  _setKmsClientForTesting(
    stubClient(async (cmd) => {
      sent.push(cmd);
      return reply;
    }),
  );
  return sent;
}

describe('decryptDataKey routes on the row era', () => {
  it('property 1 — a NULL era sends NO EncryptionContext', async () => {
    const sent = recordingClient();
    await decryptDataKey(Buffer.from([1]).toString('base64'), { era: null, ownerId: 'owner-1' });

    expect(sent).toHaveLength(1);
    const input = (sent[0] as DecryptCommand).input;
    // Absent, not present-and-undefined: the call is what it has always been.
    expect(Object.keys(input)).not.toContain('EncryptionContext');
    expect(input.EncryptionContext).toBeUndefined();
  });

  it('property 1 — an undefined era is legacy too, not an error', async () => {
    const sent = recordingClient();
    await decryptDataKey(Buffer.from([1]).toString('base64'), {
      era: undefined,
      ownerId: 'owner-1',
    });

    const input = (sent[0] as DecryptCommand).input;
    expect(Object.keys(input)).not.toContain('EncryptionContext');
    expect(input.EncryptionContext).toBeUndefined();
  });

  it("property 2 — an 'owner_v1' era sends EncryptionContext { owner_id } for that row's owner", async () => {
    const sent = recordingClient();
    await decryptDataKey(Buffer.from([1]).toString('base64'), {
      era: KMS_CONTEXT_ERA_OWNER_V1,
      ownerId: 'owner-42',
    });

    const input = (sent[0] as DecryptCommand).input;
    expect(input.EncryptionContext).toEqual({ owner_id: 'owner-42' });
  });

  it('property 3 — an unrecognised era throws and sends NO DecryptCommand', async () => {
    const sent = recordingClient();
    await expect(
      decryptDataKey(Buffer.from([1]).toString('base64'), {
        era: 'owner_v2',
        ownerId: 'owner-1',
      }),
    ).rejects.toThrow(/unrecognised|unrecognized/i);

    // The refusal happens BEFORE KMS is asked anything. A decrypt that fails
    // and then retries weaker is the permanently-available bypass
    // docs/encryption-context-design.md §2 exists to prevent.
    expect(sent).toHaveLength(0);
  });

  it('names KeyId on every DecryptCommand, legacy row and context row alike', async () => {
    const sent = recordingClient();
    await decryptDataKey(Buffer.from([1]).toString('base64'), { era: null, ownerId: 'o' });
    await decryptDataKey(Buffer.from([1]).toString('base64'), {
      era: KMS_CONTEXT_ERA_OWNER_V1,
      ownerId: 'o',
    });

    expect(sent).toHaveLength(2);
    for (const cmd of sent) {
      expect((cmd as DecryptCommand).input.KeyId).toBe(process.env.KMS_KEY_ID);
    }
  });

  it('refuses when KMS_KEY_ID is unset rather than sending an unnamed Decrypt', async () => {
    const sent = recordingClient();
    delete process.env.KMS_KEY_ID;
    await expect(
      decryptDataKey(Buffer.from([1]).toString('base64'), { era: null, ownerId: 'o' }),
    ).rejects.toThrow(/KMS_KEY_ID/);
    expect(sent).toHaveLength(0);
  });
});

describe('generateDataKey takes an optional EncryptionContext', () => {
  const reply = { Plaintext: new Uint8Array([1]), CiphertextBlob: new Uint8Array([2]) };

  it('property 1 — sends NO EncryptionContext when called without one', async () => {
    const sent = recordingClient(reply);
    await generateDataKey();

    const input = (sent[0] as GenerateDataKeyCommand).input;
    expect(Object.keys(input)).not.toContain('EncryptionContext');
    expect(input.EncryptionContext).toBeUndefined();
  });

  it('sends the context it is given — the seam phase C flips on', async () => {
    const sent = recordingClient(reply);
    await generateDataKey({ owner_id: 'owner-42' });

    const input = (sent[0] as GenerateDataKeyCommand).input;
    expect(input.EncryptionContext).toEqual({ owner_id: 'owner-42' });
  });
});

describe('wrapsWithContext — the phase C flag, off in phase B', () => {
  afterEach(() => {
    delete process.env.KMS_WRAP_WITH_CONTEXT;
  });

  it('is off when the variable is unset', () => {
    delete process.env.KMS_WRAP_WITH_CONTEXT;
    expect(wrapsWithContext()).toBe(false);
  });

  it('is off for anything that is not exactly "true"', () => {
    for (const v of ['', 'false', '1', 'yes', 'TRUE', 'true ']) {
      process.env.KMS_WRAP_WITH_CONTEXT = v;
      expect(wrapsWithContext(), `${JSON.stringify(v)} must not enable it`).toBe(false);
    }
  });

  it('is on only for "true"', () => {
    process.env.KMS_WRAP_WITH_CONTEXT = 'true';
    expect(wrapsWithContext()).toBe(true);
  });
});
