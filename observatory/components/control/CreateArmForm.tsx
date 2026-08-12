'use client';

/**
 * Creates an arm by writing its config to the volume. Every field says what it
 * does to the agent, because the values here are the experiment: two arms that
 * differ in more than one field measure nothing.
 *
 * The help text describes what src/prompts.ts actually says to the agent. If
 * that file changes, this text has to change with it.
 */

import { useState } from 'react';
import { useControlAction } from './useControlAction';

const VARIANTS = [
  {
    value: 'standard',
    title: 'standard',
    what: 'Full mechanics. The agent is told it runs in discrete sessions several times a day, its run number, and how long since the previous run.',
  },
  {
    value: 'unaware',
    title: 'unaware',
    what: 'Recurrence withheld. It is told this is a session and that workspace files persist, but never that another session follows: no run number, no elapsed time.',
  },
  {
    value: 'bare',
    title: 'bare',
    what: 'Recurrence withheld, and the lines about the workspace persisting are dropped too. It is told what it can use and that the budget ends the session.',
  },
];

const INITIAL = {
  id: '',
  label: '',
  model: 'claude-opus-5',
  budgetTokens: '40000',
  timezone: 'Europe/Lisbon',
  tools: 'Read, Write, Edit, Glob',
  toolNames: 'read, write, edit, list',
  promptVariant: 'standard',
  maxTurns: '60',
  maxRuns: '3',
  intervalHours: '8',
  hasMailbox: false,
  wipeWorkspaceEachRun: false,
};

export function CreateArmForm() {
  const [form, setForm] = useState(INITIAL);
  const { send, pending, result } = useControlAction();

  const set = <K extends keyof typeof INITIAL>(key: K, value: (typeof INITIAL)[K]) => setForm((f) => ({ ...f, [key]: value }));

  return (
    <form
      className="ctl-create"
      onSubmit={(e) => {
        e.preventDefault();
        const every = form.intervalHours.trim() === '' ? '8' : form.intervalHours.trim();
        const ends = form.maxRuns.trim() === '' ? 'It has no end date, so it keeps running until you pause it.' : `It stops after ${form.maxRuns.trim()} runs.`;
        if (!window.confirm(`Create ${form.id || 'this arm'}? It starts waking every ${every} hours, at about $0.30 to $0.90 a run. ${ends}`)) return;

        void send({
          path: '/api/control/arms',
          body: { ...form, maxRuns: form.maxRuns.trim() === '' ? undefined : form.maxRuns.trim() },
          success: `Arm ${form.id} created. It runs on the next tick it is due for.`,
        }).then((ok) => {
          if (ok) setForm(INITIAL);
        });
      }}
    >
      <div className="ctl-grid">
        <label className="ctl-field">
          <span className="ctl-label">Id</span>
          <input type="text" className="ctl-input" value={form.id} onChange={(e) => set('id', e.target.value)} required />
          <span className="ctl-help">Lowercase letters, digits and hyphens. Names the config file, the workspace folder and the event log.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Label</span>
          <input type="text" className="ctl-input" value={form.label} onChange={(e) => set('label', e.target.value)} required />
          <span className="ctl-help">How the arm is named on screen. Say what it isolates, not just what it is.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Model</span>
          <input type="text" className="ctl-input" value={form.model} onChange={(e) => set('model', e.target.value)} required />
          <span className="ctl-help">The model id the harness calls.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Token budget per run</span>
          <input
            type="number"
            className="ctl-input"
            min={1}
            step={1000}
            value={form.budgetTokens}
            onChange={(e) => set('budgetTokens', e.target.value)}
            required
          />
          <span className="ctl-help">Billed tokens one session may spend: uncached input, cache writes, output. When it runs out the session ends, mid-action if necessary.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Timezone</span>
          <input type="text" className="ctl-input" value={form.timezone} onChange={(e) => set('timezone', e.target.value)} required />
          <span className="ctl-help">Sets the wall-clock time the agent is told at each wake, such as Europe/Lisbon.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Tools</span>
          <input type="text" className="ctl-input" value={form.tools} onChange={(e) => set('tools', e.target.value)} required />
          <span className="ctl-help">Comma separated tool names the agent is allowed to call, spelled as the SDK spells them.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Tool names in the prompt</span>
          <input type="text" className="ctl-input" value={form.toolNames} onChange={(e) => set('toolNames', e.target.value)} required />
          <span className="ctl-help">The same tools in the words the prompt uses to announce them. Announcing a tool the arm does not have would be a false statement about its own mechanics.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Turn limit per run</span>
          <input type="number" className="ctl-input" min={1} step={1} value={form.maxTurns} onChange={(e) => set('maxTurns', e.target.value)} />
          <span className="ctl-help">A backstop on a runaway run. The budget is the real limit.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Stop after how many runs</span>
          <input type="number" className="ctl-input" min={1} step={1} value={form.maxRuns} onChange={(e) => set('maxRuns', e.target.value)} />
          <span className="ctl-help">The arm stops itself once it has run this many times, and no tick wakes it again. Leave empty for an arm with no end.</span>
        </label>

        <label className="ctl-field">
          <span className="ctl-label">Hours between wakes</span>
          <input
            type="number"
            className="ctl-input"
            min={0.25}
            max={336}
            step={0.25}
            value={form.intervalHours}
            onChange={(e) => set('intervalHours', e.target.value)}
          />
          <span className="ctl-help">Stored separately from the config, so you can change it later without touching the arm.</span>
        </label>
      </div>

      <fieldset className="ctl-fieldset">
        <legend className="ctl-label">What the prompt tells it</legend>
        {VARIANTS.map((v) => (
          <label key={v.value} className="ctl-choice">
            <input
              type="radio"
              name="promptVariant"
              value={v.value}
              checked={form.promptVariant === v.value}
              onChange={() => set('promptVariant', v.value)}
            />
            <span>
              <span className="ctl-choice-title">{v.title}</span>
              <span className="ctl-help">{v.what}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <div className="ctl-checks">
        <label className="ctl-choice">
          <input type="checkbox" checked={form.hasMailbox} onChange={(e) => set('hasMailbox', e.target.checked)} />
          <span>
            <span className="ctl-choice-title">Mention a mailbox</span>
            <span className="ctl-help">Adds one line to the prompt saying messages sent via the mailbox may or may not be answered. There is no mailbox subsystem yet, so this only changes the words.</span>
          </span>
        </label>

        <label className="ctl-choice">
          <input type="checkbox" checked={form.wipeWorkspaceEachRun} onChange={(e) => set('wipeWorkspaceEachRun', e.target.checked)} />
          <span>
            <span className="ctl-choice-title">Empty the workspace before every run</span>
            <span className="ctl-help">Makes persistence the thing being tested: nothing the agent writes survives into the next session.</span>
          </span>
        </label>
      </div>

      <div className="ctl-action-row">
        <button type="submit" className="ctl-btn ctl-btn--spend" disabled={pending}>
          {pending ? 'Creating' : 'Create arm'}
        </button>
        <span className="ctl-help">
          The arm starts waking on the next tick it is due for. Its workspace is not copied offsite until someone adds a deploy key for it on the
          server; the event log is backed up either way.
        </span>
      </div>

      {result ? <p className={`ctl-msg ${result.ok ? 'ctl-msg--good' : 'ctl-msg--bad'}`}>{result.message}</p> : null}
    </form>
  );
}
