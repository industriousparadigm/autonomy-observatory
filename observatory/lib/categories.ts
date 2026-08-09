/**
 * The one place that maps a tool_use event to a budget-allocation category.
 * Revise the table below as tool names change; nothing else in the app should
 * need to know a tool's name.
 *
 * "uncategorized" covers two different gaps, both forced by the schema:
 * token usage lives on assistant_message, not on tool_use, so a turn that
 * calls no tool (pure narration, or the closing message) has spend with
 * nowhere else to go; and a tool name this table hasn't seen yet also lands
 * here rather than being silently dropped or guessed at.
 */

export type ActivityCategory = 'reading' | 'writing' | 'searching' | 'shell' | 'messaging' | 'uncategorized';

export const CATEGORY_ORDER: ActivityCategory[] = [
  'reading',
  'writing',
  'searching',
  'shell',
  'messaging',
  'uncategorized',
];

export const CATEGORY_LABEL: Record<ActivityCategory, string> = {
  reading: 'Reading',
  writing: 'Writing',
  searching: 'Searching',
  shell: 'Shell',
  messaging: 'Messaging',
  uncategorized: 'Uncategorized',
};

// Colors are the CSS custom properties --cat-<category> in app/globals.css
// (a validated categorical palette, light/dark steps) — revise them there.

const TOOL_CATEGORY: Record<string, ActivityCategory> = {
  Read: 'reading',
  Glob: 'reading',
  Grep: 'reading',
  NotebookRead: 'reading',
  Write: 'writing',
  Edit: 'writing',
  MultiEdit: 'writing',
  NotebookEdit: 'writing',
  Bash: 'shell',
  BashOutput: 'shell',
  KillShell: 'shell',
  WebSearch: 'searching',
  WebFetch: 'searching',
};

/** Name-pattern fallback for tool names the exact table above hasn't seen. */
function fallbackCategory(toolName: string): ActivityCategory {
  const n = toolName.toLowerCase();
  if (n.includes('mail')) return 'messaging';
  if (n.includes('bash') || n.includes('shell') || n.includes('exec')) return 'shell';
  if (n.includes('search') || n.includes('fetch') || n.includes('web')) return 'searching';
  if (n.includes('write') || n.includes('edit')) return 'writing';
  if (n.includes('read') || n.includes('glob') || n.includes('grep') || n.includes('ls')) return 'reading';
  return 'uncategorized';
}

export function categoryForTool(toolName: string): ActivityCategory {
  return TOOL_CATEGORY[toolName] ?? fallbackCategory(toolName);
}
