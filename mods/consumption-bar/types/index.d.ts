export type Window = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  model: string
  effort?: string
  costUsd?: number
  rateLimits: Window[]
  linesAdded: number
  linesRemoved: number
}

// What the store keeps per session, under `s:<startedAt>`.
export type Persisted = { effort?: string; linesAdded: number; linesRemoved: number; savedAt: number }

declare module 'claude-code' {
  interface PluginState {
    'consumption-bar': { snapshot: Snapshot; tick: number }
  }
}
