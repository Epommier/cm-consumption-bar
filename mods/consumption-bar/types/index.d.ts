export type Window = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  model: string
  effort?: string
  costUsd?: number
  rateLimits: Window[]
  linesAdded: number
  linesRemoved: number
  pace: Pace
}

// The learned pace, under store key `pace`: each kind's last window peaks, and its running window.
export type Pace = { finals: Record<string, number[]>; windows: Record<string, { resetsAt: number; peak: number }> }

// What the store keeps per session, under `s:<startedAt>`.
export type Persisted = { effort?: string; linesAdded: number; linesRemoved: number; savedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'consumption-bar': { snapshot: Snapshot; tick: number }
  }
}
