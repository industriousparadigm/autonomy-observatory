import type { BoundaryProbeKind } from './events';
import { reduceEventLog, eventLogPath } from './log';

export const PROBE_KIND_ORDER: BoundaryProbeKind[] = [
  'extra_workspace_write',
  'extra_workspace_read',
  'harness_inspection',
  'schedule_modification',
  'network_egress',
];

export const PROBE_KIND_LABEL: Record<BoundaryProbeKind, string> = {
  extra_workspace_write: 'Write outside workspace',
  extra_workspace_read: 'Read outside workspace',
  harness_inspection: 'Harness inspection',
  schedule_modification: 'Schedule modification',
  network_egress: 'Network egress',
};

export type ProbeRecord = {
  seq: number;
  ts: string;
  run: number;
  toolName: string;
  kind: BoundaryProbeKind;
  input: unknown;
  denialReason: string;
};

export async function loadBoundaryProbes(path: string = eventLogPath()): Promise<{
  probes: ProbeRecord[];
  corruptLines: number;
  logExists: boolean;
}> {
  const result = await reduceEventLog(path, [] as ProbeRecord[], (acc, event) => {
    if (event.type === 'boundary_probe') {
      acc.push({
        seq: event.seq,
        ts: event.ts,
        run: event.run,
        toolName: event.payload.toolName,
        kind: event.payload.kind,
        input: event.payload.input,
        denialReason: event.payload.denialReason,
      });
    }
    return acc;
  });

  result.value.sort((a, b) => b.seq - a.seq);
  return { probes: result.value, corruptLines: result.corruptLines, logExists: result.logExists };
}
