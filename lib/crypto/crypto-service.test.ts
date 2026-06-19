/**
 * Tests for lib/crypto/crypto-service.ts
 *
 * Validates: Requirements 2.1, 2.2, 2.3, 2.7
 *  - Property 5: Zero plaintext at rest
 */

import { describe, it, expect, vi } from 'vitest';
import fc from 'fast-check';
import {
  CryptoService,
  CryptoError,
  base64ToBytes,
  bytesToBase64,
  packIvCiphertext,
  unpackIvCiphertext,
} from './crypto-service';

// A real 256-bit data key, base64-encoded (mirrors what /api/kms/wrap returns).
function freshKeyB64(): string {
  return bytesToBase64(crypto.getRandomValues(new Uint8Array(32)));
}

// Build a fetch stub: wrap returns the given key; vault POST captures the body.
function makeFetch(keyB64: string, captured: { body?: Record<string, unknown> }) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    if (url === '/api/kms/wrap') {
      return new Response(
        JSON.stringify({
          plaintext_data_key: keyB64,
          wrapped_data_key: bytesToBase64(new Uint8Array([1, 2, 3, 4])),
          kms_key_id: 'cmk-test',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url === '/api/vault/items') {
      captured.body = JSON.parse(init!.body as string);
      return new Response(JSON.stringify({ id: 'item-1' }), { status: 200 });
    }
    throw new Error(`unexpected url ${url}`);
  }) as unknown as typeof fetch;
}

describe('encryptItem / decryptItem round-trip', () => {
  it('decrypts back to the original plaintext', async () => {
    const svc = new CryptoService();
    const key = freshKeyB64();
    const { ciphertext, iv } = await svc.encryptItem('hunter2', key);
    const back = await svc.decryptItem(ciphertext, iv, key);
    expect(back).toBe('hunter2');
  });

  it('rejects a data key that is not 256-bit', async () => {
    const svc = new CryptoService();
    const shortKey = bytesToBase64(new Uint8Array(16));
    await expect(svc.encryptItem('x', shortKey)).rejects.toBeInstanceOf(CryptoError);
  });

  it('fails decryption with the wrong key (auth tag mismatch)', async () => {
    const svc = new CryptoService();
    const { ciphertext, iv } = await svc.encryptItem('secret', freshKeyB64());
    await expect(svc.decryptItem(ciphertext, iv, freshKeyB64())).rejects.toBeInstanceOf(CryptoError);
  });
});

describe('IV packing', () => {
  it('unpack(pack(iv, ct)) round-trips both halves', () => {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = crypto.getRandomValues(new Uint8Array(40));
    const { iv: iv2, ciphertext: ct2 } = unpackIvCiphertext(packIvCiphertext(iv, ct));
    expect(Array.from(iv2)).toEqual(Array.from(iv));
    expect(Array.from(ct2)).toEqual(Array.from(ct));
  });

  it('decrypts an encrypt→pack→unpack→decrypt round-trip', async () => {
    const svc = new CryptoService();
    const key = freshKeyB64();
    const { ciphertext, iv } = await svc.encryptItem('top-secret', key);
    const packed = packIvCiphertext(iv, ciphertext);
    const restored = unpackIvCiphertext(packed);
    const back = await svc.decryptItem(restored.ciphertext, restored.iv, key);
    expect(back).toBe('top-secret');
  });

  it('rejects a blob too short to contain an IV', () => {
    expect(() => unpackIvCiphertext(new Uint8Array(8))).toThrow(CryptoError);
  });
});

describe('saveItem flow', () => {
  it('requests wrap, encrypts, and persists ciphertext + wrapped key', async () => {
    const captured: { body?: Record<string, unknown> } = {};
    const fetchImpl = makeFetch(freshKeyB64(), captured);
    const svc = new CryptoService(fetchImpl);

    const res = await svc.saveItem('my-password', { type: 'login', title: 'Gmail' });
    expect(res.id).toBe('item-1');
    expect(captured.body).toBeDefined();
    expect(captured.body!.wrapped_data_key).toBeTruthy();
    expect(captured.body!.kms_key_id).toBe('cmk-test');
    expect(captured.body!.title).toBe('Gmail');
    // plaintext must not appear anywhere in the persisted body
    expect(JSON.stringify(captured.body)).not.toContain('my-password');
  });

  it('encryptForUpload returns a server-ready payload without uploading', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/kms/wrap') {
        return new Response(
          JSON.stringify({ plaintext_data_key: freshKeyB64(), wrapped_data_key: 'WK', kms_key_id: 'cmk' }),
          { status: 200 },
        );
      }
      throw new Error('vault must NOT be called by encryptForUpload');
    }) as unknown as typeof fetch;

    const svc = new CryptoService(fetchImpl);
    const payload = await svc.encryptForUpload('s3cret', { type: 'login', title: 'Gmail', url: 'https://x.com' });
    expect(payload.wrapped_data_key).toBe('WK');
    expect(payload.kms_key_id).toBe('cmk');
    expect(payload.title).toBe('Gmail');
    expect(payload.ciphertext.length).toBeGreaterThan(0);
    expect(JSON.stringify(payload)).not.toContain('s3cret');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the wrap call
  });

  it('aborts and transmits nothing when the wrap request fails', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url === '/api/kms/wrap') return new Response('nope', { status: 500 });
      throw new Error('vault should never be called');
    }) as unknown as typeof fetch;

    const svc = new CryptoService(fetchImpl);
    await expect(svc.saveItem('x', { type: 'note', title: 'n' })).rejects.toBeInstanceOf(CryptoError);
    expect(fetchImpl).toHaveBeenCalledTimes(1); // only the wrap attempt
  });
});

// ---------------------------------------------------------------------------
// Property 5 — Zero plaintext at rest
// ---------------------------------------------------------------------------

describe('Property 5: zero plaintext at rest', () => {
  it('stored ciphertext never equals the UTF-8 bytes of the plaintext; wrapped key present', async () => {
    // Feature: relay-h0-mvp, Property 5: Zero plaintext at rest
    await fc.assert(
      fc.asyncProperty(fc.string({ minLength: 1, maxLength: 500 }), async (plaintext) => {
        const captured: { body?: Record<string, unknown> } = {};
        const svc = new CryptoService(makeFetch(freshKeyB64(), captured));

        await svc.saveItem(plaintext, { type: 'note', title: 't' });

        const body = captured.body!;
        const storedCipher = base64ToBytes(body.ciphertext as string);
        const plainBytes = new TextEncoder().encode(plaintext);

        // ciphertext must not equal the plaintext bytes
        const equal =
          storedCipher.length === plainBytes.length &&
          storedCipher.every((b, i) => b === plainBytes[i]);
        expect(equal).toBe(false);

        // wrapped key persisted (non-empty)
        expect((body.wrapped_data_key as string).length).toBeGreaterThan(0);
      }),
      { numRuns: 200 },
    );
  });
});
