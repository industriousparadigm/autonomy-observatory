'use client';

/**
 * The lock on the whole page. The token is typed once, exchanged for a cookie
 * the browser sends on later calls, and never held anywhere this component can
 * read it back: the cookie is HttpOnly and the input is cleared on success.
 */

import { useState } from 'react';
import { useControlAction } from './useControlAction';

export function UnlockForm({ unlocked, tokenConfigured }: { unlocked: boolean; tokenConfigured: boolean }) {
  const [token, setToken] = useState('');
  const { send, pending, result } = useControlAction();

  if (!tokenConfigured) {
    return (
      <div className="ctl-lock">
        <strong>Controls are off.</strong>
        <p className="ctl-help">
          CONTROL_TOKEN is not set on this service. Nothing here can pause an arm, change a cadence or start a run until it is set and the service
          restarts.
        </p>
      </div>
    );
  }

  if (unlocked) {
    return (
      <div className="ctl-lock ctl-lock--open">
        <span className="pill pill--done">Unlocked</span>
        <span className="ctl-help">Controls work in this browser for the next 12 hours.</span>
        <button
          type="button"
          className="ctl-btn"
          disabled={pending}
          onClick={() => {
            void send({ path: '/api/control/session', method: 'DELETE', success: 'Locked again.' });
          }}
        >
          Lock again
        </button>
        {result && !result.ok ? <span className="ctl-msg ctl-msg--bad">{result.message}</span> : null}
      </div>
    );
  }

  return (
    <form
      className="ctl-lock"
      onSubmit={(e) => {
        e.preventDefault();
        void send({ path: '/api/control/session', body: { token }, success: 'Unlocked.' }).then((ok) => {
          if (ok) setToken('');
        });
      }}
    >
      <label className="ctl-field">
        <span className="ctl-label">Control token</span>
        <input
          type="password"
          value={token}
          autoComplete="off"
          onChange={(e) => setToken(e.target.value)}
          className="ctl-input"
          placeholder="paste the token"
        />
      </label>
      <button type="submit" className="ctl-btn ctl-btn--primary" disabled={pending || token.length === 0}>
        {pending ? 'Checking' : 'Unlock controls'}
      </button>
      {result && !result.ok ? <span className="ctl-msg ctl-msg--bad">{result.message}</span> : null}
      <p className="ctl-help">
        Reading this page needs no token. Pausing an arm, changing a cadence, starting a run or creating an arm does, because those spend money or
        change a running experiment.
      </p>
    </form>
  );
}
