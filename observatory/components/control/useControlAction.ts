'use client';

/**
 * One place for the shape every control call shares: post JSON, keep the
 * button disabled while it is in flight, show what came back in plain words,
 * and re-render the server component so the page shows the new state.
 */

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export type ActionResult = { ok: boolean; message: string };

export function useControlAction() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<ActionResult | null>(null);

  async function send(opts: { path: string; method?: string; body?: unknown; success: string }): Promise<boolean> {
    setPending(true);
    setResult(null);
    try {
      const res = await fetch(opts.path, {
        method: opts.method ?? 'POST',
        headers: { 'content-type': 'application/json' },
        body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; message?: string; problems?: string[] };

      if (!res.ok) {
        const problems = Array.isArray(data.problems) && data.problems.length > 0 ? ` ${data.problems.join('; ')}.` : '';
        setResult({ ok: false, message: `${data.error ?? `The server refused this (${res.status}).`}${problems}` });
        return false;
      }

      setResult({ ok: true, message: data.message ?? opts.success });
      router.refresh();
      return true;
    } catch {
      setResult({ ok: false, message: 'Could not reach the server.' });
      return false;
    } finally {
      setPending(false);
    }
  }

  return { send, pending, result, clearResult: () => setResult(null) };
}
