import { describe, expect, mock, test } from 'claude-code/testing'

import { bar, colorFor, countdown, countLines, forecast, median, trackPace, typicalFor } from '../hooks/register'

const NOW = Date.parse('2026-10-03T12:00:00Z')
const MIN = 60_000
const HOUR = 60 * MIN
const at = (ms: number) => new Date(NOW + ms).toISOString()

type Limit = { kind: string; percentUsed: number; resetsAt?: string }

// Stands for the engine beneath the mod.
// `stubs` replaces an engine stub by event name (the harness refuses a second on() for one event).
function engine(on: any, first: { rateLimits: Limit[]; cost?: { usd: number } }, toolResult: unknown = {}, store: Record<string, unknown> = {}, stubs: Record<string, any> = {}) {
  const real = on
  on = (name: string, fn: any) => real(name, stubs[name] ?? fn)
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

  test('forecast and pace helpers', () => {
    const near = (x: number | undefined, want: number) => expect(Math.abs((x ?? NaN) - want) < 0.05).toBe(true) // no toBeCloseTo here
    near(forecast('five_hour', 42, at(2 * HOUR + 10 * MIN), NOW, 50), 70.92)
    near(forecast('five_hour', 4, at(5 * HOUR - 10 * MIN), NOW, 50), 60.29)
    near(forecast('seven_day', 18, at(3 * 24 * HOUR + 4 * HOUR), NOW), 35.3)
    near(forecast('five_hour', 42, at(2 * HOUR + 10 * MIN), NOW, 20), 66.94)
    expect(forecast('five_hour', 42, undefined, NOW)).toBeUndefined()
    expect(forecast('five_hour', 42, at(-MIN), NOW)).toBeUndefined()
    expect(forecast('seven_day_opus', 42, at(HOUR), NOW)).toBeUndefined()
    expect(median([])).toBeUndefined()
    expect(median([30, 10, 20])).toBe(20)
    expect(median([10, 20, 30, 40])).toBe(25)
    expect(typicalFor({ finals: {}, windows: {} }, 'five_hour')).toBe(50)
    expect(typicalFor(undefined, 'five_hour')).toBe(50) // 0.1.3 snapshot without pace, kept across a hot reload

    const r = at(2 * HOUR)
    const first = trackPace({ finals: {}, windows: {} }, [{ kind: 'five_hour', percentUsed: 42, resetsAt: r }], NOW)
    expect(first).toEqual({ finals: {}, windows: { five_hour: { resetsAt: Date.parse(r), peak: 42 } } })
    expect(trackPace(undefined, [{ kind: 'five_hour', percentUsed: 42, resetsAt: r }], NOW)).toEqual(first) // 0.1.3 snapshot without pace
    const same = trackPace(first, [{ kind: 'five_hour', percentUsed: 30, resetsAt: at(2 * HOUR + 5 * MIN) }], NOW)
    expect(same.windows.five_hour.peak).toBe(42)
    const full = { finals: { five_hour: [1, 2, 3, 4, 5, 6, 7, 8] }, windows: first.windows }
    const next = trackPace(full, [{ kind: 'five_hour', percentUsed: 3, resetsAt: at(7 * HOUR) }], NOW)
    expect(next.finals.five_hour).toEqual([2, 3, 4, 5, 6, 7, 8, 42])
    expect(next.windows.five_hour).toEqual({ resetsAt: Date.parse(at(7 * HOUR)), peak: 3 })
    expect(trackPace(first, [{ kind: 'other', percentUsed: 9, resetsAt: r }], NOW)).toEqual(first)
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
    expect(t).toContain(' resets in 2h10m  ')
    expect(t).toContain(' resets in 3d04h  ')
    expect(t.indexOf('5h ')).toBeLessThan(t.indexOf('7d '))
    expect((await ui.find({ type: 'Text', text: /^ 42% $/ }))?.props?.backgroundColor).toBe('green')
    // inner 66 - (3 + 2 + 5 + 18 + 4 + 2 + 5) = 27, so 13 cells per bar
    const row = t.slice(t.indexOf('5h '), t.indexOf('5h ') + 3).join('')
    expect(row).toBe('5h ' + '█'.repeat(5) + '░'.repeat(8))
    const i = t.indexOf(' resets in 2h10m  ')
    expect(t.slice(i + 1, i + 6)).toEqual([' 📈 ', '█'.repeat(9), '░'.repeat(4), '  ', ' 71% '])
    expect(t.indexOf('engine band')).toBeGreaterThan(t.indexOf('7d ')) // card above the band beneath
    await ui.unmount()
  })

  test('the countdown ticks and session.measure updates the windows', async ($, on) => {
    const { clock } = engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 42, resetsAt: at(46 * MIN) }] })
    on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
    await start($)
    const ui = await $.ui.mount(band() as any)
    expect(await texts(ui)).toContain(' resets in 46m    ')
    await clock.advance(MIN)
    expect(await texts(ui)).toContain(' resets in 45m    ')

    await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 91, resetsAt: at(46 * MIN) }], cost: { usd: 2 }, changed: ['rateLimits'] } as any)
    expect((await ui.find({ type: 'Text', text: /^ 91% $/ }))?.props?.backgroundColor).toBe('red')
    expect(await texts(ui)).toContain('$2.00')
    await ui.unmount()
  })

  test('forecast: blue bar and badge after the countdown', async ($, on) => {
    engine(on, { rateLimits: WINDOWS, cost: { usd: 0 } })
    await start($)
    const ui = await $.ui.mount(band() as any)
    const t = await texts(ui)
    const all: any[] = (await ui.findAll({ type: 'Text' })) ?? []
    expect(all.filter(x => x.props?.color === 'blue').map(x => x.text)).toEqual(['█'.repeat(9), '█'.repeat(5)])
    expect((await ui.find({ type: 'Text', text: /^ 71% $/ }))?.props?.backgroundColor).toBe('blue')
    expect((await ui.find({ type: 'Text', text: /^ 35% $/ }))?.props?.backgroundColor).toBe('blue')
    expect(t.indexOf(' 71% ')).toBeGreaterThan(t.indexOf(' resets in 2h10m  '))
    expect(t.indexOf(' 35% ')).toBeGreaterThan(t.indexOf(' resets in 3d04h  '))
    const i = t.indexOf(' resets in 3d04h  ')
    expect(t.slice(i + 1, i + 6)).toEqual([' 📈 ', '█'.repeat(5), '░'.repeat(8), '  ', ' 35% '])
    await ui.unmount()
  })

  test('forecast: placeholder column when the window has no forecast', async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 22, resetsAt: at(-MIN) }, WINDOWS[0]], cost: { usd: 0 } })
    await start($)
    const ui = await $.ui.mount(band() as any)
    const t = await texts(ui)
    expect(t).toContain(' resets in now    ')
    const i = t.indexOf('5h ')
    // the empty blue bar may or may not be listed as a leaf
    expect(t.slice(i + 1, i + 11).filter(x => x !== '')).toEqual(['███', '░'.repeat(10), '  ', ' 22% ', ' resets in now    ', ' 📈 ', '░'.repeat(13), '  ', ' --% '])
    const all: any[] = (await ui.findAll({ type: 'Text' })) ?? []
    expect(all.find(x => x.text === ' --% ')?.props?.backgroundColor).toBe('gray')
    expect(all.find(x => x.text === ' 📈 ')?.props?.color).toBe('gray')
    expect(t).toContain(' 35% ')
    expect(all.some(x => x.props?.color === 'blue' && x.text === '█'.repeat(5))).toBe(true)
    await ui.unmount()
  })

  test('rows with one- and two-digit percents share the same columns', async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 5, resetsAt: at(-MIN) }, WINDOWS[0]], cost: { usd: 0 } })
    await start($)
    const ui = await $.ui.mount(band(70) as any)
    const t = await texts(ui)
    // column at which the badge, the reset text, the forecast bar and the last badge start
    const columns = (row: string[]) => {
      const col = (i: number) => row.slice(0, i).join('').length
      const badge = row.findIndex(x => /^ +\d+% $/.test(x))
      const reset = row.findIndex(x => x.startsWith(' resets in'))
      return [col(badge), col(reset), col(reset + 2), col(row.length - 1)]
    }
    const five = t.slice(t.indexOf('5h '), t.indexOf('7d ')).filter(x => x !== '')
    const seven = t.slice(t.indexOf('7d '), t.indexOf('engine band')).filter(x => x !== '')
    expect(five).toContain('  5% ')
    expect(columns(five)).toEqual(columns(seven))
    await ui.unmount()
  })

  test('forecast: hidden when the row is too narrow', async ($, on) => {
    engine(on, { rateLimits: WINDOWS, cost: { usd: 0 } })
    await start($)
    const ui = await $.ui.mount(band(50) as any)
    const t = await texts(ui)
    const all: any[] = (await ui.findAll({ type: 'Text' })) ?? []
    expect(all.some(x => x.props?.color === 'blue' || x.props?.backgroundColor === 'blue')).toBe(false)
    // inner 46 - (3 + 2 + 5 + 18) = 18 cells of bar, as in 0.1.3
    const row = t.slice(t.indexOf('5h '), t.indexOf('5h ') + 3).join('')
    expect(row).toBe('5h ' + '█'.repeat(8) + '░'.repeat(10))
    expect(t[t.indexOf(' resets in 2h10m  ') + 1]).not.toBe(' 📈 ')
    await ui.unmount()
  })

  test('pace: peaks saved under pace, a rolled-over window becomes a final', async ($, on) => {
    const { store } = engine(on, { rateLimits: WINDOWS })
    on('session.measure', (_$: any, e: any) => ({ changed: e.changed }))
    await start($)
    await settle()
    expect((store.pace as any).windows.five_hour).toEqual({ resetsAt: Date.parse(at(2 * HOUR + 10 * MIN)), peak: 42 })
    await $.session.measure({ context: { window: 200_000 }, rateLimits: [{ kind: 'five_hour', percentUsed: 1, resetsAt: at(7 * HOUR + 10 * MIN) }], changed: ['rateLimits'] } as any)
    await settle()
    expect((store.pace as any).finals.five_hour).toEqual([42])
    expect((store.pace as any).windows.five_hour.peak).toBe(1)
  })

  test('pace: restored from the store lowers the forecast', async ($, on) => {
    engine(on, { rateLimits: WINDOWS }, {}, { pace: { finals: { five_hour: [20, 20] }, windows: {} } })
    await start($)
    const ui = await $.ui.mount(band() as any)
    const t = await texts(ui)
    expect(t).toContain(' 67% ') // 71% with the default pace of 50
    expect(t).not.toContain(' 71% ')
    await ui.unmount()
  })

  test('pace: a malformed value is ignored', async ($, on) => {
    engine(on, { rateLimits: WINDOWS }, {}, { pace: { finals: 'x' } })
    await start($)
    const ui = await $.ui.mount(band() as any)
    expect((await ui.find({ type: 'Text', text: /^ 71% $/ }))?.props?.backgroundColor).toBe('blue')
    await ui.unmount()
  })

  test('yields to a survey', async ($, on) => {
    engine(on, { rateLimits: WINDOWS, cost: { usd: 1 } })
    await start($)
    const ui = await $.ui.mount(band(70, true) as any)
    expect(await texts(ui)).toEqual(['engine band'])
    await ui.unmount()
  })

  test('hides when no consumption data', async ($, on) => {
    engine(on, { rateLimits: [] })
    await start($)
    const ui = await $.ui.mount(band() as any)
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
    engine(on, { rateLimits: [], cost: { usd: 1 } }, {}, { [`s:${NOW}`]: { effort: 'high', linesAdded: 3, linesRemoved: 1, savedAt: NOW } })
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
    engine(on, { rateLimits: [], cost: { usd: 1 } }, {}, { [`s:${NOW}`]: 'garbage' })
    await start($)
    const ui = await $.ui.mount(band() as any)
    const t = await texts(ui)
    expect(t).toContain('Fable 5.1')
    expect(t.some(x => x.startsWith(' ['))).toBe(false)
    expect(t.join('')).not.toContain('✏️')
    await ui.unmount()
  })

  test('turn.start refreshes the model', async ($, on) => {
    let model = 'A'
    engine(on, { rateLimits: [], cost: { usd: 1 } }, {}, {}, { 'session.model': () => ({ value: model }) })
    on('turn.start', (_$: any, e: any) => ({ turnId: e.turnId }))
    await start($)
    const ui = await $.ui.mount(band() as any)
    expect(await texts(ui)).toContain('A')
    model = 'B'
    await $.turn.start({ turnId: 't' } as any)
    expect(await texts(ui)).toContain('B')
    await ui.unmount()
  })

  // The successful counterpart is the header test, where the same Edit shows +3/-1.
  test('tool.call ignores denied and error results', async ($, on) => {
    let answer: any
    engine(on, { rateLimits: [], cost: { usd: 1 } }, {}, {}, { 'tool.call': () => answer })
    await start($)
    // A deny carries no result (the harness refuses one beside it); isError keeps the EDIT result.
    for (const next of [{ deny: 'no' }, { result: EDIT, text: 'failed', isError: true }]) {
      answer = next
      await $.tool.call({ tool: 'Edit', file_path: '/work/a.ts', old_string: 'd', new_string: 'a\nb\nc' } as any)
      const ui = await $.ui.mount(band() as any)
      const t = await texts(ui)
      expect(t).toContain('Fable 5.1')
      expect(t.join('')).not.toContain('✏️')
      await ui.unmount()
    }
  })

  test('session.usage failure hides the card', async ($, on) => {
    engine(on, { rateLimits: WINDOWS, cost: { usd: 1 } }, {}, {}, { 'session.usage': () => Promise.reject(new Error('down')) })
    await start($)
    const ui = await $.ui.mount(band() as any)
    expect(await texts(ui)).toEqual(['engine band'])
    await ui.unmount()
  })

  test('yellow badge at 75%', async ($, on) => {
    engine(on, { rateLimits: [{ kind: 'five_hour', percentUsed: 75, resetsAt: at(46 * MIN) }] })
    await start($)
    const ui = await $.ui.mount(band() as any)
    expect((await ui.find({ type: 'Text', text: /^ 75% $/ }))?.props?.backgroundColor).toBe('yellow')
    await ui.unmount()
  })

  test('MIN_WIDTH boundary', async ($, on) => {
    engine(on, { rateLimits: WINDOWS, cost: { usd: 1 } })
    await start($)
    const narrow = await $.ui.mount(band(23) as any) // inner 19 < 20
    expect(await texts(narrow)).toEqual(['engine band'])
    await narrow.unmount()
    const wide = await $.ui.mount(band(24) as any) // inner 20
    expect(await texts(wide)).toContain('Fable 5.1')
    await wide.unmount()
  })

  test('effort colours', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 1 } })
    await start($)
    await step($, 'xhigh')
    const ui = await $.ui.mount(band() as any)
    expect((await ui.find({ type: 'Text', text: /^ \[xhigh\]$/ }))?.props?.color).toBe('#ff9e64')
    await ui.unmount()
  })

  test('/effort updates the badge at once', async ($, on) => {
    engine(on, { rateLimits: [], cost: { usd: 1 } })
    on('command.run', (_$: any, _e: any) => ({ text: '' }))
    await start($)
    await step($, 'high')
    const ui = await $.ui.mount(band() as any)
    expect(await texts(ui)).toContain(' [high]')
    await $.command.run({ command: 'effort', args: 'low' } as any)
    const t = await texts(ui) // same mount, no new turn
    expect(t).toContain(' [low]')
    expect(t).not.toContain(' [high]')
    await $.command.run({ command: 'effort', args: 'bogus' } as any)
    expect(await texts(ui)).toContain(' [low]')
    await ui.unmount()
  })
})
