import type { ConfigRow } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

// Two-frame sprites, 7 columns by 4 rows, in the shape an assets/sprites file
// holds: a cell is '.' (empty) or glyph + fg letter + bg letter.
function frame(cells: string[]): string {
  return cells.join('')
}

const BLANK_ROW = ['.', '.', '.', '.', '.', '.', '.']
const BODY_ROW = ['.', '▀ab', '█a.', '█a.', '▄b.', '.', '.']

function sprite(style: string) {
  return {
    style,
    cols: 7,
    rows: 4,
    fps: 12,
    palette: ['#e8c890', '#c03030'],
    alphabet: 'ab',
    frames: [
      frame([...BLANK_ROW, ...BODY_ROW, ...BODY_ROW, ...BLANK_ROW]),
      frame([...BODY_ROW, ...BODY_ROW, ...BLANK_ROW, ...BLANK_ROW]),
    ],
  }
}

// The sprite file a path names, assets/sprites/<style>-<height>.json.
function spriteFile(path: string): string {
  const style = /\/assets\/sprites\/([a-z]+)-\d+\.json$/.exec(path)?.[1]
  if (style === undefined) {
    throw new Error(`not a sprite file: ${path}`)
  }

  return JSON.stringify(sprite(style))
}

const TEXT = [
  'Short line',
  '- a',
  '- b',
  '- c',
  '- d',
  '- e',
  '',
  'This is a long line of words that runs far to the right of the terminal window',
].join('\n')

// Row 0 is the blank row above the message, then 8 rows as the text lays out.
const LAID_OUT = 9

const VIEW = { columns: 100, rows: 40, isFullscreen: true }

// The props of her box, which sits in the row's flow after the engine's
// drawing: its top margin pulls it up from the end of the row's rows, its
// bottom margin gives the rows back.
type Placed = { marginTop: number; marginBottom: number; marginLeft: number; height: number; position?: string }

async function placedOf(ui: { find(query: { key: string }): Promise<unknown> }): Promise<Placed | undefined> {
  const node = (await ui.find({ key: 'spot' })) as { props?: Placed } | undefined

  return node?.props
}

// Her left column: her box spans her whole walk, room drawn either side of her.
async function leftOf(ui: { find(query: { key: string }): Promise<unknown> }): Promise<number | undefined> {
  const placed = await placedOf(ui)
  const before = (await ui.find({ key: 'before' })) as { props?: { width?: number } } | undefined

  return placed === undefined ? undefined : placed.marginLeft + (before?.props?.width ?? 0)
}

// Her top row in the row's own rows, the row laying out `of` of them.
async function topOf(ui: { find(query: { key: string }): Promise<unknown> }, of: number): Promise<number | undefined> {
  const placed = await placedOf(ui)

  return placed === undefined ? undefined : placed.marginTop + of
}

test('a message whose rows fit hosts the dancer, and loses her off screen', async ($, on) => {
  on('fs.read', (_, e) => {
    expect(e.path).toEndWith('/assets/sprites/sextant-4.json')

    return { value: spriteFile(e.path) }
  })
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-1',
    viewport: VIEW,
    props: { text: TEXT, isFirstOfReply: true },
  })
  // Not laid out yet: no rows to check the guess against.
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')

  await ui.redraw({ text: TEXT, isFirstOfReply: true, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  const box = JSON.stringify(await ui.drawn())
  expect(box).toContain('Client')
  // In the flow, not absolute (an absolute box whose top is above the screen
  // is pinned to its top row), and taking no rows of the message's own.
  expect(box).not.toContain('"position":"absolute"')
  const placed = await placedOf(ui)
  expect(placed).toBeDefined()
  expect((placed?.marginTop ?? 1) + (placed?.height ?? 0) + (placed?.marginBottom ?? 0)).toBe(0)
  const top = await topOf(ui, LAID_OUT)
  expect(top).toBeGreaterThanOrEqual(0)
  expect((top ?? 0) + (placed?.height ?? 0)).toBeLessThanOrEqual(LAID_OUT)

  const dancer = JSON.stringify(await ui.drawn({ in: 'dancer' }))
  expect(dancer).toContain('▀')
  expect(dancer).toContain('#c03030')

  await ui.redraw({ text: TEXT, isFirstOfReply: true, onScreen: null })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')
  await ui.unmount()
})

test('a guess that does not match the rows laid out hosts nobody', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-3',
    viewport: VIEW,
    props: { text: TEXT, isFirstOfReply: true },
  })
  await ui.redraw({ text: TEXT, isFirstOfReply: true, onScreen: { first: 0, last: 14, of: 15 } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')
  await ui.unmount()
})

test('a tall dancer, too many characters for one handing, gets a window of her dance', async ($, on) => {
  // 418 frames of 3,000 characters each: 60,000 characters hold 20, and a
  // window is never under 24.
  const tall = sprite('sextant')
  const frames = Array.from({ length: 418 }, (_, i) => (tall.frames[i % 2] ?? '') + '.'.repeat(3000))
  on('fs.read', () => ({ value: JSON.stringify({ ...tall, frames }) }))
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-tall',
    viewport: VIEW,
    props: { text: TEXT, isFirstOfReply: true },
  })
  await ui.redraw({ text: TEXT, isFirstOfReply: true, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  const handed = (await ui.find({ key: 'dancer' }))?.props as { props?: { frames: string[]; total: number } }
  expect(handed.props?.frames).toHaveLength(24)
  expect(handed.props?.total).toBe(418)
  await ui.unmount()
})

test('the main screen draws as the engine does', async $ => {
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-2',
    viewport: { columns: 100, rows: 40, isFullscreen: false },
    props: { text: TEXT, isFirstOfReply: true },
  })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')
  await ui.unmount()
})

test('in kitty she is a real picture, swapped frame by frame', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'KITTY_WINDOW_ID' ? '1' : undefined }))
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-4',
    viewport: VIEW,
    props: { text: TEXT, isFirstOfReply: true },
  })
  await ui.redraw({ text: TEXT, isFirstOfReply: true, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  const image = await ui.find({ type: 'Image' })
  expect(JSON.stringify(image)).toMatch(/assets\/png\/f\d{4}\.png/)
  expect(JSON.stringify(image)).toContain('"columns":7')
  expect(await ui.find({ type: 'Client' })).toBeUndefined()
  await ui.unmount()
})

// A short line and ten list items: room for a box 7 rows tall with a row
// under it, but no words under her feet.
const SHORT = ['Short line', ...'abcdefghij'.split('').map(c => `- ${c}`)].join('\n')
const SHORT_ROWS = 12

test(
  'at height 7 in kitty she floats on her stand at the right, then walks by quarter columns',
  { options: { size: '7' } },
  async ($, on) => {
    const clock = mock.clock(on)
    on('env.get', (_, e) => ({ value: e.name === 'KITTY_WINDOW_ID' ? '1' : undefined }))
    const swaps: string[] = []
    on('ui.blit', (_, e) => {
      swaps.push(JSON.stringify(e))

      return { value: {} }
    })
    const props = { text: SHORT, isFirstOfReply: true }
    const ui = await $.ui.mount({
      plugin: 'kami-dance',
      surface: 'terminal',
      component: 'AssistantMessage',
      requestId: 'msg-6',
      viewport: VIEW,
      props,
    })
    await ui.redraw({ ...props, onScreen: { first: 0, last: SHORT_ROWS - 1, of: SHORT_ROWS } })
    const leftNow = async () => String(await leftOf(ui))

    // 100 columns, 2 kept clear at the edge: her 13-column box starts at the right end.
    expect(await leftNow()).toBe('85')
    const dancer = JSON.stringify(await ui.find({ key: 'dancer' }))
    expect(dancer).toMatch(/assets\/walk-7\/f\d{4}-0\.png/)
    expect(dancer).toContain('"columns":13')
    expect(JSON.stringify(await ui.find({ key: 'stand' }))).toContain('assets/walk-7/stand-0.png')

    // She dances in place for 2 to 7 s, then walks left a quarter column a tick.
    const lefts: number[] = []
    for (let s = 0; s < 12; s++) {
      await clock.advance(1000)
      lefts.push(Number(await leftNow()))
    }
    expect(Math.min(...lefts)).toBeLessThan(85)
    expect(Math.min(...lefts)).toBeGreaterThanOrEqual(53)
    expect(swaps.some(swap => /walk-7\/f\d{4}-[123]\.png/.test(swap))).toBe(true)
    await ui.unmount()
  },
)

test(
  'a style an earlier version stored in /config is passed over: she is drawn in sextants',
  { options: { size: '8', style: 'braille' } },
  async ($, on) => {
    const reads: string[] = []
    on('fs.read', (_, e) => {
      reads.push(e.path)

      return { value: spriteFile(e.path) }
    })
    const props = { text: TEXT, isFirstOfReply: true }
    const ui = await $.ui.mount({
      plugin: 'kami-dance',
      surface: 'terminal',
      component: 'AssistantMessage',
      requestId: 'msg-old-style',
      viewport: VIEW,
      props,
    })
    await ui.redraw({ ...props, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
    expect(reads).toEqual([expect.stringMatching(/\/assets\/sprites\/sextant-8\.json$/)])
    await ui.unmount()
  },
)

// Two gaps with a wall of code between them: rows 1-5 and 14-18 have room,
// rows 7-12 are full width. Row 0 is the blank row above the message.
const TWO_GAPS = [
  '- a',
  '- b',
  '- c',
  '- d',
  '- e',
  '',
  '```',
  ...Array.from({ length: 6 }, () => 'x'.repeat(90)),
  '```',
  '',
  '- f',
  '- g',
  '- h',
  '- i',
  '- j',
].join('\n')

test('a long message keeps a spot in each gap, and she moves to the one in view', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const props = { text: TWO_GAPS, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-5',
    viewport: VIEW,
    props,
  })
  // Only the lower gap on screen: she stands in it.
  await ui.redraw({ ...props, onScreen: { first: 12, last: 18, of: 19 } })
  expect(await topOf(ui, 19)).toBe(13)

  // Scrolled up until the lower gap is gone: she moves to the upper one, on
  // her stand resting on the wall of code (row 7), a row higher than she
  // would stand on the code itself.
  await ui.redraw({ ...props, onScreen: { first: 0, last: 8, of: 19 } })
  expect(await topOf(ui, 19)).toBe(2)
  expect(JSON.stringify(await ui.drawn())).toContain('▔')

  // Only the wall of code on screen: no spot in view, so nobody.
  await ui.redraw({ ...props, onScreen: { first: 8, last: 11, of: 19 } })
  expect(await topOf(ui, 19)).toBeUndefined()
  await ui.unmount()
})

// A table draws as a box with a rule under every row: 3 rows take 7, each
// column its widest cell and a space either side. Rows 3-9 are the table.
const TABLE = [
  'Results:',
  '',
  '| setup | cpu |',
  '| --- | --- |',
  '| one | 1% |',
  '| two | 54% |',
  '',
  '- a',
  '- b',
  '- c',
  '- d',
  '- e',
].join('\n')
const TABLE_ROWS = 16

test('a message with a table that fits still hosts her', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const props = { text: TABLE, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-table',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: TABLE_ROWS - 1, of: TABLE_ROWS } })
  expect(JSON.stringify(await ui.drawn())).toContain('Client')
  await ui.unmount()
})

test('a table too wide for the screen, which the terminal wraps, hosts nobody', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const wide = TABLE.replace('| one |', `| ${'word '.repeat(24)}|`)
  const props = { text: wide, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-wide-table',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: TABLE_ROWS - 1, of: TABLE_ROWS } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')
  await ui.unmount()
})

// An edit of eight lines, three lines of context either side: its summary
// line and 22 rows, the eight removed in red, the eight added in green.
const PATCH = [
  {
    oldStart: 7,
    oldLines: 14,
    newStart: 7,
    newLines: 14,
    lines: [
      ' const value7 = 7',
      ' const value8 = 8',
      ' const value9 = 9',
      ...Array.from({ length: 8 }, (_, i) => `-const value${10 + i} = ${10 + i} // a short line`),
      ...Array.from({ length: 8 }, (_, i) => `+const value${10 + i} = ${1000 + 100 * i} // a short line // scaled`),
      ' const a = 1',
      ' const b = 2',
      ' const c = 3',
    ],
  },
]
const DIFF_ROWS = 23

function diffProps() {
  return {
    tool_use_id: 'toolu_1',
    tool: 'Edit',
    output: { filePath: '/x.js', oldString: 'a', newString: 'b', structuredPatch: PATCH },
    isErrored: false,
  }
}

function configRow(key: string, value: string): ConfigRow {
  const row = { key, label: key, kind: 'choice' as const, value, isLocked: false }

  return { ...row, provider: { name: 'engine' } } as unknown as ConfigRow
}

function theme(name: string) {
  return { value: [configRow('theme', name)] }
}

// `/dance <args>` as typed at the prompt.
function dance(args: string) {
  return {
    command: 'dance',
    args,
    origin: { kind: 'composer' as const },
    presentation: { isFullscreen: true, columns: 100 },
  }
}

test('/dance 6 sets her height in the mod’s own /config row', async ($, on) => {
  const sets: { key: string; value: unknown }[] = []
  on('config.list', () => ({ value: [configRow('kami-dance.size', '4')] }))
  on('config.set', (_, e) => {
    sets.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  const { text } = await $.command.run(dance('6'))
  expect(sets).toEqual([{ key: 'kami-dance.size', value: '6' }])
  expect(text).toContain('cao 6 dòng')
})

// `octant`: a style no longer drawn, sextant being the one kept.
for (const args of ['9 giant', 'octant', '6 half']) {
  test(`/dance ${args}, a word it does not know, shows how to use it and changes nothing`, async ($, on) => {
    const sets: unknown[] = []
    on('config.set', (_, e) => {
      sets.push(e)

      return { value: e.value }
    })
    const { text } = await $.command.run(dance(args))
    expect(text).toContain('Cách dùng /dance')
    expect(sets).toHaveLength(0)
  })
}

// The mod's own /config rows, each at the value given.
function modRows(values: Record<string, string>) {
  return { value: Object.entries(values).map(([field, value]) => configRow(`kami-dance.${field}`, value)) }
}

const ALL_ROWS = {
  show: 'on',
  size: '4',
  pictures: 'auto',
  places: 'all',
  walk: 'on',
  autoTheme: 'light',
}

test('/dance alone opens the settings menu with the keys, and closes it when open', async ($, on) => {
  const opened: unknown[] = []
  const closed: unknown[] = []
  let isOpen = false
  on('ui.panes', () => ({
    value: isOpen
      ? [{ id: 'kami-settings', title: 'kami-dance: cài đặt', isShown: true, isFocused: true, isPlaced: true }]
      : [],
  }))
  on('ui.open', (_, e) => {
    opened.push(e)
    isOpen = true

    return { value: { isPlaced: true } }
  })
  on('ui.close', (_, e) => {
    closed.push(e)
    isOpen = false

    return { value: undefined }
  })
  expect((await $.command.run(dance(''))).text).toContain('Đã mở bảng cài đặt')
  expect(opened).toHaveLength(1)
  expect(opened[0]).toMatchObject({ id: 'kami-settings', focus: true, closeOnEscape: true })
  expect((await $.command.run(dance(''))).text).toContain('Đã đóng')
  expect(closed).toHaveLength(1)
})

test('/dance off hides her at once and saves it; /dance on brings her back', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  on('config.list', () => modRows(ALL_ROWS))
  const sets: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => {
    sets.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  const props = { text: TEXT, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-off',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  expect(JSON.stringify(await ui.drawn())).toContain('Client')

  expect((await $.command.run(dance('off'))).text).toContain('ẩn')
  expect(sets).toEqual([{ key: 'kami-dance.show', value: 'off' }])
  await ui.redraw({ ...props, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')

  expect((await $.command.run(dance('on'))).text).toContain('hiện')
  expect(sets[1]).toEqual({ key: 'kami-dance.show', value: 'on' })
  await ui.redraw({ ...props, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  expect(JSON.stringify(await ui.drawn())).toContain('Client')
  await ui.unmount()
})

test('the dancer starts hidden where her /config row says off', { options: { show: 'off' } }, async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const props = { text: TEXT, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-hidden',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')
  await ui.unmount()
})

const SETTINGS_PANE = {
  plugin: 'kami-dance',
  component: 'Pane',
  requestId: 'kami-settings',
  viewport: VIEW,
  props: {
    title: 'kami-dance: cài đặt',
    isFocused: true,
    bodyColumns: 60,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

// The text a Button draws: its children's.
async function buttonText(ui: { find(query: { key: string }): Promise<unknown> }, key: string): Promise<string> {
  return JSON.stringify(await ui.find({ key }))
}

test('the menu marks each setting as set, and a press saves the choice', { options: { size: '12' } }, async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  on('config.list', () => modRows({ ...ALL_ROWS, size: '12' }))
  const sets: { key: string; value: unknown }[] = []
  on('config.set', (_, e) => {
    sets.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  const ui = await $.ui.mount({ ...SETTINGS_PANE, surface: 'terminal' })
  // A button for each choice, the set one marked.
  for (const key of ['show-on', 'show-off', 'size-up', 'pictures-off', 'places-diffs', 'walk-off', 'autoTheme-dark']) {
    expect(await ui.find({ key })).toBeDefined()
  }
  // No choice of style: sextant is the one kept.
  expect(await ui.find({ key: 'style-sextant' })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn())).not.toContain('Kiểu vẽ')
  expect(await buttonText(ui, 'show-on')).toContain('● hiện')
  expect(await buttonText(ui, 'show-on')).toContain('"autoFocus":true')
  expect(await buttonText(ui, 'show-off')).toContain('○ ẩn')
  expect(await buttonText(ui, 'places-all')).toContain('● tin nhắn và diff')
  expect(JSON.stringify(await ui.drawn())).toContain('12 dòng')
  // A look at her as set: block characters here, the sextant sprite of her height.
  expect(await ui.find({ key: 'preview-sextant-12' })).toBeDefined()

  await ui.press({ key: 'places-diffs' })
  expect(sets).toEqual([{ key: 'kami-dance.places', value: 'diffs' }])
  expect(await buttonText(ui, 'places-diffs')).toContain('● diff')
  expect(await buttonText(ui, 'places-all')).toContain('○ tin nhắn và diff')

  await ui.press({ key: 'size-up' })
  expect(sets[1]).toEqual({ key: 'kami-dance.size', value: '13' })
  expect(JSON.stringify(await ui.drawn())).toContain('13 dòng')
  expect(await ui.find({ key: 'preview-sextant-13' })).toBeDefined()
  // The choice already set writes nothing.
  await ui.press({ key: 'places-diffs' })
  expect(sets).toHaveLength(2)
  await ui.unmount()
})

test('a setting the engine refuses stays as it was, and says why', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  on('config.list', () => modRows(ALL_ROWS))
  on('config.set', () => ({ deny: 'locked by policy' }))
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  const ui = await $.ui.mount({ ...SETTINGS_PANE, surface: 'terminal' })
  await ui.press({ key: 'walk-off' })
  expect(toasts.join('\n')).toContain('locked by policy')
  expect(await buttonText(ui, 'walk-on')).toContain('● có')
  await ui.unmount()
})

test('the menu draws on every surface, its look at her in the terminal alone', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...SETTINGS_PANE, surface })
    expect(await ui.find({ key: 'walk-off' })).toBeDefined()
    expect(await ui.find({ key: 'close' })).toBeDefined()
    expect(Boolean(await ui.find({ type: 'Client' }))).toBe(surface === 'terminal')
    await ui.unmount()
  }
})

test('in kitty the menu says she is a real picture and shows her first frame', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'KITTY_WINDOW_ID' ? '1' : undefined }))
  const ui = await $.ui.mount({ ...SETTINGS_PANE, surface: 'terminal' })
  expect(JSON.stringify(await ui.drawn())).toContain('vẽ ảnh thật')
  expect(JSON.stringify(await ui.find({ key: 'preview' }))).toContain('assets/png/f0000.png')
  await ui.unmount()
})

test('with pictures off, kitty draws her in block characters', { options: { pictures: 'off' } }, async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'KITTY_WINDOW_ID' ? '1' : undefined }))
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const props = { text: TEXT, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-blocks',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  expect(JSON.stringify(await ui.drawn({ in: 'dancer' }))).toContain('▀')
  await ui.unmount()
})

test('dancing in diffs only, a message hosts nobody', { options: { places: 'diffs' } }, async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const props = { text: TEXT, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-places',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: LAID_OUT - 1, of: LAID_OUT } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')
  await ui.unmount()
})

test(
  'with walking off, at height 7 in kitty she dances at the right end and stays',
  { options: { size: '7', walk: 'off' } },
  async ($, on) => {
    const clock = mock.clock(on)
    on('env.get', (_, e) => ({ value: e.name === 'KITTY_WINDOW_ID' ? '1' : undefined }))
    on('ui.blit', () => ({ value: {} }))
    const props = { text: SHORT, isFirstOfReply: true }
    const ui = await $.ui.mount({
      plugin: 'kami-dance',
      surface: 'terminal',
      component: 'AssistantMessage',
      requestId: 'msg-still',
      viewport: VIEW,
      props,
    })
    await ui.redraw({ ...props, onScreen: { first: 0, last: SHORT_ROWS - 1, of: SHORT_ROWS } })
    const lefts: number[] = []
    for (let s = 0; s < 12; s++) {
      await clock.advance(1000)
      lefts.push(Number(await leftOf(ui)))
    }
    expect(new Set(lefts)).toEqual(new Set([85]))
    await ui.unmount()
  },
)

// The red rows' colour under each theme she knows: `auto` taken as light.
for (const [name, red] of [
  ['auto', '#ffdcdc'],
  ['light', '#ffdcdc'],
  ['dark', '#3d0100'],
]) {
  test(`under the ${name} theme a diff hosts her in its coloured rows, her empty cells in their colour`, async ($, on) => {
    on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
    on('config.list', () => theme(name ?? ''))
    const props = diffProps()
    const ui = await $.ui.mount({
      plugin: 'kami-dance',
      surface: 'terminal',
      component: 'ToolResult',
      requestId: 'toolu_1',
      viewport: VIEW,
      props,
    })
    await ui.redraw({ ...props, onScreen: { first: 0, last: DIFF_ROWS - 1, of: DIFF_ROWS } })
    // Her four rows (7-10) are red ones, and her stand is on the last red row.
    const grounds = JSON.stringify(Array.from({ length: 4 }, () => red))
    expect(JSON.stringify(await ui.find({ key: 'dancer' }))).toContain(`"grounds":${grounds}`)
    await ui.unmount()
  })
}

test('under the auto theme, set to a dark ground, a diff paints her empty cells dark red', { options: { autoTheme: 'dark' } }, async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  on('config.list', () => theme('auto'))
  const props = diffProps()
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_1',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: DIFF_ROWS - 1, of: DIFF_ROWS } })
  expect(JSON.stringify(await ui.find({ key: 'dancer' }))).toContain('"grounds":["#3d0100"')
  await ui.unmount()
})

test('a diff hosts her where her stand rests on its longest line', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  on('config.list', () => theme('auto'))
  const props = diffProps()
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_1',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: DIFF_ROWS - 1, of: DIFF_ROWS } })
  // Her stand rests on the first green line, the longest (56 columns): she
  // starts at its right end. Floating, she would stop 2 columns short of
  // where the coloured rows end, 7 short of the edge: at 84.
  expect(await leftOf(ui)).toBe(49)
  expect(await topOf(ui, DIFF_ROWS)).toBe(7)
  expect(JSON.stringify(await ui.drawn())).toContain('▔')
  await ui.unmount()
})

test('under a theme whose diff colours she does not know, she keeps to the uncoloured rows', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  on('config.list', () => theme('light-ansi'))
  const props = diffProps()
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_1',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: DIFF_ROWS - 1, of: DIFF_ROWS } })
  // The summary and the three lines of context above the red rows, standing
  // on the first red one.
  expect(await topOf(ui, DIFF_ROWS)).toBe(0)
  expect(JSON.stringify(await ui.drawn())).not.toContain('grounds')
  await ui.unmount()
})

// Two long lines of context around two removed lines and three added, all
// short: the one room for her is rows 2-5, two red rows then two green, her
// stand on the last green row, resting on the long line under it.
const CROSSING = [
  {
    oldStart: 1,
    oldLines: 4,
    newStart: 1,
    newLines: 5,
    lines: [` ${'x'.repeat(80)}`, '-a', '-b', '+c', '+d', '+e', ` ${'y'.repeat(80)}`],
  },
]
const CROSSING_ROWS = 8

function crossingProps(patch = CROSSING) {
  return {
    tool_use_id: 'toolu_3',
    tool: 'Edit',
    output: { filePath: '/x.js', oldString: 'a', newString: 'b', structuredPatch: patch },
    isErrored: false,
  }
}

test('in kitty, over red and green rows, her picture is a strip a colour, each swapped', async ($, on) => {
  const clock = mock.clock(on)
  on('env.get', (_, e) => ({ value: e.name === 'KITTY_WINDOW_ID' ? '1' : undefined }))
  on('config.list', () => theme('light'))
  const swapped = new Set<string>()
  on('ui.blit', (_, e) => {
    swapped.add(e.key)

    return { value: {} }
  })
  const props = crossingProps()
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_3',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: CROSSING_ROWS - 1, of: CROSSING_ROWS } })
  expect(await topOf(ui, CROSSING_ROWS)).toBe(2)
  // A strip for the two red rows and one for the two green, each the whole
  // picture in a box of its rows' colour, shifted up to show its own rows.
  const strips = JSON.stringify(await ui.find({ key: 'spot' }))
  expect(strips).toMatch(/"height":2,"flexShrink":0,"overflow":"hidden","backgroundColor":"#ffdcdc"\},"children":\[\{"type":"Box","props":\{"marginTop":0/)
  expect(strips).toMatch(/"height":2,"flexShrink":0,"overflow":"hidden","backgroundColor":"#dcffdc"\},"children":\[\{"type":"Box","props":\{"marginTop":-2/)
  expect(await ui.findAll({ type: 'Image' })).toHaveLength(2)
  // Her stand's bars on the green row, in its colour.
  expect(strips).toContain('"type":"Text","props":{"color":"#f2a6c8","backgroundColor":"#dcffdc"}')
  // The room she walks, left of her, written in the rows' colours too.
  const before = (await ui.find({ key: 'before' })) as { children?: { props?: { backgroundColor?: string } }[] }
  expect(before.children?.map(row => row.props?.backgroundColor)).toEqual([
    '#ffdcdc',
    '#ffdcdc',
    '#dcffdc',
    '#dcffdc',
    '#dcffdc',
  ])
  await clock.advance(200)
  expect([...swapped].sort()).toEqual(['dancer', 'dancer-1'])
  await ui.unmount()
})

test('in kitty, rows that change colour more often than she has strips for host nobody', async ($, on) => {
  on('env.get', (_, e) => ({ value: e.name === 'KITTY_WINDOW_ID' ? '1' : undefined }))
  on('config.list', () => theme('light'))
  // Red, green, red, green under her four rows: four strips, one too many.
  const patch = [{ ...CROSSING[0], lines: [` ${'x'.repeat(80)}`, '-a', '+c', '-b', '+d', ` ${'y'.repeat(80)}`] }]
  const props = crossingProps(patch as typeof CROSSING)
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_3',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: CROSSING_ROWS - 2, of: CROSSING_ROWS - 1 } })
  expect(await ui.find({ type: 'Image' })).toBeUndefined()
  await ui.unmount()
})

test('a long message whose guess misses by a row still hosts her, on her stand, clear of shifted words', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const props = { text: SHORT, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-loose',
    viewport: VIEW,
    props,
  })
  // One row more than the guess: somewhere a line wrapped that it kept whole.
  await ui.redraw({ ...props, onScreen: { first: 0, last: SHORT_ROWS, of: SHORT_ROWS + 1 } })
  expect(JSON.stringify(await ui.drawn())).toContain('Client')
  expect(JSON.stringify(await ui.drawn())).toContain('▔')
  // Her four rows and her stand stay above the rows the guess does not reach.
  const top = (await topOf(ui, SHORT_ROWS + 1)) ?? 99
  expect(top + 5).toBeLessThanOrEqual(SHORT_ROWS - 1)
  await ui.unmount()
})

// Five headings, each with its line straight under it: the terminal draws a
// blank row under every heading all the same, five rows the text does not
// have, more than a guess may miss by.
const HEADED = ['A', 'B', 'C', 'D', 'E'].map(name => `## Part ${name}\nA short line.`).join('\n\n')
const HEADED_ROWS = 20

test('a blank row under each heading is counted, so a message of headings hosts her', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const props = { text: HEADED, isFirstOfReply: true }
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'msg-headed',
    viewport: VIEW,
    props,
  })
  await ui.redraw({ ...props, onScreen: { first: 0, last: HEADED_ROWS - 1, of: HEADED_ROWS } })
  expect(JSON.stringify(await ui.drawn())).toContain('Client')
  await ui.unmount()
})

test('a diff whose rows do not match its patch hosts nobody', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  on('config.list', () => theme('dark'))
  const props = diffProps()
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'ToolResult',
    requestId: 'toolu_2',
    viewport: VIEW,
    props: { ...props, tool_use_id: 'toolu_2' },
  })
  await ui.redraw({ ...props, tool_use_id: 'toolu_2', onScreen: { first: 0, last: 29, of: 30 } })
  expect(JSON.stringify(await ui.drawn())).not.toContain('Client')
  await ui.unmount()
})
