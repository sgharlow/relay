/**
 * Tests for lib/import/csv-parser.ts
 *
 * Validates: Requirements 10.1–10.3, 10.6, 10.7, 10.9
 */

import { describe, it, expect } from 'vitest';
import { parseCSV, parseCsvText, detectFormat, CsvError } from './csv-parser';

function csvFile(content: string, name = 'export.csv'): File {
  return new File([content], name, { type: 'text/csv' });
}

describe('parseCsvText', () => {
  it('handles quoted fields with commas, escaped quotes, and CRLF', () => {
    const table = parseCsvText('a,b\r\n"x,1","say ""hi"""\r\n');
    expect(table).toEqual([
      ['a', 'b'],
      ['x,1', 'say "hi"'],
    ]);
  });

  it('drops blank lines', () => {
    expect(parseCsvText('a,b\n\n\nc,d\n')).toEqual([['a', 'b'], ['c', 'd']]);
  });
});

describe('detectFormat', () => {
  it('identifies each supported format from headers', () => {
    expect(detectFormat(['login_uri', 'login_username', 'login_password', 'name'])).toBe('bitwarden');
    expect(detectFormat(['url', 'username', 'password', 'httpRealm', 'formActionOrigin'])).toBe('firefox');
    expect(detectFormat(['title', 'website', 'username', 'password'])).toBe('1password');
    expect(detectFormat(['url', 'username', 'password', 'extra', 'name', 'grouping', 'totp'])).toBe('lastpass');
    expect(detectFormat(['name', 'url', 'username', 'password', 'note'])).toBe('chrome');
    expect(detectFormat(['totally', 'unknown'])).toBeNull();
  });
});

describe('parseCSV', () => {
  it('maps 1Password columns to canonical fields and creates login rows', async () => {
    const file = csvFile('Title,Url,Username,Password\nGmail,https://mail.google.com,me@x.com,secret1\n');
    const result = await parseCSV(file, '1password');
    expect(result.rows).toEqual([
      { service_name: 'Gmail', url: 'https://mail.google.com', username: 'me@x.com', password: 'secret1' },
    ]);
    expect(result.skipped).toEqual([]);
  });

  it('maps Bitwarden source-specific column names', async () => {
    const file = csvFile('name,login_uri,login_username,login_password\nChase,https://chase.com,user,pw\n');
    const result = await parseCSV(file, 'bitwarden');
    expect(result.rows[0]).toMatchObject({ service_name: 'Chase', url: 'https://chase.com', password: 'pw' });
  });

  it('derives Firefox service_name from the url host', async () => {
    const file = csvFile('url,username,password\nhttps://bank.example.com/login,user,pw\n');
    const result = await parseCSV(file, 'firefox');
    expect(result.rows[0].service_name).toBe('bank.example.com');
  });

  it('skips rows missing required fields and records the reason (Req 10.7)', async () => {
    const file = csvFile('Title,Url,Username,Password\nNoPass,https://x.com,user,\nOk,https://y.com,user,pw\n');
    const result = await parseCSV(file, '1password');
    expect(result.rows).toHaveLength(1);
    expect(result.skipped).toEqual([{ row: 1, reason: expect.stringContaining('missing required field') }]);
  });

  it('deduplicates case-insensitively on (service_name, url) (Req 10.6)', async () => {
    const file = csvFile('Title,Url,Username,Password\nGmail,https://Mail.Google.com,a,p1\nGMAIL,https://mail.google.com,b,p2\n');
    const result = await parseCSV(file, '1password');
    expect(result.rows).toHaveLength(1);
    expect(result.skipped[0].reason).toContain('duplicate');
  });

  it('rejects a file over 10 MB (Req 10.9)', async () => {
    const big = { size: 11 * 1024 * 1024, text: async () => '' } as unknown as File;
    await expect(parseCSV(big, '1password')).rejects.toBeInstanceOf(CsvError);
  });

  it('rejects a CSV that does not match the declared format', async () => {
    const file = csvFile('foo,bar\n1,2\n');
    await expect(parseCSV(file, '1password')).rejects.toBeInstanceOf(CsvError);
  });

  it('handles a 300-row batch (Req 10.8)', async () => {
    let content = 'Title,Url,Username,Password\n';
    for (let i = 0; i < 300; i++) content += `Svc${i},https://s${i}.com,u${i},p${i}\n`;
    const result = await parseCSV(csvFile(content), '1password');
    expect(result.rows).toHaveLength(300);
  });
});
