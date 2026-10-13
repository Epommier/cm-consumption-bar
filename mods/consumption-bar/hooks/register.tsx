// Consumption Bar: what this session is spending, in a card above the prompt.
//   Model and effort, session cost, lines added/removed by Edit/Write, and one bar per
//   rate-limit window (5h, 7d) with its reset countdown. Stacks above context-bar.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Snapshot, Window } from '../types'

const MIN_WIDTH = 20 // narrower than this, the card is not drawn
const TICK_MS = 60_000
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
// Effort tag color, cold to hot. Unknown or numeric levels fall back to gray.
const EFFORT_COLOR: Record<string, string> = { low: 'gray', medium: 'blue', high: 'yellow', xhigh: '#ff9e64', max: 'red' }
const ORDER = ['five_hour', 'seven_day']

// Held by the host, so the card survives a hot reload of this file.
const snapshot = atom({ plugin: 'consumption-bar', key: 'snapshot' } as const, { model: '', rateLimits: [], linesAdded: 0, linesRemoved: 0 } as Snapshot)
const tick = atom({ plugin: 'consumption-bar', key: 'tick' } as const, 0)

let timer: Timer | undefined // one countdown timer, even if session.start fires again

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const r = await next(e)
    timer?.cancel()
    timer = $.clock.every(TICK_MS, () => {
      void update($, tick, n => n + 1).catch(() => {})
    })
    const usage = await $.session.usage().catch(() => null)
    if (usage) await take($, usage.rateLimits, usage.cost?.usd).catch(() => {})
    await refreshModel($).catch(() => {})
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await take($, e.rateLimits, e.cost?.usd).catch(() => {})
    return r
  })

  on('turn.start', async ($, e, next) => {
    const r = await next(e)
    await refreshModel($).catch(() => {}) // covers a /model switch
    return r
  })

  // A streaming hook: effort is on the input, so it is read before passing the step through.
  on('turn.step', async function* ($, e, next) {
    if (!e.agentId && e.effort !== undefined) {
      const effort = String(e.effort)
      await update($, snapshot, s => ({ ...s, effort })).catch(() => {})
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if ((e.tool === 'Edit' || e.tool === 'Write') && !r.deny && !r.isError) {
      const { added, removed } = countLines(e.tool, r.result)
      if (added + removed > 0) {
        await update($, snapshot, s => ({ ...s, linesAdded: s.linesAdded + added, linesRemoved: s.linesRemoved + removed })).catch(() => {})
      }
    }
    return r
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const rest = await next(e) // what other mods and Claude Code draw here stays
    await read($, tick) // redraws on each tick of the countdown
    const snap = await read($, snapshot)
    const inner = e.props.bodyColumns - 4 // the border and padding take 4 cells
    if (e.props.hasSurvey || inner < MIN_WIDTH) return rest

    const { Box, Text } = $.ui.resolve(e)
    const now = await $.clock.now()
    const windows = [...snap.rateLimits].sort((a, b) => rank(a.kind) - rank(b.kind))
    const changed = snap.linesAdded + snap.linesRemoved > 0

    return (
      <Box flexDirection="column">
        <Box flexDirection="column" borderStyle="round" borderColor="inactive" paddingX={1}>
          <Box flexDirection="row" justifyContent="space-between">
            <Text wrap="truncate-end">
              <Text color="#d97757">{'◆ '}</Text>
              <Text bold>consumption</Text>
            </Text>
            <Text wrap="truncate-start">
              <Text>{'🧠 '}</Text>
              <Text bold>{snap.model}</Text>
              {snap.effort && <Text color={EFFORT_COLOR[snap.effort] ?? 'gray'}>{` [${snap.effort}]`}</Text>}
              {snap.costUsd !== undefined && <Text>{' · '}</Text>}
              {snap.costUsd !== undefined && <Text>{'💰 '}</Text>}
              {snap.costUsd !== undefined && <Text color="green">{`$${snap.costUsd.toFixed(2)}`}</Text>}
              {changed && <Text>{' · '}</Text>}
              {changed && <Text>{'✏️ '}</Text>}
              {changed && <Text color="green">{`+${snap.linesAdded}`}</Text>}
              {changed && <Text dimColor>/</Text>}
              {changed && <Text color="red">{`-${snap.linesRemoved}`}</Text>}
            </Text>
          </Box>
          {windows.length > 0 && <Text dimColor>{'─'.repeat(inner)}</Text>}
          {windows.map(w => {
            const color = colorFor(w.percentUsed)
            const badge = ` ${Math.round(w.percentUsed)}% `
            const reset = w.resetsAt ? `   resets in ${countdown(w.resetsAt, now)}` : ''
            const b = bar(w.percentUsed, Math.max(10, inner - (2 + 1 + 2 + badge.length + reset.length)))
            return (
              <Text wrap="truncate-end">
                <Text>{`${label(w.kind).padEnd(2)} `}</Text>
                <Text color={color}>{'█'.repeat(b.filled)}</Text>
                <Text dimColor>{'░'.repeat(b.empty)}</Text>
                <Text>{'  '}</Text>
                <Text bold color="black" backgroundColor={color}>{badge}</Text>
                {reset && <Text dimColor>{reset}</Text>}
              </Text>
            )
          })}
        </Box>
        {rest}
      </Box>
    )
  })
}

async function take($: EngineInterface, rateLimits: readonly Window[], costUsd: number | undefined) {
  const windows = rateLimits
    .filter(w => Number.isFinite(w.percentUsed))
    .map(w => ({ kind: w.kind, percentUsed: w.percentUsed, resetsAt: w.resetsAt }))
  await update($, snapshot, s => ({ ...s, rateLimits: windows, costUsd }))
}

async function refreshModel($: EngineInterface) {
  const model = await $.session.model()
  await update($, snapshot, s => ({ ...s, model }))
}

export function bar(pct: number, width: number) {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width)
  return { filled, empty: width - filled }
}

export function colorFor(pct: number): 'green' | 'yellow' | 'red' {
  if (pct >= 90) return 'red'
  if (pct >= 75) return 'yellow'
  return 'green'
}

export function countdown(resetsAt: string, nowMs: number) {
  const ms = Date.parse(resetsAt) - nowMs
  if (!(ms > 0)) return 'now'
  const minutes = Math.ceil(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`
  return `${Math.floor(hours / 24)}d${String(hours % 24).padStart(2, '0')}h`
}

// Lines an Edit or Write changed, from its result; anything unexpected counts as nothing.
export function countLines(tool: 'Edit' | 'Write', result: unknown): { added: number; removed: number } {
  try {
    const r = result as any
    let added = 0
    let removed = 0
    if (Array.isArray(r?.structuredPatch)) {
      for (const hunk of r.structuredPatch) {
        for (const line of Array.isArray(hunk?.lines) ? hunk.lines : []) {
          if (typeof line !== 'string') continue
          if (line.startsWith('+')) added++
          else if (line.startsWith('-')) removed++
        }
      }
    }
    if (added + removed === 0 && r?.gitDiff) {
      added = Number(r.gitDiff.additions) || 0
      removed = Number(r.gitDiff.deletions) || 0
    }
    if (added + removed === 0 && tool === 'Write' && r?.type === 'create' && typeof r.content === 'string' && r.content !== '') {
      added = r.content.split('\n').length - (r.content.endsWith('\n') ? 1 : 0)
    }
    return { added, removed }
  } catch {
    return { added: 0, removed: 0 }
  }
}

function label(kind: string) {
  return LABELS[kind] ?? kind
}

function rank(kind: string) {
  const i = ORDER.indexOf(kind)
  return i < 0 ? ORDER.length : i
}
