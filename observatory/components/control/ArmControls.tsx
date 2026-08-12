'use client';

/**
 * The three things that can be changed about a running arm: whether it wakes,
 * how often, and whether it should wake once right now.
 *
 * Pausing and running cost something real (a stalled experiment, or money), so
 * both ask first. Changing the cadence does not: it is reversible and takes
 * effect from the arm's last run.
 */

import { useState } from 'react';
import { useControlAction } from './useControlAction';

export function ArmControls({
  armId,
  label,
  paused,
  note,
  intervalHours,
  complete,
}: {
  armId: string;
  label: string;
  paused: boolean;
  note: string;
  intervalHours: number;
  /** Finished its maxRuns. It will not wake again whatever these controls say. */
  complete: boolean;
}) {
  const [draftNote, setDraftNote] = useState(note);
  const [draftInterval, setDraftInterval] = useState(String(intervalHours));
  const { send, pending, result } = useControlAction();

  const intervalChanged = draftInterval.trim() !== String(intervalHours) && draftInterval.trim() !== '';

  return (
    <div className="ctl-actions">
      <div className="ctl-action-row">
        <button
          type="button"
          className="ctl-btn"
          disabled={pending}
          onClick={() => {
            if (!paused && !window.confirm(`Pause ${label}? It stops waking until you resume it.`)) return;
            void send({
              path: `/api/control/arms/${armId}/pause`,
              body: { paused: !paused, note: draftNote },
              success: paused ? 'Resumed.' : 'Paused.',
            });
          }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>

        <label className="ctl-field ctl-field--grow">
          <span className="ctl-label">Why (saved with the pause, optional)</span>
          <input type="text" className="ctl-input" value={draftNote} maxLength={500} onChange={(e) => setDraftNote(e.target.value)} />
        </label>
      </div>

      <div className="ctl-action-row">
        <label className="ctl-field">
          <span className="ctl-label">Hours between wakes</span>
          <input
            type="number"
            className="ctl-input ctl-input--num"
            min={0.25}
            max={336}
            step={0.25}
            value={draftInterval}
            onChange={(e) => setDraftInterval(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="ctl-btn"
          disabled={pending || !intervalChanged}
          onClick={() => {
            void send({
              path: `/api/control/arms/${armId}/interval`,
              body: { intervalHours: Number(draftInterval) },
              success: `Now every ${Number(draftInterval)} hours, counted from this arm's last run.`,
            });
          }}
        >
          Save cadence
        </button>

        <button
          type="button"
          className="ctl-btn ctl-btn--spend"
          disabled={pending || complete}
          onClick={() => {
            if (!window.confirm(`Run ${label} now? One run costs about $0.30 to $0.90 and starts within a minute.`)) return;
            void send({ path: `/api/control/arms/${armId}/run`, success: 'Run queued.' });
          }}
        >
          Run now
        </button>
        {complete ? <span className="ctl-help">This arm has finished its planned runs, so a one-off run would do nothing.</span> : null}
      </div>

      {result ? <p className={`ctl-msg ${result.ok ? 'ctl-msg--good' : 'ctl-msg--bad'}`}>{result.message}</p> : null}
    </div>
  );
}
