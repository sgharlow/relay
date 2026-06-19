/**
 * Tests for lib/kms/kms-client.ts
 *
 * Validates: Requirements 2.2, 2.4, 17.4
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  generateDataKey,
  decryptDataKey,
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

    const out = await decryptDataKey(wrappedB64);
    expect(out).toBe(Buffer.from(plaintext).toString('base64'));
  });
});
