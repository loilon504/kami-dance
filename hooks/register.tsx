import type { EngineInterface, Register, RenderNode } from 'claude-code'

// The dancer of "Shukusei!! Loli Kami Requiem" over the chat.
//
// She rides inside one transcript row's drawing, in a box laid over empty
// room to the right of its words, so she scrolls with them. Two kinds of row
// host her: an assistant message, whose rows are guessed from its markdown,
// and a file change's diff (Edit, Write), whose rows come from its patch.
// Each guess is checked against the rows the terminal really laid out
// (`onScreen.of`); only a row whose guess holds can host her. In a diff she
// stands in the empty right end of the red and green rows, her empty cells
// painted in the row's colour.
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
// heights she steps whole columns with the plain frames in assets/png.
// Elsewhere she is drawn in block characters from assets/sprites/<style>-
// <height>.json (heights 3 to 8 as first drawn, 9 to 15 by tools/blocks.py) by
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
// her room ends at.
type Laid = { rows: number[]; bands: (string | undefined)[]; right: number }

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
// read: it is taken as light, the theme this mod's owner uses. Under another
// theme the rows' colour is unknown and a diff hosts her only beside the
// rows it leaves uncoloured.
type Grounds = { removed: string; added: string }
const DIFF_GROUNDS: Record<string, Grounds> = {
  light: { removed: '#ffdcdc', added: '#dcffdc' },
  auto: { removed: '#ffdcdc', added: '#dcffdc' },
  dark: { removed: '#3d0100', added: '#022800' },
}
// The mod writes its log only where KAMI_DANCE_LOG names a file for it, each
// session its own.
const STYLES_PANE = 'kami-styles'
// What `/dance` takes, as the mod's /config rows (plugin.json) offer it.
const SIZES = Array.from({ length: 13 }, (_, i) => String(i + 3))
const STYLES = ['half', 'sextant', 'octant', 'braille']
const DANCE_HELP = [
  'Cách dùng /dance:',
  '  /dance               bật hoặc tắt cô bé',
  '  /dance on | off      bật, tắt',
  '  /dance 6             cao 6 dòng (3 đến 15)',
  '  /dance octant        kiểu vẽ: half, sextant, octant, braille',
  '  /dance 6 octant      đổi cả hai',
  '/dance-styles cho xem các kiểu vẽ cạnh nhau.',
].join('\n')

// The side-by-side test of the styles: entry, label. A tree carries 100,000
// characters of Client props in all, so each sample keeps its first ten
// seconds.
const SAMPLES: [string, string][][] = [
  [
    ['half-4', '1 · half'],
    ['sextant-4', '2 · sextant'],
    ['octant-4', '3 · octant'],
    ['braille-4', '4 · braille'],
  ],
  [
    ['half-8', '5 · half, 8'],
    ['octant-8', '6 · octant, 8'],
  ],
]
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
  }
  if (!flushTable()) {
    return null
  }
  while (rows.length > 1 && rows[rows.length - 1] === 0) {
    rows.pop()
  }

  return rows
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
// a line of words where that line is the row under her. She walks the right
// end of the room, ROAM columns at most. Returned top to bottom.
function findSpots(rows: number[], right: number, box: Size): Spot[] {
  const found: Spot[] = []
  const hi = right - EDGE - box.cols
  // The row under her is inside the message: words to stand on, or room for
  // the stand.
  for (let top = 0; top + box.rows < rows.length; top++) {
    let used = 0
    for (let r = top; r < top + box.rows; r++) {
      used = Math.max(used, rows[r] ?? 0)
    }
    const lo = Math.max(2, used + GAP)
    const below = rows[top + box.rows] ?? 0
    const clear = Math.max(lo, below + GAP)
    if (hi >= clear) {
      const onGround = Math.min(hi, (rows[top + box.rows + 1] ?? 0) - box.cols)
      found.push(
        onGround >= clear
          ? { top, from: Math.max(clear, onGround - ROAM), to: onGround, stand: true, ground: true }
          : { top, from: Math.max(clear, hi - ROAM), to: hi, stand: true, ground: false },
      )
    }
    const onWords = Math.min(hi, below - box.cols)
    if (onWords >= lo) {
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
  size: string
  style: string
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
  // Each sprite read (assets/sprites/<style>-<height>.json), by its name.
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
// there, a pause, then a new place at least STRIDE columns off.
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

// A sprite, read once: assets/sprites/<style>-<height>.json, which
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

// The message's rows as laid out, when the guess matches the engine's count.
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

  return null
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
  k.picturesLoad ??= Promise.all([
    $.env.get('KITTY_WINDOW_ID'),
    $.env.get('TERM'),
    $.env.get('TERM_PROGRAM'),
    $.env.get('CLAUDE_CODE_FORCE_TERMINAL_IMAGES'),
  ]).then(
    values => seesPictures(k, values),
    () => false,
  )
  const isPicture = await k.picturesLoad
  const root = $.plugin.root
  const tall = Number(k.size) || 4
  let sprite: Sprite | null = null
  let entry = `${k.style}-${k.size}`
  if (!isPicture) {
    sprite = await spriteOf($, k, entry)
    if (sprite === null) {
      entry = 'half-4'
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
  void $.ui
    .blit({ requestId: here.id, key: 'dancer', source: { file: frameOf(k, root, k.frame, quarter), format: 'png' } })
    .then(
      answer => blitAnswered(k, answer),
      (err: unknown) => blitAnswered(k, { deny: String(err) }),
    )
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
  box: Size,
  guess: (site: Site, laidOut: number) => Laid | null,
): { site: Site; spot: Spot } | null {
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
    site.spots = laid === null ? [] : findSpots(laid.rows, laid.right, box)
    site.bands = laid?.bands
    const spots = site.spots.map(
      spot => `${spot.top},${spot.from}-${spot.to}${spot.stand ? '+stand' : ''}${spot.ground ? '+ground' : ''}`,
    )
    note(
      k,
      `#${site.seq} ${kind} ${id.slice(0, 8)} cols ${columns} laid ${site.laidOut} ` +
        `guess ${laid?.rows.length ?? 'none'} spots ${spots.join(' ') || 'none'}`,
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
    dancer = (
      <Image
        key="dancer"
        source={{ file: frameOf(k, root, k.frame, quarter), format: 'png' }}
        columns={box.cols}
        rows={box.rows}
        alt=" "
      />
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
  const bars = ' '.repeat(barLeft) + '▔'.repeat(barWidth) + (standBand ? ' '.repeat(box.cols - barLeft - barWidth) : '')
  const stand = !spot.stand ? null : isQuartered ? (
    <Image key="stand" source={{ file: standOf(k, root, quarter), format: 'png' }} columns={box.cols} rows={1} alt=" " />
  ) : (
    <Text key="stand" color={STAND_COLOR} backgroundColor={standBand}>
      {bars}
    </Text>
  )

  return (
    <Box key="spot" position="absolute" top={spot.top - k.treeOffset[site.kind]} left={cell} flexDirection="column">
      {dancer}
      {stand}
    </Box>
  )
}

// ---- the module -------------------------------------------------------------

export const register: Register = (on, options) => {
  const size = typeof options.size === 'string' ? options.size : '4'
  const k: Kami = {
    size,
    style: typeof options.style === 'string' ? options.style : 'half',
    hasWalkSet: WALK_SETS.has(size),
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
    awaitTicks: 0,
    isOn: true,
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
      description: 'Show or hide the dancing girl, or set her height and drawing style',
      argumentHint: '[on|off] [3-15] [half|sextant|octant|braille]',
    })
    await $.command.register({ name: 'dance-styles', description: 'Show the dancer in each drawing style side by side' })
    $.clock.every(2000, () => {
      const path = k.logPath
      if (k.isLogDirty && path) {
        k.isLogDirty = false
        void $.fs.write(path, `${k.log.join('\n')}\n`).catch(() => undefined)
      }
    })

    return next(e)
  })

  // `/dance` shows or hides her; `/dance 6 octant` (either word, any order)
  // sets her height and style in the mod's own /config rows, which reloads
  // the mod with them.
  on('command.run', { command: 'dance' }, async ($, e) => {
    const words = e.args.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const sizes = words.filter(word => SIZES.includes(word))
    const styles = words.filter(word => STYLES.includes(word))
    const shows: string[] = words.filter(word => word === 'on' || word === 'off')
    const unknown = words.filter(word => !sizes.includes(word) && !styles.includes(word) && !shows.includes(word))
    if (unknown.length > 0 || sizes.length > 1 || styles.length > 1 || shows.length > 1) {
      return { text: DANCE_HELP }
    }
    const show = shows[0]
    if (words.length === 0 || show !== undefined) {
      const isOn = show === undefined ? !k.isOn : show === 'on'
      if (isOn !== k.isOn) {
        k.isOn = isOn
        k.host = null
        k.drawnCell = null
        $.ui.invalidate('ui.render')
      }
      if (sizes.length === 0 && styles.length === 0) {
        return { text: k.isOn ? 'Cô bé nhảy múa: bật' : 'Cô bé nhảy múa: tắt' }
      }
    }
    const rows = await $.config.list()
    const keyOf = (field: string): string | undefined =>
      rows.find(row => row.key === `${$.plugin.name}.${field}`)?.key ??
      rows.find(row => row.key.startsWith($.plugin.name) && row.key.endsWith(`.${field}`))?.key
    const changes: [string, string][] = []
    if (sizes[0] !== undefined && sizes[0] !== k.size) {
      changes.push(['size', sizes[0]])
    }
    if (styles[0] !== undefined && styles[0] !== k.style) {
      changes.push(['style', styles[0]])
    }
    if (changes.length === 0) {
      return { text: `Cô bé đã cao ${k.size} dòng, kiểu ${k.style}.` }
    }
    for (const [field, value] of changes) {
      const key = keyOf(field)
      const answer = key === undefined ? { deny: 'không thấy dòng cài đặt' } : await $.config.set({ key, value })
      if (answer.deny !== undefined) {
        return { text: `Không đổi được ${field === 'size' ? 'chiều cao' : 'kiểu vẽ'}: ${answer.deny}` }
      }
    }
    const size = sizes[0] ?? k.size
    const style = styles[0] ?? k.style

    return { text: `Cô bé: cao ${size} dòng, kiểu ${style}. Mod nạp lại với cài đặt mới.` }
  })

  on('command.run', { command: 'dance-styles' }, async $ => {
    if ((await $.ui.panes()).some(pane => pane.id === STYLES_PANE)) {
      await $.ui.close({ id: STYLES_PANE })

      return { text: 'Đã đóng bảng kiểu vẽ.' }
    }
    await $.ui.open({ id: STYLES_PANE, title: 'kami-dance: kiểu vẽ' })

    return { text: 'Đã mở bảng kiểu vẽ. Gõ /dance-styles lần nữa để đóng.' }
  })

  on('ui.render', { component: 'Pane', requestId: STYLES_PANE }, async ($, e) => {
    if (e.surface !== 'terminal') {
      const { Text } = $.ui.resolve(e)

      return <Text>The dancer draws in the terminal only.</Text>
    }
    const { Box, Client, Text } = $.ui.resolve(e)
    const entries = SAMPLES.flat().map(([entry]) => entry)
    const loaded = await Promise.all(entries.map(entry => spriteOf($, k, entry)))
    const catalog = new Map(entries.map((entry, i) => [entry, loaded[i]]))
    if (loaded.every(sprite => sprite === null)) {
      return <Text>Không đọc được hình trong assets/sprites.</Text>
    }

    return (
      <Box flexDirection="column">
        <Text>Ô nào hiện dấu hỏi, ô vuông rỗng hay chữ lạ là terminal không vẽ được kiểu đó.</Text>
        {SAMPLES.map(row => (
          <Box flexDirection="row" marginTop={1}>
            {row.map(([entry, label]) => {
              const sprite = catalog.get(entry)
              if (!sprite) {
                return null
              }
              const sample = { ...sprite, frames: sprite.frames.slice(0, SAMPLE_FRAMES) }

              return (
                <Box flexDirection="column" marginRight={3}>
                  <Client key={entry} module="./dancer.tsx" props={sample} width={sprite.cols} height={sprite.rows} />
                  <Text dimColor>{label}</Text>
                </Box>
              )
            })}
          </Box>
        ))}
        <Text>
          Đổi bằng /dance kèm chiều cao và kiểu, ví dụ /dance 6 octant (cao 3 đến 15 dòng; half, sextant, octant,
          braille). Đang dùng: {k.style}, {k.size} dòng.
        </Text>
      </Box>
    )
  })

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal' || !k.isOn) {
      return next(e)
    }
    const look = await lookFor($, k, e.viewport)
    if (look === null) {
      return next(e)
    }
    const at = { requestId: e.requestId, viewport: e.viewport, onScreen: e.props.onScreen }
    const here = visit($, k, 'message', e.props.text, at, look.box, (site, laidOut) => messageRows(k, site, laidOut))
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
    if (e.surface !== 'terminal' || !k.isOn || !DIFF_TOOLS.has(e.props.tool) || e.props.isErrored) {
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
        note(k, `theme ${theme}`)

        return DIFF_GROUNDS[theme] ?? null
      },
      () => null,
    )
    const grounds = await k.groundsLoad
    const guess = (site: Site, laidOut: number): Laid | null => {
      const laid = diffLayout(patch, site.columns, grounds)

      return laid.rows.length === laidOut ? laid : null
    }
    const at = { requestId: e.requestId, viewport: e.viewport, onScreen: e.props.onScreen }
    const here = visit($, k, 'diff', key, at, look.box, guess)
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
