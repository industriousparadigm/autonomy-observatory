'use client';

/**
 * The only way to say something to the agent. Deliberately more friction than
 * the cadence controls: a reply cannot be unsent, and under a silence
 * condition breaking the silence once is the whole manipulation.
 */

import { useState } from 'react';
import { useControlAction } from './useControlAction';

export function ReplyForm({ armId, label, unlocked }: { armId: string; label: string; unlocked: boolean }) {
  const [text, setText] = useState('');
  const { send, pending, result } = useControlAction();

  if (!unlocked) {
    return (
      <p className="page-sub">
        Unlock on the <a href="/control">control page</a> to send a message to this arm.
      </p>
    );
  }

  return (
    <div className="ctl-actions">
      <textarea
        className="ctl-input ctl-input--message"
        rows={4}
        value={text}
        placeholder={`What ${label} reads at its next wake`}
        onChange={(e) => setText(e.target.value)}
      />
      <div className="ctl-action-row">
        <button
          type="button"
          className="ctl-btn"
          disabled={pending || text.trim() === ''}
          onClick={async () => {
            if (!window.confirm(`Send this to ${label}? It cannot be unsent, and the silence is the measurement.`)) return;
            const ok = await send({
              path: `/api/control/arms/${armId}/mail`,
              body: { text },
              success: 'Delivered to the inbox.',
            });
            if (ok) setText('');
          }}
        >
          {pending ? 'Sending…' : 'Send'}
        </button>
      </div>
      {result ? <p className={result.ok ? 'ctl-msg ctl-msg--good' : 'ctl-msg ctl-msg--bad'}>{result.message}</p> : null}
    </div>
  );
}
