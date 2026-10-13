import { describe, expect, mock, test } from 'claude-code/testing'

import { bar, colorFor, countdown, countLines } from '../hooks/register'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const at = (ms: number) => new Date(NOW + ms).toISOString()

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// Stands for the engine beneath the mod.
function engine(on: any, first: { rateLimits: Limit[]; cost?: { usd: number } }, toolResult: unknown = {}, store: Record<string, unknown> = {}) {
  const clock = mock.clock(on, { now: NOW })
  on('session.start', (_$: any, e: any) => ({ sessionId: 's', cwd: e.cwd }))
  on('session.usage', () => ({ value: { startedAt: NOW, context: { window: 200_000 }, ...first } }))
  on('session.model', () => ({ value: 'Fable 5.1' }))
  on('turn.step', async function* (_$: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  on('tool.call', () => ({ result: toolResult, text: 'ok' }))
  on('ui.render', ($: any, e: any) => $.ui.resolve(e).Text({ children: 'engine band' }))
  on('store.get', (_$: any, e: any) => ({ value: store[e.key] }))
  on('store.set', (_$: any, e: any) => ((store[e.key] = JSON.parse(JSON.stringify(e.value))), { value: undefined }))
  on('store.delete', (_$: any, e: any) => (delete store[e.key], { value: undefined }))
  on('store.keys', () => ({ value: Object.keys(store) }))
  return { clock, store }
}

const DAY = 24 * 60 * 60_000
const EDIT = { filePath: '/work/a.ts', structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: ['+a', '+b', '+c', '-d'] }] }
const settle = () => new Promise(done => (globalThis as any).setTimeout(done, 20)) // persist runs in the background

const band = (bodyColumns = 70, hasSurvey = false) => ({
  plugin: 'consumption-bar',
  surface: 'terminal',
  component: 'AbovePrompt',
  props: { hasSurvey, isWorking: false, maxRows: 10, bodyColumns },
})

const start = ($: any) => $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })

async function step($: any, effort?: string, agentId?: string) {
  const stream = $.turn.step({ turnId: 't', index: 0, model: 'm', messageCount: 1, ...(effort ? { effort } : {}), ...(agentId ? { agentId } : {}) })
  for await (const _ of stream) {
    // drain
  }
  await stream.result
}

// The leaf Texts in the band, in order, as drawn.
async function texts(ui: any): Promise<string[]> {
  const all: any[] = (await ui.findAll({ type: 'Text' })) ?? []
  return all.filter(t => !(t.children ?? []).some((c: any) => c?.type === 'Text')).map(t => t.text)
}

const WINDOWS = [
  { kind: 'seven_day', percentUsed: 18, resetsAt: at(3 * 24 * HOUR + 4 * HOUR) },
  { kind: 'five_hour', percentUsed: 42, resetsAt: at(2 * HOUR + 10 * MIN) },
]

describe('consumption-bar', () => {
  test('helpers', () => {
    expect(bar(42, 20)).toEqual({ filled: 8, empty: 12 })
    expect(bar(150, 10)).toEqual({ filled: 10, empty: 0 })
    expect(colorFor(74.9)).toBe('green')
    expect(colorFor(75)).toBe('yellow')
    expect(colorFor(90)).toBe('red')
    expect(countdown(at(2 * HOUR + 10 * MIN), NOW)).toBe('2h10m')
    expect(countdown(at(3 * 24 * HOUR + 4 * HOUR), NOW)).toBe('3d04h')
    expect(countdown(at(25 * MIN), NOW)).toBe('25m')
    expect(countdown(at(-MIN), NOW)).toBe('now')

    const patch = { structuredPatch: [{ oldStart: 1, oldLines: 2, newStart: 1, newLines: 4, lines: [' a', '+b', '+c', '-d', '+e'] }] }
    expect(countLines('Edit', patch)).toEqual({ added: 3, removed: 1 })
    expect(countLines('Edit', { structuredPatch: [], gitDiff: { additions: 7, deletions: 2 } })).toEqual({ added: 7, removed: 2 })
    expect(countLines('Write', { type: 'create', content: 'x\ny\nz\n', structuredPatch: [] })).toEqual({ added: 3, removed: 0 })
    expect(countLines('Edit', { type: 'create', content: 'x\ny\n', structuredPatch: [] })).toEqual({ added: 0, removed: 0 })
    for (const junk of [null, undefined, 42, 'x', { structuredPatch: 'no' }, { structuredPatch: [null, { lines: 1 }] }, { gitDiff: { additions: 'x' } }]) {
      expect(countLines('Edit', junk)).toEqual({ added: 0, removed: 0 })
    }
    expect(countLines('Edit', { structuredPatch: [null, { lines: [1, '+x'] }] })).toEqual({ added: 1, removed: 0 }) // bad entries skipped
  })

  test('header: model, effort, cost, and lines from an Edit', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 1.234 } }, {
      filePath: '/work/a.ts',
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 3, lines: ['+a', '+b', '+c', '-d'] }],
    })
    await start($)
    await step($, 'high')
    await step($, 'low', 'sub-1') // a subagent's effort is not the session's
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'd', new_string: 'a\nb\nc' } as any)

    const ui = await $.ui.mount(band() as any)
    const t = await texts(ui)
    expect(t).toContain('Fable 5.1')
    expect(t).toContain(' [high]')
    expect(t).toContain('$1.23')
    expect(t).toContain('🧠 ')
    expect(t).toContain('💰 ')
    expect((await ui.find({ type: 'Text', text: /^ \[high\]$/ }))?.props?.color).toBe('yellow')
    expect((await ui.find({ type: 'Text', text: /^\$1\.23$/ }))?.props?.color).toBe('green')
    expect(t.some(x => x.startsWith('─'))).toBe(false) // no windows, no separator
    expect(t.join('')).toContain(' · ✏️ +3/-1')
    expect(t).not.toContain('5h ')
    expect(t).not.toContain('7d ')
    expect(t).toContain('engine band') // stacked, not replaced
    await ui.unmount()
  })

  test('one row per window, 5h first, with badge and countdown', async ($, on) => {
    engine(on, { rateLimits: WINDOWS, cost: { usd: 0 } })
    await start($)
    const ui = await $.ui.mount(band() as any)
    const t = await texts(ui)
    expect(t).toContain(' 42% ')
    expect(t).toContain(' 18% ')
    expect(t).toContain('─'.repeat(66))
    expect(t).toContain('   resets in 2h10m')
    expect(t).toContain('   resets in 3d04h')
    expect(t.indexOf('5h ')).toBeLessThan(t.indexOf('7d '))
    expect((await ui.find({ type: 'Text', text: /^ 42% $/ }))?.props?.backgroundColor).toBe('green')
    // inner 66 - (2 + 1 + 2 + 5 + 18) = 38 cells of bar
    const row = t.slice(t.indexOf('5h '), t.indexOf('5h ') + 3).join('')
    expect(row).toBe('5h ' + '█'.repeat(16) + '░'.repeat(22))
    expect(t.indexOf('engine band')).toBeGreaterThan(t.indexOf('7d ')) // card above the band beneath
    await ui.unmount()
  })

  test('the countdown ticks and session.measure updates the windows', async ($, on) => {
    const { clock } = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: at(46 * MIN) }] })
    on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
    await start($)
    const ui = await $.ui.mount(band() as any)
    expect(await texts(ui)).toContain('   resets in 46m')
    await clock.advance(MIN)
    expect(await texts(ui)).toContain('   resets in 45m')

    await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: at(46 * MIN) }], cost: { usd: 2 }, changed: ['rateLimits'] } as any)
    expect((await ui.find({ type: 'Text', text: /^ 91% $/ }))?.props?.backgroundColor).toBe('red')
    expect(await texts(ui)).toContain('$2.00')
    await ui.unmount()
  })

  test('yields to a survey', async ($, on) => {
    engine(on, { rateLimits: WINDOWS, cost: { usd: 1 } })
    await start($)
    const ui = await $.ui.mount(band(70, true) as any)
    expect(await texts(ui)).toEqual(['engine band'])
    await ui.unmount()
  })

  test('too narrow: only the band beneath', async ($, on) => {
    engine(on, { rateLimits: WINDOWS, cost: { usd: 1 } })
    await start($)
    const ui = await $.ui.mount(band(20) as any)
    expect(await texts(ui)).toEqual(['engine band'])
    await ui.unmount()
  })

  test('persist: effort and lines saved under s:<startedAt>', async ($, on) => {
    const { store } = engine(on, { rateLimits: [] }, EDIT)
    await start($)
    await step($, 'high')
    await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'd', new_string: 'a\nb\nc' } as any)
    await settle()
    expect(store[`s:${NOW}`]).toEqual({ effort: 'high', linesAdded: 3, linesRemoved: 1, savedAt: NOW })
  })

  test('restore: a resumed session gets its effort and lines back', async ($, on) => {
    engine(on, { rateLimits: [] }, {}, { [`s:${NOW}`]: { effort: 'high', linesAdded: 3, linesRemoved: 1, savedAt: NOW } })
    await start($)
    const ui = await $.ui.mount(band() as any)
    const t = await texts(ui)
    expect(t).toContain(' [high]')
    expect(t.join('')).toContain(' · ✏️ +3/-1')
    await ui.unmount()
  })

  test('prune: other sessions saved over 7 days ago are deleted', async ($, on) => {
    const { store } = engine(on, { rateLimits: [] }, {}, {
      's:1': { savedAt: NOW - 8 * DAY, linesAdded: 0, linesRemoved: 0 },
      's:2': { savedAt: NOW - DAY, linesAdded: 0, linesRemoved: 0 },
      's:3': 'no savedAt',
      other: 'kept',
    })
    await start($)
    expect(Object.keys(store).sort()).toEqual(['other', 's:2'])
  })

  test('malformed saved value is ignored', async ($, on) => {
    engine(on, { rateLimits: [] }, {}, { [`s:${NOW}`]: 'garbage' })
    await start($)
    const ui = await $.ui.mount(band() as any)
    const t = await texts(ui)
    expect(t).toContain('Fable 5.1')
    expect(t.some(x => x.startsWith(' ['))).toBe(false)
    expect(t.join('')).not.toContain('✏️')
    await ui.unmount()
  })
})
