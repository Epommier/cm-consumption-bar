export type Window = { kind: string; percentUsed: number; resetsAt?: string }

export type Snapshot = {
  model: string
  effort?: string
  costUsd?: number
  rateLimits: Window[]
  linesAdded: number
  linesRemoved: number
}

declare module 'claude-code' {
  interface PluginState {
    'consumption-bar': { snapshot: Snapshot; tick: number }
  }
}
