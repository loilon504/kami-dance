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

test('a message whose rows fit hosts the dancer, and loses her off screen', async ($, on) => {
  on('fs.read', (_, e) => {
    expect(e.path).toEndWith('/assets/sprites/half-4.json')

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
  expect(box).toContain('"position":"absolute"')

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
  const tall = sprite('half')
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
    const leftOf = async () => JSON.stringify(await ui.find({ key: 'spot' })).match(/"left":(\d+)/)?.[1]

    // 100 columns, 2 kept clear at the edge: her 13-column box starts at the right end.
    expect(await leftOf()).toBe('85')
    const dancer = JSON.stringify(await ui.find({ key: 'dancer' }))
    expect(dancer).toMatch(/assets\/walk-7\/f\d{4}-0\.png/)
    expect(dancer).toContain('"columns":13')
    expect(JSON.stringify(await ui.find({ key: 'stand' }))).toContain('assets/walk-7/stand-0.png')

    // She dances in place for 2 to 7 s, then walks left a quarter column a tick.
    const lefts: number[] = []
    for (let s = 0; s < 12; s++) {
      await clock.advance(1000)
      lefts.push(Number(await leftOf()))
    }
    expect(Math.min(...lefts)).toBeLessThan(85)
    expect(Math.min(...lefts)).toBeGreaterThanOrEqual(53)
    expect(swaps.some(swap => /walk-7\/f\d{4}-[123]\.png/.test(swap))).toBe(true)
    await ui.unmount()
  },
)

test('the styles pane shows every sample, each animating', async ($, on) => {
  on('fs.read', (_, e) => ({ value: spriteFile(e.path) }))
  const ui = await $.ui.mount({
    plugin: 'kami-dance',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'kami-styles',
    viewport: VIEW,
    props: {
      title: 'kami-dance: kiểu vẽ',
      isFocused: false,
      bodyColumns: 70,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 30 },
      view: {},
    },
  })
  expect(await ui.findAll({ type: 'Client' })).toHaveLength(6)
  for (const key of ['half-4', 'octant-4', 'octant-8']) {
    expect(JSON.stringify(await ui.drawn({ in: key }))).toContain('█')
  }
  await ui.unmount()
})

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
  const topOf = async () => {
    const box = await ui.find({ key: 'spot' })

    return box === undefined ? undefined : (JSON.stringify(box).match(/"top":(\d+)/)?.[1] ?? 'unknown')
  }

  // Only the lower gap on screen: she stands in it.
  await ui.redraw({ ...props, onScreen: { first: 12, last: 18, of: 19 } })
  expect(await topOf()).toBe('13')

  // Scrolled up until the lower gap is gone: she moves to the upper one, on
  // her stand resting on the wall of code (row 7), a row higher than she
  // would stand on the code itself.
  await ui.redraw({ ...props, onScreen: { first: 0, last: 8, of: 19 } })
  expect(await topOf()).toBe('2')
  expect(JSON.stringify(await ui.drawn())).toContain('▔')

  // Only the wall of code on screen: no spot in view, so nobody.
  await ui.redraw({ ...props, onScreen: { first: 8, last: 11, of: 19 } })
  expect(await topOf()).toBeUndefined()
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

test('/dance 6 octant sets her height and style in the mod’s own /config rows', async ($, on) => {
  const sets: { key: string; value: unknown }[] = []
  on('config.list', () => ({ value: [configRow('kami-dance.size', '4'), configRow('kami-dance.style', 'half')] }))
  on('config.set', (_, e) => {
    sets.push({ key: e.key, value: e.value })

    return { value: e.value }
  })
  const { text } = await $.command.run(dance('octant 6'))
  expect(sets).toEqual([
    { key: 'kami-dance.size', value: '6' },
    { key: 'kami-dance.style', value: 'octant' },
  ])
  expect(text).toContain('cao 6 dòng, kiểu octant')
})

test('/dance with a word it does not know shows how to use it, and changes nothing', async ($, on) => {
  const sets: unknown[] = []
  on('config.set', (_, e) => {
    sets.push(e)

    return { value: e.value }
  })
  const { text } = await $.command.run(dance('9 giant'))
  expect(text).toContain('Cách dùng /dance')
  expect(sets).toHaveLength(0)
})

test('/dance alone shows or hides her', async $ => {
  expect((await $.command.run(dance(''))).text).toContain('tắt')
  expect((await $.command.run(dance(''))).text).toContain('bật')
  expect((await $.command.run(dance('on'))).text).toContain('bật')
})

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
  const spot = JSON.stringify(await ui.find({ key: 'spot' }))
  expect(spot).toContain('"position":"absolute"')
  // Her stand rests on the first green line, the longest (56 columns): she
  // starts at its right end. Floating, she would stop 2 columns short of
  // where the coloured rows end, 7 short of the edge: at 84.
  expect(spot).toContain('"left":49')
  expect(spot).toContain('"top":7')
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
  expect(JSON.stringify(await ui.find({ key: 'spot' }))).toContain('"top":0')
  expect(JSON.stringify(await ui.drawn())).not.toContain('grounds')
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
