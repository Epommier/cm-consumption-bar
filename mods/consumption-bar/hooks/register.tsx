// Consumption Bar: what this session is spending, in a card above the prompt.
//   Model and effort, session cost, lines added/removed by Edit/Write, and one bar per
//   rate-limit window (5h, 7d) with its reset countdown and a blue end-of-window forecast.
//   Stacks above context-bar.
import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, Timer } from 'claude-code'

import type { Pace, Persisted, Snapshot, Window } from '../types'

const MIN_WIDTH = 20 // narrower than this, the card is not drawn
const TICK_MS = 60_000
const LABELS: Record<string, string> = { five_hour: '5h', seven_day: '7d' }
// Effort tag color, cold to hot. Unknown or numeric levels fall back to gray.
const EFFORT_COLOR: Record<string, string> = { low: 'gray', medium: 'blue', high: 'yellow', xhigh: '#ff9e64', max: 'red' }
const ORDER = ['five_hour', 'seven_day']
const KEEP_MS = 7 * 24 * 3600 * 1000 // saved effort and lines older than this are pruned
// The forecast blends your usual pace (median peak of past windows) with this window's own,
// which counts for half once a quarter (TRUST) of the window has run.
const WINDOW_MS: Record<string, number> = { five_hour: 5 * 3600_000, seven_day: 7 * 86400_000 }
const TRUST = 0.25
const TYPICAL_DEFAULT = 50 // % per window, until a past window is known
const FINALS_KEPT = 8
const SAME_WINDOW_MS = 10 * 60_000 // two readings of one window's reset differ by less than this

// Held by the host, so the card survives a hot reload of this file.
const snapshot = atom({ plugin: 'consumption-bar', key: 'snapshot' } as const, { model: '', rateLimits: [], linesAdded: 0, linesRemoved: 0, pace: { finals: {}, windows: {} } } as Snapshot)
const tick = atom({ plugin: 'consumption-bar', key: 'tick' } as const, 0)

let timer: Timer | undefined // one countdown timer, even if session.start fires again
let storeKey: string | undefined // `s:<startedAt>`, stable across a resume

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
    if (usage) {
      storeKey = `s:${usage.startedAt}`
      await restore($, storeKey).catch(() => {})
      await learn($).catch(() => {})
    }
    return r
  })

  on('session.measure', async ($, e, next) => {
    const r = await next(e)
    await take($, e.rateLimits, e.cost?.usd).catch(() => {})
    await learn($).catch(() => {})
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
      void persist($).catch(() => {})
    }
    return yield* next(e)
  })

  on('tool.call', async ($, e, next) => {
    const r = await next(e)
    if ((e.tool === 'Edit' || e.tool === 'Write') && !r.deny && !r.isError) {
      const { added, removed } = countLines(e.tool, r.result)
      if (added + removed > 0) {
        await update($, snapshot, s => ({ ...s, linesAdded: s.linesAdded + added, linesRemoved: s.linesRemoved + removed })).catch(() => {})
        void persist($).catch(() => {})
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
    if (snap.rateLimits.length === 0 && snap.costUsd === undefined) return rest // nothing measured yet, e.g. after /clear

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
            const badge = ` ${Math.round(w.percentUsed)}% `.padStart(5)
            const reset = w.resetsAt ? ` resets in ${countdown(w.resetsAt, now).padEnd(5)}  ` : ''
            const fixed = 3 + 2 + badge.length + reset.length
            const f = forecast(w.kind, w.percentUsed, w.resetsAt, now, typicalFor(snap.pace, w.kind))
            const fbadge = f === undefined ? ' --% ' : ` ${Math.round(f)}% `.padStart(5)
            const cells = Math.floor((inner - fixed - 4 - 2 - fbadge.length) / 2)
            // No forecast: an empty placeholder column keeps the bars aligned with the other rows.
            const fb = cells < 10 ? undefined : f === undefined ? { filled: 0, empty: cells } : bar(f, cells)
            const b = bar(w.percentUsed, fb ? cells : Math.max(10, inner - fixed))
            return (
              <Text wrap="truncate-end">
                <Text>{`${label(w.kind).padEnd(2)} `}</Text>
                <Text color={color}>{'█'.repeat(b.filled)}</Text>
                <Text dimColor>{'░'.repeat(b.empty)}</Text>
                <Text>{'  '}</Text>
                <Text bold color="black" backgroundColor={color}>{badge}</Text>
                {reset && <Text dimColor>{reset}</Text>}
                {fb && <Text color={f === undefined ? 'gray' : undefined}>{' 📈 '}</Text>}
                {fb && <Text color="blue">{'█'.repeat(fb.filled)}</Text>}
                {fb && <Text dimColor>{'░'.repeat(fb.empty)}</Text>}
                {fb && <Text>{'  '}</Text>}
                {fb && <Text bold color="black" backgroundColor={f === undefined ? 'gray' : 'blue'}>{fbadge}</Text>}
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

// Effort and lines live only in the atom; the store brings them back after a restart.
async function persist($: EngineInterface) {
  if (!storeKey) return
  const key = storeKey
  const snap = await read($, snapshot)
  const value: Persisted = { effort: snap.effort, linesAdded: snap.linesAdded, linesRemoved: snap.linesRemoved, savedAt: await $.clock.now() }
  await $.store.set(key, value)
}

async function restore($: EngineInterface, key: string) {
  const saved = (await $.store.get(key).catch(() => undefined)) as Partial<Persisted> | undefined
  if (saved && typeof saved === 'object' && typeof saved.linesAdded === 'number' && typeof saved.linesRemoved === 'number') {
    const { effort, linesAdded, linesRemoved } = saved
    await update($, snapshot, s => ({ ...s, ...(typeof effort === 'string' ? { effort } : {}), linesAdded, linesRemoved })).catch(() => {})
  }
  const pace = await $.store.get('pace').catch(() => undefined)
  if (isPace(pace)) await update($, snapshot, s => ({ ...s, pace })).catch(() => {})
  const now = await $.clock.now()
  for (const k of await $.store.keys().catch(() => [] as string[])) {
    if (!k.startsWith('s:') || k === key) continue
    const old = (await $.store.get(k).catch(() => undefined)) as Partial<Persisted> | undefined
    const savedAt = old && typeof old === 'object' ? old.savedAt : undefined
    if (typeof savedAt !== 'number' || now - savedAt > KEEP_MS) await $.store.delete(k).catch(() => {})
  }
}

// Feeds the current windows into the learned pace, saved under `pace` for every session.
async function learn($: EngineInterface) {
  const snap = await read($, snapshot)
  if (snap.rateLimits.length === 0) return
  const pace = trackPace(snap.pace, snap.rateLimits, await $.clock.now())
  await update($, snapshot, s => ({ ...s, pace }))
  void $.store.set('pace', pace).catch(() => {})
}

function isPace(v: any): v is Pace {
  const obj = (o: unknown) => !!o && typeof o === 'object' && !Array.isArray(o)
  return (
    obj(v) &&
    obj(v.finals) &&
    Object.values(v.finals).every(xs => Array.isArray(xs) && xs.every(Number.isFinite)) &&
    obj(v.windows) &&
    Object.values(v.windows).every((w: any) => obj(w) && Number.isFinite(w.resetsAt) && Number.isFinite(w.peak))
  )
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

// Percent used at the window's reset, or undefined when the window is unknown or not running.
export function forecast(kind: string, percentUsed: number, resetsAt: string | undefined, nowMs: number, typical = TYPICAL_DEFAULT): number | undefined {
  const ms = WINDOW_MS[kind]
  const end = resetsAt ? Date.parse(resetsAt) : NaN
  if (!ms || !(end > nowMs)) return undefined
  const remaining = end - nowMs
  const elapsed = Math.max(1, ms - remaining)
  const weight = elapsed / (elapsed + ms * TRUST)
  const rate = (weight * percentUsed) / elapsed + ((1 - weight) * typical) / ms
  return percentUsed + rate * remaining
}

export function median(xs: number[]): number | undefined {
  if (xs.length === 0) return undefined
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function typicalFor(pace: Pace | undefined, kind: string): number {
  return median(pace?.finals[kind] ?? []) ?? TYPICAL_DEFAULT // undefined: a 0.1.3 snapshot kept across a hot reload
}

// Each window's peak so far; when a window rolls over, its peak joins the last few finals.
export function trackPace(pace: Pace | undefined, windows: readonly Window[], nowMs: number): Pace {
  const finals = { ...pace?.finals }
  const current = { ...pace?.windows }
  for (const w of windows) {
    const resetsAt = w.resetsAt ? Date.parse(w.resetsAt) : NaN
    if (!WINDOW_MS[w.kind] || !Number.isFinite(resetsAt)) continue
    const prev = current[w.kind]
    if (!prev || Math.abs(resetsAt - prev.resetsAt) > SAME_WINDOW_MS) {
      if (prev) finals[w.kind] = [...(finals[w.kind] ?? []), prev.peak].slice(-FINALS_KEPT)
      current[w.kind] = { resetsAt, peak: w.percentUsed }
    } else current[w.kind] = { ...prev, peak: Math.max(prev.peak, w.percentUsed) }
  }
  return { finals, windows: current }
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
