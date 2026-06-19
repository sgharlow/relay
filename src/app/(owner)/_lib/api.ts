/**
 * Tiny client-side fetch helpers for the owner screens. Surfaces the server's
 * `{ message }` on non-2xx so forms can show inline errors.
 *
 * Feature: relay-h0-mvp
 */

export async function apiGet<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to load (${res.status})`);
  return (await res.json()) as T;
}

export async function apiSend<T>(
  url: string,
  method: 'POST' | 'PUT' | 'DELETE',
  body?: unknown,
): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as { message?: string };
  if (!res.ok) throw new Error(data.message ?? `Request failed (${res.status})`);
  return data as T;
}
