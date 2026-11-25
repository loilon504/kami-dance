import type { EngineInterface, Register, RenderNode } from 'claude-code'

// The dancer of "Shukusei!! Loli Kami Requiem" over the chat.
//
// She rides inside one transcript row's drawing, in a box laid over empty
// room to the right of its words, so she scrolls with them. Her box is in the
// row's flow, after the engine's drawing, pulled up over it by a negative top
// margin and given back by its bottom one, so the row keeps its height. It is
// not `position: "absolute"`: the terminal pins an absolute box whose top is
// above the screen to the screen's top row (2.1.332), so scrolling down would
// drag her along until her spot left the screen.
//
// Two kinds of row host her: an assistant message, whose rows are guessed
// from its markdown, and a file change's diff (Edit, Write), whose rows come
// from its patch. Each guess is checked against the rows the terminal really
// laid out (`onScreen.of`). A diff hosts her only where its guess holds. A
// message whose guess misses by up to DRIFT rows still hosts her, on her stand
// in the air, where the words stay clear of her wherever the miss is. In a
// diff she stands in the empty right end of the red and green rows, her empty
// cells painted in the row's colour.
//
// Each row keeps every spot its gaps hold: on her stand, a thin disc one row
// under her feet, resting on a line of words where one runs under it, else
// floating; where a gap is one row short of that, straight on a line of
// words. When her spot leaves the screen she moves to another one in view.
// In her spot she walks left and right over the right end of the room,
// dancing in place between walks.
//
// In a terminal that draws real pictures (kitty, Ghostty) she is an `Image` of
// PNG frames swapped twelve times a second with `$.ui.blit`. At a height
// tools/walk.py has built (assets/walk-<rows>) she walks a quarter column at
// a time: her box is a column wider than she is, the frames come shifted by
// quarters inside it, and the box moves a whole column on a redraw. At other
// heights she steps whole columns with the plain frames in assets/png. A
// picture's cells are text the terminal paints the picture over, its clear
// pixels showing the cells' ground: over a diff's red and green rows she is
// cut into strips, one for each run of rows of one colour, each strip the
// whole picture in a box of that colour that shows only its rows (STRIPS at
// most, as each strip is a picture of its own to swap). Elsewhere she is
// drawn in sextant block characters (a cell split into six dots) from
// assets/sprites/sextant-<height>.json (built by tools/blocks.py) by
// `./dancer.tsx`, which animates her where the terminal draws, on its own
// frame clock, and her stand is a row of thin bars.
//
// Fullscreen rendering only (`/tui fullscreen`): there the terminal reports
// which rows of a message are on screen and keeps redrawing them.

type Sprite = {
  style: string
  cols: number
  rows: number
  fps: number
  palette: string[]
  alphabet: string
  frames: string[]
  // The ground of each of her rows where it is not the terminal's own: a
  // theme key or colour, null for none.
  grounds?: (string | null)[]
  // Handed to ./dancer.tsx, a window of the dance: `frames` are frames
  // `first` on (wrapping) of `total`.
  first?: number
  total?: number
}

type Rows = { first: number; last: number; of: number }

// `top` counts the engine's rows of the transcript row: a message's row 0 is
// the blank row the engine draws above it, a diff's is its summary line. Her
// box's left edge walks from `from` to `to`. `stand`: she is on her stand, in
// the row under her box. `ground`: words hold her up, under her feet or under
// her stand.
type Spot = { top: number; from: number; to: number; stand: boolean; ground: boolean }

type Host = { id: string; spot: Spot }

type Kind = 'message' | 'diff'

// A row as the guess lays it out: the last column each of its rows uses, the
// colour that fills a row to `right` (a diff's red and green), and the column
// her room ends at. `isLoose`: the guess missed the rows laid out, and `rows`
// are as wide as any guessed row that could have shifted there, so no row of
// words is sure to be under her.
type Laid = { rows: number[]; bands: (string | undefined)[]; right: number; isLoose?: boolean }

// What else a spot must meet: words to stand on are known (a guess that held),
// and a top whose rows the picture can be drawn over.
type Rules = { canGround: boolean; fits: (top: number) => boolean }

// A run of her rows over one ground, `from` to `to` (not included).
type Run = { from: number; to: number; band: string | undefined }

type Site = {
  id: string
  kind: Kind
  seq: number
  // What the drawing shows: a message's text, a diff's patch.
  key: string
  columns: number
  // What is on screen, in the engine's rows; `null` off screen.
  onScreen: Rows | null | undefined
  onScreenAt: number
  // Rows the engine laid out for this text and width.
  laidOut?: number
  // Whether our own tree (not the engine's) was drawn last.
  drewTree: boolean
  // Every spot the row's gaps hold, top to bottom; unset until laid out.
  spots?: Spot[]
  bands?: (string | undefined)[]
}

// A diff's change, as Edit and Write report it.
type Hunk = { oldStart: number; oldLines: number; newStart: number; newLines: number; lines: string[] }

const GAP = 3 // columns kept clear between the words and her
const EDGE = 2 // columns kept clear at the right edge
const SPOT_GAP = 1 // rows kept between two spots of one message
const ROAM = 32 // columns she walks over, at the right end of her room
const STRIDE = 6 // the shortest walk, in columns
const PAUSE_MIN = 24 // ticks she dances in place between walks: 2 s ...
const PAUSE_SPREAD = 60 // ... to 7 s; a tick is a picture frame, and she walks a quarter column a tick
// Rows a message's guess may miss its laid-out rows by and still host her. A
// long message misses most often (a line wrapped one word sooner, a blank row
// the markdown guess does not know), and it holds the most room.
const DRIFT = 3
// Strips her picture is cut into at most over a diff's coloured rows: each is
// a picture the terminal decodes again on every frame.
const STRIPS = 3
const STAND_COLOR = '#f2a6c8'
// A diff as the terminal draws it (2.1.329): each line is 5 columns of
// indent, a space, its line number padded to the hunk's widest, a space and
// its sign, then the code, wrapped hard where the red and green rows end, 7
// columns short of the right edge. A "..." row parts two hunks.
const DIFF_TOOLS = new Set(['Edit', 'Write', 'MultiEdit'])
const DIFF_INDENT = 5
const DIFF_RIGHT = 7
// The colours of a removed and an added row, as the diff paints them under
// each theme (2.1.329), which are not the theme's own diffRemoved and
// diffAdded. A 256-colour terminal rounds them as it does the diff's (52 and
// 22; 224 and 194). `auto` follows the terminal's ground, which a mod cannot
// read: it is taken as the person's `autoTheme` setting, light unless they
// say. Under another theme the rows' colour is unknown and a diff hosts her
// only beside the rows it leaves uncoloured.
type Grounds = { removed: string; added: string }
const DIFF_GROUNDS: Record<string, Grounds> = {
  light: { removed: '#ffdcdc', added: '#dcffdc' },
  dark: { removed: '#3d0100', added: '#022800' },
}
// The mod writes its log only where KAMI_DANCE_LOG names a file for it, each
// session its own.
const SETTINGS_PANE = 'kami-settings'
// The one style of block characters she is drawn in: a cell split into six
// dots (assets/sprites/sextant-<height>.json).
const STYLE = 'sextant'

// ---- what the person sets ---------------------------------------------------

// Every setting is one of the mod's /config rows (plugin.json's userConfig,
// the same field names and values) and one row of the /dance menu. A change
// is written to its /config row, which reloads the mod with it.
type Settings = {
  show: string // on, off
  size: string // her height in rows, 3 to 15
  pictures: string // auto: a real picture where the terminal draws one; off: block characters everywhere
  places: string // all, messages, diffs
  walk: string // on: she walks left and right; off: she dances in place
  autoTheme: string // light, dark: the diff's colours under the `auto` theme
}
type Field = keyof Settings
type Choice = { value: string; label: string }
type Setting = { field: Field; label: string; choices: Choice[] }

const SIZES = Array.from({ length: 13 }, (_, i) => String(i + 3))
// The menu's rows, top to bottom; a choice's label is what the menu draws.
const SETTINGS: Setting[] = [
  {
    field: 'show',
    label: 'Cô bé',
    choices: [
      { value: 'on', label: 'hiện' },
      { value: 'off', label: 'ẩn' },
    ],
  },
  { field: 'size', label: 'Cao', choices: SIZES.map(value => ({ value, label: `${value} dòng` })) },
  {
    field: 'pictures',
    label: 'Ảnh thật',
    choices: [
      { value: 'auto', label: 'khi terminal vẽ được' },
      { value: 'off', label: 'tắt' },
    ],
  },
  {
    field: 'places',
    label: 'Nhảy ở',
    choices: [
      { value: 'all', label: 'tin nhắn và diff' },
      { value: 'messages', label: 'tin nhắn' },
      { value: 'diffs', label: 'diff' },
    ],
  },
  {
    field: 'walk',
    label: 'Đi lại',
    choices: [
      { value: 'on', label: 'có' },
      { value: 'off', label: 'đứng yên' },
    ],
  },
  {
    field: 'autoTheme',
    label: 'Theme auto',
    choices: [
      { value: 'light', label: 'nền sáng' },
      { value: 'dark', label: 'nền tối' },
    ],
  },
]
const DEFAULTS: Settings = {
  show: 'on',
  size: '4',
  pictures: 'auto',
  places: 'all',
  walk: 'on',
  autoTheme: 'light',
}
// Columns of the menu's labels, the widest and a gap.
const LABEL_COLS = 12

// The settings `options` hold, a value no row offers taken as its default.
function settingsOf(options: Readonly<Record<string, unknown>>): Settings {
  const settings = { ...DEFAULTS }
  for (const { field, choices } of SETTINGS) {
    const value = options[field]
    if (typeof value === 'string' && choices.some(choice => choice.value === value)) {
      settings[field] = value
    }
  }

  return settings
}

function choiceOf(field: Field, value: string): string {
  return SETTINGS.find(setting => setting.field === field)?.choices.find(choice => choice.value === value)?.label ?? value
}

const DANCE_HELP = [
  'Cách dùng /dance:',
  '  /dance               mở bảng cài đặt: hiện hay ẩn, cao, ảnh thật, nhảy ở đâu,',
  '                       đi lại, nền diff khi theme auto (gõ lại để đóng)',
  '  /dance on | off      hiện, ẩn cô bé',
  '  /dance 6             cao 6 dòng (3 đến 15)',
  '  /dance on 6          cả hai',
  'Cài đặt được lưu, dùng cho mọi phiên sau.',
].join('\n')

// The menu's look at her keeps her first ten seconds at most.
const SAMPLE_FRAMES = 120
// A Client's props carry 100,000 characters at most, and a tall dancer's 418
// frames many more: she is handed a window of the dance, as many frames as
// WINDOW_CHARS holds, a new one drawn when WINDOW_SLACK frames are left.
const WINDOW_CHARS = 60000
const WINDOW_SLACK = 12

// Real pictures, where the terminal draws them (kitty, Ghostty): one PNG a
// frame with a clear ground, assets/png/f0000.png on, swapped in place.
const PICTURE_FRAMES = 418
const PICTURE_FPS = 12
const PICTURE_ASPECT = 0.875 // width / height of the PNGs: 7 cells by 4 rows of 1:2 cells
const DENIES_BEFORE_REDRAW = 5
// Heights whose quarter-column walking frames tools/walk.py has built.
const WALK_SETS = new Set(['7'])

type Size = { cols: number; rows: number }

// ---- the message's rows, guessed from its markdown -------------------------

function isWide(c: number): boolean {
  return (
    (c >= 0x1100 && c <= 0x115f) ||
    (c >= 0x2e80 && c <= 0xa4cf && c !== 0x303f) ||
    (c >= 0xac00 && c <= 0xd7a3) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0xffe0 && c <= 0xffe6) ||
    (c >= 0x1f300 && c <= 0x1faff) ||
    (c >= 0x20000 && c <= 0x3fffd)
  )
}

function width(s: string): number {
  let w = 0
  for (const ch of s) {
    const c = ch.codePointAt(0) ?? 0
    if (c < 0x20 || (c >= 0x300 && c <= 0x36f) || (c >= 0x200b && c <= 0x200f) || c === 0xfe0f) {
      continue
    }
    w += isWide(c) ? 2 : 1
  }

  return w
}

// Inline markdown as the terminal shows it: a link as "text (url)".
function plain(s: string): string {
  return s
    .replace(/!\[([^\]]*)\]\(([^)]*)\)/g, '$1')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '$1 ($2)')
    .replace(/\*\*|__|~~|`/g, '')
    .replace(/(^|[^\w*])\*([^*\s][^*]*)\*/g, '$1$2')
    .replace(/\\([\\`*_{}[\]()#+\-.!|>])/g, '$1')
}

// The width of each row a line wraps into, greedy at spaces as the terminal wraps.
function wrap(s: string, room: number): number[] {
  if (room < 1) {
    return [width(s)]
  }
  const rows: number[] = []
  let used = -1
  for (const word of s.split(' ')) {
    let w = width(word)
    if (used >= 0 && used + 1 + w <= room) {
      used += 1 + w
      continue
    }
    if (used >= 0) {
      rows.push(used)
    }
    while (w > room) {
      rows.push(room)
      w -= room
    }
    used = w
  }
  rows.push(Math.max(used, 0))

  return rows
}

// The cells of a table row, split at the pipes that are not escaped.
function cellsOf(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/(?<!\\)\|$/, '')
    .split(/(?<!\\)\|/)
}

// A markdown table as the terminal draws it: a box with a rule under every
// row, each column its widest cell and a space either side, so a table of n
// rows takes 2n + 1 rows. null without the rule under the header that makes
// it a table, or when the box would not fit, where the terminal wraps cells.
function tableRows(lines: string[], room: number): number[] | null {
  const isRule = (line: string) => cellsOf(line).every(cell => /^\s*:?-+:?\s*$/.test(cell))
  if (lines.length < 2 || !isRule(lines[1] ?? '')) {
    return null
  }
  const body = lines.filter((_, i) => i !== 1)
  const widths: number[] = []
  for (const line of body) {
    cellsOf(line).forEach((cell, i) => {
      widths[i] = Math.max(widths[i] ?? 0, width(plain(cell.trim())))
    })
  }
  const total = widths.reduce((sum, w) => sum + w + 3, 1)
  if (total > room) {
    return null
  }

  return Array.from({ length: body.length * 2 + 1 }, () => 2 + total)
}

// The last column each row of the message uses, row 0 the blank row above it;
// null for a text this guess cannot lay out (a table too wide to fit).
function layout(text: string, columns: number, margin: number): number[] | null {
  const rows = [0]
  const room = columns - 2 - margin
  let isFenced = false
  let isAfterBlank = true
  let table: string[] = []
  const flushTable = (): boolean => {
    if (table.length === 0) {
      return true
    }
    const drawn = tableRows(table, room)
    table = []
    if (drawn === null) {
      return false
    }
    rows.push(...drawn)
    isAfterBlank = false

    return true
  }

  for (const line of text.replace(/\s+$/, '').split('\n')) {
    if (!isFenced && /^\s*\|/.test(line)) {
      table.push(line)
      continue
    }
    if (!flushTable()) {
      return null
    }
    if (/^\s*(```|~~~)/.test(line)) {
      isFenced = !isFenced
      continue
    }
    if (isFenced) {
      for (const _ of wrap(line, room)) {
        rows.push(columns)
      }
      isAfterBlank = false
      continue
    }
    if (line.trim() === '') {
      if (!isAfterBlank) {
        rows.push(0)
        isAfterBlank = true
      }
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      rows.push(columns)
      isAfterBlank = false
      continue
    }

    const heading = /^\s*#{1,6}\s+(.*)$/.exec(line)
    const item = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/.exec(line)
    const quote = /^\s*>\s?(.*)$/.exec(line)
    let hang = 0
    let body = line.trim()
    if (heading) {
      body = heading[1] ?? ''
    } else if (item) {
      hang = (item[1] ?? '').length + width(item[2] ?? '') + 1
      body = item[3] ?? ''
    } else if (quote) {
      hang = 2
      body = quote[1] ?? ''
    }
    for (const w of wrap(plain(body), room - hang)) {
      rows.push(2 + hang + w)
    }
    isAfterBlank = false
    // The terminal draws a blank row under a heading, a blank line after it
    // in the text or not (2.1.332).
    if (heading) {
      rows.push(0)
      isAfterBlank = true
    }
  }
  if (!flushTable()) {
    return null
  }
  while (rows.length > 1 && rows[rows.length - 1] === 0) {
    rows.pop()
  }

  return rows
}

// The rows of a message whose guess missed the `length` rows laid out by
// `drift`: each row as wide as any guessed row that a miss anywhere above it
// could have shifted into it (a row more either way, for misses that part
// cancel out), a row the guess does not reach as wide as `full`.
function blurred(rows: number[], length: number, drift: number, full: number): number[] {
  const lo = Math.min(0, drift) - 1
  const hi = Math.max(0, drift) + 1

  return Array.from({ length }, (_, row) => {
    let used = 0
    for (let shift = lo; shift <= hi; shift++) {
      const from = row - shift
      used = Math.max(used, from < 0 ? 0 : (rows[from] ?? full))
    }

    return used
  })
}

// ---- a diff's rows, from its patch ------------------------------------------

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

// A file change's result as the terminal draws it: its summary line ("Added
// 4 lines, removed 4 lines"), then each hunk's lines, a removed or added one
// filled in red or green to where the coloured rows end, full where their
// colour is not known. A tab counts 8 columns: too wide a guess only keeps
// her further off.
function diffLayout(patch: readonly Hunk[], columns: number, grounds: Grounds | null): Laid {
  const right = columns - DIFF_RIGHT
  const lines = patch.flatMap(hunk => hunk.lines)
  const added = lines.filter(line => line.startsWith('+')).length
  const removed = lines.filter(line => line.startsWith('-')).length
  const rows = [DIFF_INDENT + width(`Added ${plural(added, 'line')}, removed ${plural(removed, 'line')}`)]
  const bands: (string | undefined)[] = [undefined]
  patch.forEach((hunk, i) => {
    if (i > 0) {
      rows.push(DIFF_INDENT + 3)
      bands.push(undefined)
    }
    const last = Math.max(hunk.oldStart + hunk.oldLines, hunk.newStart + hunk.newLines) - 1
    const code = DIFF_INDENT + 3 + String(Math.max(1, last)).length
    const room = Math.max(1, right - code)
    for (const line of hunk.lines) {
      const sign = line.startsWith('-') ? 'removed' : line.startsWith('+') ? 'added' : null
      const band = sign && grounds ? grounds[sign] : undefined
      let w = width(line.slice(1).replace(/\t/g, '        '))
      do {
        rows.push(sign && !grounds ? right : code + Math.min(w, room))
        bands.push(band)
        w -= room
      } while (w > 0)
    }
  })

  return { rows, bands, right }
}

// ---- where she stands -------------------------------------------------------

function hash(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h = Math.imul(h ^ s.charCodeAt(i), 16777619)
  }

  return h >>> 0
}

// Her `rows` rows from `top` in runs of one ground (`bands`, a diff's red and
// green), top to bottom.
function runsOf(bands: readonly (string | undefined)[] | undefined, top: number, rows: number): Run[] {
  const runs: Run[] = []
  for (let row = 0; row < rows; row++) {
    const band = bands?.[top + row]
    const last = runs[runs.length - 1]
    if (last !== undefined && last.band === band) {
      last.to = row + 1
    } else {
      runs.push({ from: row, to: row + 1, band })
    }
  }

  return runs
}

// Rows a spot takes: her box, and her stand's row under it.
function tallOf(spot: Spot, box: Size): number {
  return box.rows + (spot.stand ? 1 : 0)
}

// How good a spot is to stand in: on her stand on words, on words, on her
// stand in the air.
function footing(spot: Spot): number {
  return spot.ground ? (spot.stand ? 2 : 1) : 0
}

// Every window of `box.rows` rows with nothing right of `from - GAP`, short
// of `right`, kept apart from one another, the best footing first, then the
// roomiest: on her stand where the row under her is clear as well, resting
// on a line of words that runs under the stand or else floating; straight on
// a line of words where that line is the row under her. Where no words are
// sure to be under her (`rules.canGround` false), floating on her stand alone.
// She walks the right end of the room, ROAM columns at most. Returned top to
// bottom.
function findSpots(rows: number[], right: number, box: Size, rules: Rules): Spot[] {
  const found: Spot[] = []
  const hi = right - EDGE - box.cols
  // The row under her is inside the message: words to stand on, or room for
  // the stand.
  for (let top = 0; top + box.rows < rows.length; top++) {
    if (!rules.fits(top)) {
      continue
    }
    let used = 0
    for (let r = top; r < top + box.rows; r++) {
      used = Math.max(used, rows[r] ?? 0)
    }
    const lo = Math.max(2, used + GAP)
    const below = rows[top + box.rows] ?? 0
    const clear = Math.max(lo, below + GAP)
    if (hi >= clear) {
      const onGround = rules.canGround ? Math.min(hi, (rows[top + box.rows + 1] ?? 0) - box.cols) : -1
      found.push(
        onGround >= clear
          ? { top, from: Math.max(clear, onGround - ROAM), to: onGround, stand: true, ground: true }
          : { top, from: Math.max(clear, hi - ROAM), to: hi, stand: true, ground: false },
      )
    }
    const onWords = Math.min(hi, below - box.cols)
    if (rules.canGround && onWords >= lo) {
      found.push({ top, from: Math.max(lo, onWords - ROAM), to: onWords, stand: false, ground: true })
    }
  }
  found.sort((a, b) => footing(b) - footing(a) || b.to - b.from - (a.to - a.from) || a.top - b.top)
  const spots: Spot[] = []
  for (const spot of found) {
    const isApart = (kept: Spot) =>
      kept.top + tallOf(kept, box) + SPOT_GAP <= spot.top || spot.top + tallOf(spot, box) + SPOT_GAP <= kept.top
    if (spots.every(isApart)) {
      spots.push(spot)
    }
  }

  return spots.sort((a, b) => a.top - b.top)
}

// The first rank ahead of the second, compared item by item.
function isAhead(a: number[], b: number[]): boolean {
  for (let i = 0; i < a.length; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) {
      return (a[i] ?? 0) > (b[i] ?? 0)
    }
  }

  return false
}

// How many rows of a spot, her stand's too, are on screen.
function shownOf(rows: Rows | null | undefined, spot: Spot, box: Size): number {
  return rows
    ? Math.max(0, Math.min(rows.last, spot.top + tallOf(spot, box) - 1) - Math.max(rows.first, spot.top) + 1)
    : 0
}

function isSame(a: Spot, b: Spot): boolean {
  return a.top === b.top && a.from === b.from && a.to === b.to && a.stand === b.stand && a.ground === b.ground
}

// ---- the module's state -----------------------------------------------------

// What one load of the module keeps between drawings.
type Kami = {
  // The settings this load was given, and the ones changed since, written to
  // their /config rows and drawn in the menu until the reload brings them.
  settings: Settings
  pending: Partial<Settings>
  size: string
  hasWalkSet: boolean
  sites: Map<string, Site>
  log: string[]
  isLogDirty: boolean
  seq: number
  screenTick: number
  // The row she stands in, and where in it.
  host: Host | null
  // Her box's left edge and where she walks to, in quarter columns, and the
  // ticks she dances in place before she walks on.
  walk: { at: number; to: number; wait: number }
  seed: number
  // The column and quarter of the last tree drawn for her host; null when it
  // has not drawn her since she moved in. A step into another column waits
  // for that redraw before the next frame is swapped in.
  drawnCell: number | null
  drawnStand: number
  // The keys of the pictures she is drawn in now, a strip each: what a tick
  // swaps to the next frame.
  pictureKeys: string[]
  awaitTicks: number
  isOn: boolean
  hasWarned: boolean
  // Engine rows above our own tree's row 0 while we host, a kind of row
  // each: 1 when the engine draws the blank row above a message outside the
  // hook's tree. Learned; 0 on 2.1.329, where the blank row is inside the tree.
  treeOffset: Record<Kind, number>
  // Right margin of the text column and the extra rows below a message, as
  // learned from messages whose guess matched.
  fit: { margin: number; extra: number } | null
  // Each sprite read (assets/sprites/sextant-<height>.json), by its name.
  spriteLoads: Map<string, Promise<Sprite | null>>
  // The longest frame of each sprite read, in characters.
  longest: Map<string, number>
  picturesLoad?: Promise<boolean>
  // A diff's row colours under the theme, null where she does not know them.
  groundsLoad?: Promise<Grounds | null>
  frame: number
  isTicking: boolean
  denies: number
  isRedrawing: boolean
  // Where the log goes (KAMI_DANCE_LOG); none, it is kept in memory alone.
  logPath?: string
  // The props last handed to ./dancer.tsx, kept while the window and her
  // rows' grounds stay the same, and the window they hold.
  handed: { key: string; sprite: Sprite } | null
  window: { entry: string; first: number; length: number; total: number; fps: number } | null
  windowAskedAt: number
}

// What a drawing tells about where it is.
type Drawing = {
  requestId: string
  viewport?: { columns: number; isFullscreen?: boolean }
  onScreen?: Rows | null
}

// How she is drawn in this terminal.
type Look = { box: Size; sprite: Sprite | null; entry: string; isQuartered: boolean; root: string }

// The elements her overlay is built of, as `$.ui.resolve(e)` gives them.
type Parts = Record<'Box' | 'Client' | 'Image' | 'Text', (props: never) => RenderNode | null | undefined>

function note(k: Kami, line: string) {
  k.log.push(line)
  if (k.log.length > 400) {
    k.log.splice(0, k.log.length - 400)
  }
  k.isLogDirty = true
}

function seesPictures(k: Kami, [kitty, term, program, forced]: (string | undefined)[]): boolean {
  const yes =
    Boolean(kitty) ||
    (term ?? '').includes('kitty') ||
    term === 'xterm-ghostty' ||
    program === 'ghostty' ||
    Boolean(forced)
  note(k, `pictures: ${yes} (TERM ${term ?? '-'}, TERM_PROGRAM ${program ?? '-'}, forced ${forced ?? '-'})`)

  return yes
}

function frameOf(k: Kami, root: string, n: number, quarter: number): string {
  return k.hasWalkSet
    ? `${root}/assets/walk-${k.size}/f${String(n).padStart(4, '0')}-${quarter}.png`
    : `${root}/assets/png/f${String(n).padStart(4, '0')}.png`
}

function standOf(k: Kami, root: string, quarter: number): string {
  return `${root}/assets/walk-${k.size}/stand-${quarter}.png`
}

function random(k: Kami, n: number): number {
  k.seed = (Math.imul(k.seed, 1103515245) + 12345) >>> 0

  return (k.seed >>> 8) % n
}

function startWalk(k: Kami, spot: Spot) {
  k.walk = { at: spot.to * 4, to: spot.to * 4, wait: PAUSE_MIN + random(k, PAUSE_SPREAD) }
}

// Keep her where she is when her spot's room changes, as far as it allows.
function keepWalk(k: Kami, spot: Spot) {
  const at = Math.min(spot.to * 4, Math.max(spot.from * 4, k.walk.at))
  k.walk = { at, to: at - (at % 4), wait: k.walk.wait }
}

// One tick: dance in place, or a quarter column on to where she walks; once
// there, a pause, then a new place at least STRIDE columns off. With walking
// off she ends the step she is in and stays.
function stepWalk(k: Kami, spot: Spot) {
  const walk = k.walk
  if (walk.wait > 0) {
    walk.wait -= 1
    return
  }
  if (walk.at !== walk.to) {
    walk.at += Math.sign(walk.to - walk.at)
    return
  }
  if ((k.pending.walk ?? k.settings.walk) === 'off') {
    return
  }
  walk.wait = PAUSE_MIN + random(k, PAUSE_SPREAD)
  const here = Math.floor(walk.at / 4)
  const left = Math.max(0, here - STRIDE - spot.from + 1)
  const right = Math.max(0, spot.to - (here + STRIDE) + 1)
  if (left + right === 0) {
    return
  }
  const pick = random(k, left + right)
  walk.to = (pick < left ? spot.from + pick : here + STRIDE + pick - left) * 4
}

function setShown($: EngineInterface, k: Kami, isOn: boolean) {
  if (isOn === k.isOn) {
    return
  }
  k.isOn = isOn
  k.host = null
  k.drawnCell = null
  $.ui.invalidate('ui.render')
}

// Writes each of `wanted` that differs from what is set to the mod's /config
// row, which reloads the mod with it. Meanwhile the menu draws it, and
// showing, hiding and walking take it at once. Answers the first refusal, in
// words, the settings after it left unwritten; else undefined.
async function saveSettings(
  $: EngineInterface,
  k: Kami,
  wanted: Partial<Record<Field, string | undefined>>,
): Promise<string | undefined> {
  const now: Settings = { ...k.settings, ...k.pending }
  const changes: [Field, string][] = []
  for (const { field } of SETTINGS) {
    const value = wanted[field]
    if (value !== undefined && value !== now[field]) {
      changes.push([field, value])
      k.pending[field] = value
    }
  }
  if (changes.length === 0) {
    return undefined
  }
  if (wanted.show !== undefined) {
    setShown($, k, wanted.show !== 'off')
  }
  $.ui.invalidate('ui.render')
  const rows = await $.config.list().catch(() => [])
  const keyOf = (field: Field): string | undefined =>
    rows.find(row => row.key === `${$.plugin.name}.${field}`)?.key ??
    rows.find(row => row.key.startsWith($.plugin.name) && row.key.endsWith(`.${field}`))?.key
  for (const [i, [field, value]] of changes.entries()) {
    const key = keyOf(field)
    const answer = key === undefined ? { deny: 'không thấy dòng cài đặt' } : await $.config.set({ key, value })
    if (answer.deny !== undefined) {
      for (const [left] of changes.slice(i)) {
        delete k.pending[left]
      }
      setShown($, k, (k.pending.show ?? k.settings.show) !== 'off')
      $.ui.invalidate('ui.render')
      const label = SETTINGS.find(setting => setting.field === field)?.label ?? field
      note(k, `setting ${field}=${value} refused: ${answer.deny}`)

      return `Không lưu được “${label}”: ${answer.deny}`
    }
    note(k, `setting ${field}=${value}`)
  }

  return undefined
}

function blitAnswered(k: Kami, answer: { deny?: string }) {
  if (answer.deny === undefined) {
    k.denies = 0
    return
  }
  k.denies += 1
  if (k.denies === 1 || k.denies === DENIES_BEFORE_REDRAW) {
    note(k, `blit denied (${k.denies}): ${answer.deny}`)
  }
  if (k.denies >= DENIES_BEFORE_REDRAW && !k.isRedrawing) {
    k.isRedrawing = true
    note(k, 'swapping frames by redraws instead')
  }
}

// A sprite, read once: assets/sprites/sextant-<height>.json, which
// tools/blocks.py builds.
function spriteOf($: EngineInterface, k: Kami, entry: string): Promise<Sprite | null> {
  let load = k.spriteLoads.get(entry)
  if (load === undefined) {
    load = $.fs.read(`${$.plugin.root}/assets/sprites/${entry}.json`).then(
      text => {
        const sprite = JSON.parse(text) as Sprite
        const longest = Math.max(1, ...sprite.frames.map(frame => frame.length))
        k.longest.set(entry, longest)
        note(k, `sprite ${entry}: ${sprite.cols}x${sprite.rows}, ${sprite.frames.length} frames, longest ${longest}`)

        return sprite
      },
      (err: unknown) => {
        note(k, `sprite ${entry} load failed: ${String(err)}`)

        return null
      },
    )
    k.spriteLoads.set(entry, load)
  }

  return load
}

// The frame every host shows now, as ./dancer.tsx counts it.
function frameNow(fps: number, total: number): number {
  return Math.floor((Date.now() * fps) / 1000) % total
}

// The message's rows as laid out, when the guess matches the engine's count;
// else, missing it by DRIFT rows at most, the rows blurred over the miss.
function messageRows(k: Kami, site: Site, laidOut: number): Laid | null {
  const tries: { margin: number; extra: number }[] = []
  if (k.fit) {
    tries.push(k.fit)
  }
  for (const extra of [0, 1, -1]) {
    for (const margin of [0, 1, 2, 3, 4]) {
      tries.push({ margin, extra })
    }
  }
  for (const t of tries) {
    const rows = layout(site.key, site.columns, t.margin)
    if (rows === null) {
      return null
    }
    if (rows.length + t.extra === laidOut) {
      if (k.fit?.margin !== t.margin || k.fit?.extra !== t.extra) {
        note(k, `fit: margin ${t.margin}, extra ${t.extra}`)
      }
      k.fit = t
      // extra -1: the engine draws no blank row above; drop ours.
      return { rows: t.extra < 0 ? rows.slice(1) : rows, bands: [], right: site.columns }
    }
  }
  const t = k.fit ?? { margin: 0, extra: 0 }
  const rows = layout(site.key, site.columns, t.margin)
  const drift = rows === null ? Infinity : laidOut - (rows.length + t.extra)
  if (rows === null || Math.abs(drift) > DRIFT) {
    return null
  }
  const guessed = t.extra < 0 ? rows.slice(1) : rows
  note(k, `${site.id.slice(0, 8)} guess ${guessed.length} misses laid ${laidOut} by ${drift}: loose`)

  return { rows: blurred(guessed, laidOut, drift, site.columns), bands: [], right: site.columns, isLoose: true }
}

// She stays while any row of her spot is on screen. Else the spot to take,
// in any row: one wholly in view before one cut by the screen's edge, the
// best footing, the most of it shown, then the lowest, the last to scroll
// away.
function pickHost(k: Kami, box: Size): Host | null {
  const current = k.host === null ? undefined : k.sites.get(k.host.id)
  const kept = k.host?.spot
  if (current && kept && current.spots?.some(spot => isSame(spot, kept)) && shownOf(current.onScreen, kept, box) > 0) {
    return k.host
  }
  let best: { rank: number[]; host: Host } | null = null
  for (const site of k.sites.values()) {
    for (const spot of site.spots ?? []) {
      const shown = shownOf(site.onScreen, spot, box)
      if (shown === 0) {
        continue
      }
      const rank = [shown === tallOf(spot, box) ? 1 : 0, footing(spot), shown, site.seq, spot.top]
      if (best === null || isAhead(rank, best.rank)) {
        best = { rank, host: { id: site.id, spot } }
      }
    }
  }

  return best?.host ?? null
}

// Whether this terminal draws real pictures (kitty, Ghostty, or forced).
function terminalSeesPictures($: EngineInterface, k: Kami): Promise<boolean> {
  k.picturesLoad ??= Promise.all([
    $.env.get('KITTY_WINDOW_ID'),
    $.env.get('TERM'),
    $.env.get('TERM_PROGRAM'),
    $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES'),
  ]).then(
    values => seesPictures(k, values),
    () => false,
  )

  return k.picturesLoad
}

// Whether she is drawn as a real picture: where the terminal draws one,
// unless the person turned pictures off.
async function picturesOf($: EngineInterface, k: Kami): Promise<boolean> {
  return k.settings.pictures !== 'off' && (await terminalSeesPictures($, k))
}

// Whether she can be drawn in this terminal, and how; starts her clock.
async function lookFor($: EngineInterface, k: Kami, viewport: Drawing['viewport']): Promise<Look | null> {
  if (viewport?.isFullscreen === false) {
    if (!k.hasWarned) {
      k.hasWarned = true
      $.ui.toast('kami-dance: cô bé chỉ nhảy ở chế độ toàn màn hình. Gõ /tui fullscreen để bật.', {
        timeoutMs: 8000,
      })
      note(k, 'not fullscreen')
    }

    return null
  }
  const isPicture = await picturesOf($, k)
  const root = $.plugin.root
  const tall = Number(k.size) || 4
  let sprite: Sprite | null = null
  let entry = `${STYLE}-${k.size}`
  if (!isPicture) {
    sprite = await spriteOf($, k, entry)
    if (sprite === null) {
      entry = `${STYLE}-4`
      sprite = await spriteOf($, k, entry)
    }
  }
  // Her box: in pictures a column wider than she is where she walks by
  // quarters, so the shifted frames fit.
  const isQuartered = isPicture && k.hasWalkSet
  const box: Size | null = isPicture
    ? { cols: Math.max(1, Math.round(tall * 2 * PICTURE_ASPECT)) + (isQuartered ? 1 : 0), rows: tall }
    : sprite
  if (box === null || (viewport?.columns ?? 0) < box.cols + 10) {
    return null
  }
  if (!k.isTicking) {
    k.isTicking = true
    $.clock.every(Math.round(1000 / PICTURE_FPS), () => tick($, k, isPicture, isQuartered, root))
  }

  return { box, sprite, entry, isQuartered, root }
}

function tick($: EngineInterface, k: Kami, isPicture: boolean, isQuartered: boolean, root: string) {
  k.frame = (k.frame + 1) % PICTURE_FRAMES
  const here = k.host
  if (here === null || !k.isOn) {
    return
  }
  stepWalk(k, here.spot)
  // Into another column: the box moves on a redraw, which draws the frame
  // too; no swap into the old box meanwhile.
  if (Math.floor(k.walk.at / 4) !== k.drawnCell) {
    if (k.awaitTicks % 12 === 0) {
      $.ui.invalidate('ui.render')
    }
    k.awaitTicks += 1
    return
  }
  if (!isPicture) {
    // Near the end of the window of the dance she was handed: a redraw hands
    // her the next one. Asked again each half second until it is drawn.
    const w = k.window
    if (w && w.length < w.total && k.frame - k.windowAskedAt >= 6) {
      const into = (frameNow(w.fps, w.total) - w.first + w.total) % w.total
      if (into >= w.length - WINDOW_SLACK) {
        k.windowAskedAt = k.frame
        $.ui.invalidate('ui.render')
      }
    }
    return
  }
  if (k.isRedrawing) {
    $.ui.invalidate('ui.render')
    return
  }
  const quarter = isQuartered ? k.walk.at % 4 : 0
  const file = frameOf(k, root, k.frame, quarter)
  for (const key of k.pictureKeys) {
    void $.ui.blit({ requestId: here.id, key, source: { file, format: 'png' } }).then(
      answer => blitAnswered(k, answer),
      (err: unknown) => blitAnswered(k, { deny: String(err) }),
    )
  }
  if (isQuartered && here.spot.stand && quarter !== k.drawnStand) {
    k.drawnStand = quarter
    void $.ui
      .blit({ requestId: here.id, key: 'stand', source: { file: standOf(k, root, quarter), format: 'png' } })
      .then(
        answer => blitAnswered(k, answer),
        (err: unknown) => blitAnswered(k, { deny: String(err) }),
      )
  }
}

// Keeps the row's site up to date with what it shows and where it is, picks
// her host, and answers whether she stands in this row.
function visit(
  $: EngineInterface,
  k: Kami,
  kind: Kind,
  key: string,
  at: Drawing,
  look: Look,
  guess: (site: Site, laidOut: number) => Laid | null,
): { site: Site; spot: Spot } | null {
  const { box } = look
  const id = at.requestId
  const columns = at.viewport?.columns ?? 0
  let site = k.sites.get(id)
  if (site === undefined) {
    k.seq += 1
    site = { id, kind, seq: k.seq, key: '', columns: 0, onScreen: undefined, onScreenAt: 0, drewTree: false }
    k.sites.set(id, site)
  }
  if (site.key !== key || site.columns !== columns) {
    site.key = key
    site.columns = columns
    site.laidOut = undefined
    site.spots = undefined
  }

  const seen = at.onScreen
  const offset = k.treeOffset[kind]
  if (seen === null) {
    site.onScreen = null
    site.onScreenAt = ++k.screenTick
  } else if (seen !== undefined) {
    if (site.drewTree && site.laidOut !== undefined && seen.of !== site.laidOut - offset) {
      const learned = Math.min(1, Math.max(0, site.laidOut - seen.of))
      if (learned !== offset) {
        note(k, `${kind} treeOffset ${offset} -> ${learned} (laid out ${site.laidOut}, tree ${seen.of})`)
        k.treeOffset[kind] = learned
        $.ui.invalidate('ui.render')
      }
    }
    const shift = site.drewTree ? k.treeOffset[kind] : 0
    site.onScreen = { first: seen.first + shift, last: seen.last + shift, of: seen.of + shift }
    site.onScreenAt = ++k.screenTick
    site.laidOut ??= seen.of + shift
  }

  if (site.spots === undefined && site.laidOut !== undefined) {
    const laid = guess(site, site.laidOut)
    // A picture over a diff's coloured rows is drawn a strip a run of one
    // colour: STRIPS at most.
    const isPicture = look.sprite === null
    const rules: Rules = {
      canGround: laid?.isLoose !== true,
      fits: top => !isPicture || runsOf(laid?.bands, top, box.rows).length <= STRIPS,
    }
    site.spots = laid === null ? [] : findSpots(laid.rows, laid.right, box, rules)
    site.bands = laid?.bands
    const spots = site.spots.map(
      spot => `${spot.top},${spot.from}-${spot.to}${spot.stand ? '+stand' : ''}${spot.ground ? '+ground' : ''}`,
    )
    note(
      k,
      `#${site.seq} ${kind} ${id.slice(0, 8)} cols ${columns} laid ${site.laidOut} ` +
        `guess ${laid?.rows.length ?? 'none'}${laid?.isLoose ? ' loose' : ''} spots ${spots.join(' ') || 'none'}`,
    )
  }

  const nextHost = pickHost(k, box)
  const where = (h: Host | null): string =>
    h ? `${h.id.slice(0, 8)}@${h.spot.top}:${h.spot.from}-${h.spot.to}${h.spot.stand ? '+stand' : ''}` : 'none'
  if (where(nextHost) !== where(k.host)) {
    note(k, `host ${where(k.host)} -> ${where(nextHost)}`)
    if (nextHost !== null) {
      if (k.host?.id === nextHost.id && k.host.spot.top === nextHost.spot.top) {
        keepWalk(k, nextHost.spot)
      } else {
        k.seed = (hash(nextHost.id) ^ nextHost.spot.top) >>> 0 || 1
        startWalk(k, nextHost.spot)
      }
    }
    k.host = nextHost
    k.drawnCell = null
    $.ui.invalidate('ui.render')
  }

  const here = k.host
  if (here?.id !== id) {
    site.drewTree = false

    return null
  }
  site.drewTree = true

  return { site, spot: here.spot }
}

// Her box laid over the row: the dancer, and her stand under her. Her empty
// cells take the colour of the row under them, if it has one.
function overlay(k: Kami, parts: Parts, look: Look, site: Site, spot: Spot): RenderNode {
  const { Box, Client, Image, Text } = parts as unknown as Record<
    keyof Parts,
    (props: Record<string, unknown>) => RenderNode
  >
  const { box, sprite, entry, isQuartered, root } = look
  const cell = Math.floor(k.walk.at / 4)
  const quarter = isQuartered ? k.walk.at % 4 : 0
  k.drawnCell = cell
  k.drawnStand = quarter
  k.awaitTicks = 0
  const bandOf = (row: number): string | undefined => site.bands?.[spot.top + row]
  let dancer: RenderNode
  if (sprite === null) {
    // Her picture over each run of rows of one ground: the whole picture in a
    // box of that ground that shows only its rows, so the clear pixels show
    // the row's colour, not the terminal's.
    const source = { file: frameOf(k, root, k.frame, quarter), format: 'png' }
    const runs = runsOf(site.bands, spot.top, box.rows)
    const keys = runs.map((_, i) => (i === 0 ? 'dancer' : `dancer-${i}`))
    k.pictureKeys = keys
    const picture = (key: string) => <Image key={key} source={source} columns={box.cols} rows={box.rows} alt=" " />
    dancer =
      runs.length === 1 && runs[0]?.band === undefined ? (
        picture('dancer')
      ) : (
        <Box flexDirection="column" width={box.cols} height={box.rows} flexShrink={0}>
          {runs.map((run, i) => (
            <Box
              width={box.cols}
              height={run.to - run.from}
              flexShrink={0}
              overflow="hidden"
              backgroundColor={run.band}
            >
              <Box marginTop={-run.from} flexShrink={0}>
                {picture(keys[i] ?? 'dancer')}
              </Box>
            </Box>
          ))}
        </Box>
      )
  } else {
    const grounds = Array.from({ length: box.rows }, (_, row) => bandOf(row) ?? null)
    const hasGrounds = grounds.some(ground => ground !== null)
    // The window of the dance: kept while WINDOW_SLACK frames of it are left.
    const total = sprite.frames.length
    const length = Math.min(total, Math.max(WINDOW_SLACK * 2, Math.floor(WINDOW_CHARS / (k.longest.get(entry) ?? 1))))
    const now = frameNow(sprite.fps, total)
    const w = k.window
    const isKept =
      w !== null && w.entry === entry && (length === total || (now - w.first + total) % total < w.length - WINDOW_SLACK)
    const first = length === total ? 0 : isKept && w ? w.first : now
    k.window = { entry, first, length, total, fps: sprite.fps }
    const key = `${entry}|${first}|${length}|${hasGrounds ? grounds.join(',') : ''}`
    if (k.handed?.key !== key) {
      const frames = length === total ? sprite.frames : Array.from({ length }, (_, i) => sprite.frames[(first + i) % total] ?? '')
      k.handed = { key, sprite: { ...sprite, frames, first, total, ...(hasGrounds ? { grounds } : {}) } }
    }
    dancer = <Client key="dancer" module="./dancer.tsx" props={k.handed.sprite} width={box.cols} height={box.rows} />
  }
  // Her stand: the glowing disc where the walking frames are built, else a
  // row of thin bars under her middle.
  const standBand = bandOf(box.rows)
  const barWidth = Math.max(3, Math.round(box.cols * 0.6))
  const barLeft = Math.floor((box.cols - barWidth) / 2)
  const bars = ' '.repeat(barLeft) + '▔'.repeat(barWidth) + ' '.repeat(box.cols - barLeft - barWidth)
  const stand = !spot.stand ? null : isQuartered ? (
    <Box width={box.cols} height={1} flexShrink={0} backgroundColor={standBand}>
      <Image key="stand" source={{ file: standOf(k, root, quarter), format: 'png' }} columns={box.cols} rows={1} alt=" " />
    </Box>
  ) : (
    <Text key="stand" color={STAND_COLOR} backgroundColor={standBand}>
      {bars}
    </Text>
  )
  // The box of her whole walk, in the row's flow after the engine's drawing,
  // `laid` rows tall: pulled up to her top row, and the rows she takes given
  // back under her. It writes every cell of the walk, room either side of her
  // as spaces on the row's ground, so a step leaves nothing of her behind: the
  // terminal does not wipe what a box in the flow drew where it no longer is,
  // as it does for an absolute one.
  const tall = tallOf(spot, box)
  const laid = site.laidOut ?? spot.top + tall
  const at = Math.min(spot.to, Math.max(spot.from, cell))
  const room = (key: string, width: number) =>
    width <= 0 ? null : (
      <Box key={key} flexDirection="column" width={width} height={tall} flexShrink={0}>
        {Array.from({ length: tall }, (_, row) => (
          <Text backgroundColor={bandOf(row)}>{' '.repeat(width)}</Text>
        ))}
      </Box>
    )

  return (
    <Box
      key="spot"
      flexDirection="row"
      flexShrink={0}
      alignSelf="flex-start"
      width={spot.to - spot.from + box.cols}
      height={tall}
      marginTop={spot.top - laid}
      marginBottom={laid - spot.top - tall}
      marginLeft={spot.from}
    >
      {room('before', at - spot.from)}
      <Box flexDirection="column" width={box.cols} height={tall} flexShrink={0}>
        {dancer}
        {stand}
      </Box>
      {room('after', spot.to - at)}
    </Box>
  )
}

// ---- the module -------------------------------------------------------------

export const register: Register = (on, options) => {
  const settings = settingsOf(options)
  const k: Kami = {
    settings,
    pending: {},
    size: settings.size,
    hasWalkSet: WALK_SETS.has(settings.size),
    sites: new Map(),
    log: [],
    isLogDirty: false,
    seq: 0,
    screenTick: 0,
    host: null,
    walk: { at: 0, to: 0, wait: 0 },
    seed: 1,
    drawnCell: null,
    drawnStand: 0,
    pictureKeys: ['dancer'],
    awaitTicks: 0,
    isOn: settings.show !== 'off',
    hasWarned: false,
    treeOffset: { message: 0, diff: 0 },
    fit: null,
    frame: 0,
    isTicking: false,
    denies: 0,
    isRedrawing: false,
    spriteLoads: new Map(),
    longest: new Map(),
    handed: null,
    window: null,
    windowAskedAt: 0,
  }

  on('session.start', async ($, e, next) => {
    k.logPath = (await $.env.get('KAMI_DANCE_LOG')) || undefined
    await $.command.register({
      name: 'dance',
      description: 'Open the dancing girl’s settings, or set them: on/off, height',
      argumentHint: '[on|off] [3-15] (none: the settings menu)',
    })
    $.clock.every(2000, () => {
      const path = k.logPath
      if (k.isLogDirty && path) {
        k.isLogDirty = false
        void $.fs.write(path, `${k.log.join('\n')}\n`).catch(() => undefined)
      }
    })
    // A reload (a setting changed) draws the open menu again with what it brought.
    $.ui.invalidate('ui.render')

    return next(e)
  })

  // `/dance` alone opens the settings menu, and closes it when open;
  // `/dance off`, `/dance 6`, `/dance on 6` (either word, any order) set
  // those settings straight away.
  on('command.run', { command: 'dance' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (words.length === 0) {
      if ((await $.ui.panes()).some(pane => pane.id === SETTINGS_PANE)) {
        await $.ui.close({ id: SETTINGS_PANE })

        return { text: 'Đã đóng bảng cài đặt của cô bé.' }
      }
      await $.ui.open({
        id: SETTINGS_PANE,
        title: 'kami-dance: cài đặt',
        focus: true,
        closeOnEscape: true,
        rows: 24,
        columns: 60,
      })

      return { text: 'Đã mở bảng cài đặt của cô bé. Tab hoặc mũi tên để đi, Enter để chọn, Esc hoặc /dance để đóng.' }
    }
    const sizes = words.filter(word => SIZES.includes(word))
    const shows: string[] = words.filter(word => word === 'on' || word === 'off')
    const unknown = words.filter(word => !sizes.includes(word) && !shows.includes(word))
    if (unknown.length > 0 || sizes.length > 1 || shows.length > 1) {
      return { text: DANCE_HELP }
    }
    const before = { ...k.settings, ...k.pending }
    const deny = await saveSettings($, k, { show: shows[0], size: sizes[0] })
    if (deny !== undefined) {
      return { text: deny }
    }
    const now = { ...k.settings, ...k.pending }
    if (sizes.length === 0) {
      return { text: `Cô bé nhảy múa: ${choiceOf('show', now.show)}` }
    }
    if (now.size === before.size) {
      return { text: `Cô bé đã cao ${now.size} dòng.` }
    }

    return { text: `Cô bé: cao ${now.size} dòng. Mod nạp lại với cài đặt mới.` }
  })

  // The settings menu: a row a setting, each choice a button, the one set
  // marked; under it, how she is drawn here and a look at her as set.
  on('ui.render', { component: 'Pane', requestId: SETTINGS_PANE }, async ($, e) => {
    const { Box, Button, Text } = $.ui.resolve(e)
    const now: Settings = { ...k.settings, ...k.pending }
    const pick = (field: Field, value: string) => async () => {
      const deny = await saveSettings($, k, { [field]: value })
      if (deny !== undefined) {
        $.ui.toast(`kami-dance: ${deny}`, { timeoutMs: 8000 })
      }
    }
    const control = (setting: Setting, isFirst: boolean) => {
      const value = now[setting.field]
      if (setting.field === 'size') {
        const at = SIZES.indexOf(value)
        const step = (by: number) => {
          const to = SIZES[at + by]
          return to === undefined ? () => undefined : pick('size', to)
        }

        return (
          <Box flexDirection="row" columnGap={1}>
            <Button key="size-down" dimColor={at <= 0} onPress={step(-1)}>
              −
            </Button>
            <Text color={STAND_COLOR} bold>
              {`${value} dòng`}
            </Text>
            <Button key="size-up" dimColor={at >= SIZES.length - 1} onPress={step(1)}>
              +
            </Button>
            <Text dimColor>(3 đến 15)</Text>
          </Box>
        )
      }

      return (
        <Box flexDirection="row" flexWrap="wrap" columnGap={2} flexShrink={1}>
          {setting.choices.map(choice => {
            const isSet = choice.value === value

            return (
              <Button
                key={`${setting.field}-${choice.value}`}
                plain
                {...(isFirst && isSet ? { autoFocus: true as const } : {})}
                onPress={pick(setting.field, choice.value)}
              >
                {isSet ? (
                  <Text color={STAND_COLOR} bold>
                    {`● ${choice.label}`}
                  </Text>
                ) : (
                  <Text dimColor>{`○ ${choice.label}`}</Text>
                )}
              </Button>
            )
          })}
        </Box>
      )
    }

    const rows = (
      <Box flexDirection="column">
        {SETTINGS.map((setting, i) => (
          <Box flexDirection="row">
            <Box width={LABEL_COLS} flexShrink={0}>
              <Text bold>{setting.label}</Text>
            </Box>
            {control(setting, i === 0)}
          </Box>
        ))}
      </Box>
    )
    const buttons = (
      <Box flexDirection="row" columnGap={2} marginTop={1}>
        <Button key="close" role="dismiss" onPress={() => void $.ui.close({ id: SETTINGS_PANE })}>
          đóng
        </Button>
      </Box>
    )
    const help = <Text dimColor>Tab hoặc mũi tên: đi giữa các nút · Enter: chọn · Esc: đóng</Text>
    if (e.surface !== 'terminal') {
      return (
        <Box flexDirection="column">
          {rows}
          {buttons}
        </Box>
      )
    }

    // How she is drawn in this terminal with these settings, and a look at
    // her as set: a picture's first frame, or the block characters dancing.
    const { Client, Image } = $.ui.resolve(e)
    const canPicture = await terminalSeesPictures($, k)
    const isPicture = canPicture && now.pictures !== 'off'
    const drawnAs = isPicture
      ? 'Terminal này vẽ ảnh thật, nên cô là ảnh thật.'
      : canPicture
        ? 'Ảnh thật tắt: cô được vẽ bằng ký tự khối (sextant).'
        : 'Terminal này không vẽ ảnh thật: cô được vẽ bằng ký tự khối (sextant).'
    const tall = Number(now.size) || 4
    let preview: RenderNode | null = null
    if (isPicture) {
      const cols = Math.max(1, Math.round(tall * 2 * PICTURE_ASPECT))
      preview = (
        <Image
          key="preview"
          source={{ file: `${$.plugin.root}/assets/png/f0000.png`, format: 'png' }}
          columns={cols}
          rows={tall}
          alt=" "
        />
      )
    } else {
      const entry = `${STYLE}-${now.size}`
      const sprite = await spriteOf($, k, entry)
      if (sprite !== null) {
        const count = Math.max(1, Math.floor(WINDOW_CHARS / (k.longest.get(entry) ?? 1)))
        const sample = { ...sprite, frames: sprite.frames.slice(0, Math.min(SAMPLE_FRAMES, count)) }
        preview = (
          <Client
            key={`preview-${entry}`}
            module="./dancer.tsx"
            props={sample}
            width={sprite.cols}
            height={sprite.rows}
          />
        )
      }
    }

    return (
      <Box flexDirection="column">
        {rows}
        {buttons}
        {help}
        <Box flexDirection="column" marginTop={1}>
          <Text dimColor>{drawnAs}</Text>
          <Text dimColor>
            Theme auto: Claude không cho mod biết nền terminal sáng hay tối; chọn đúng để màu quanh cô trong diff
            khớp.
          </Text>
          <Text dimColor>Cài đặt được lưu cho mọi phiên sau; mỗi lần đổi, mod nạp lại.</Text>
        </Box>
        {preview !== null && <Box marginTop={1}>{preview}</Box>}
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !k.isOn || k.settings.places === 'diffs') {
      return next(e)
    }
    const look = await lookFor($, k, e.viewport)
    if (look === null) {
      return next(e)
    }
    const at = { requestId: e.requestId, viewport: e.viewport, onScreen: e.props.onScreen }
    const here = visit($, k, 'message', e.props.text, at, look, (site, laidOut) => messageRows(k, site, laidOut))
    if (here === null) {
      return next(e)
    }
    const parts = $.ui.resolve(e)
    const { Box } = parts

    return (
      <Box flexDirection="column">
        {await next(e)}
        {overlay(k, parts, look, here.site, here.spot)}
      </Box>
    )
  })

  // A file change's diff: its patch says what each row holds.
  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (
      e.surface !== 'terminal' ||
      !k.isOn ||
      k.settings.places === 'messages' ||
      !DIFF_TOOLS.has(e.props.tool) ||
      e.props.isErrored
    ) {
      return next(e)
    }
    const output = e.props.output as { structuredPatch?: readonly Hunk[]; staged?: boolean } | undefined
    const patch = output?.structuredPatch
    if (!Array.isArray(patch) || patch.length === 0 || output?.staged) {
      return next(e)
    }
    const look = await lookFor($, k, e.viewport)
    if (look === null) {
      return next(e)
    }
    const key = patch
      .map(hunk => `${hunk.oldStart},${hunk.oldLines},${hunk.newStart},${hunk.newLines}\n${hunk.lines.join('\n')}`)
      .join('\n@@ ')
    k.groundsLoad ??= $.config.list().then(
      rows => {
        const theme = String(rows.find(row => row.key === 'theme')?.value ?? 'auto')
        const ground = theme === 'auto' ? k.settings.autoTheme : theme
        note(k, `theme ${theme}${theme === 'auto' ? ` (as ${ground})` : ''}`)

        return DIFF_GROUNDS[ground] ?? null
      },
      () => null,
    )
    const grounds = await k.groundsLoad
    const guess = (site: Site, laidOut: number): Laid | null => {
      const laid = diffLayout(patch, site.columns, grounds)

      return laid.rows.length === laidOut ? laid : null
    }
    const at = { requestId: e.requestId, viewport: e.viewport, onScreen: e.props.onScreen }
    const here = visit($, k, 'diff', key, at, look, guess)
    if (here === null) {
      return next(e)
    }
    const parts = $.ui.resolve(e)
    const { Box } = parts

    return (
      <Box flexDirection="column">
        {await next(e)}
        {overlay(k, parts, look, here.site, here.spot)}
      </Box>
    )
  })
}
