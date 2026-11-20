import type { ClientSurface } from 'claude-code'

// The surface module that animates the dancer where the terminal draws, on
// its own frame clock, so no frame crosses back to the hooks module.
//
// A frame is code points, cell by cell, row-major: '.' for an empty cell,
// else three: the glyph (a half block, sextant, octant or braille pattern),
// the fg palette letter and the bg palette letter ('.' for the terminal's own
// ground). The pictures come from assets/sprites (tools/blocks.py). `grounds`, when
// given, is each row's ground where the terminal's own would cut a hole in a
// coloured row under her (a diff's red or green): a theme key or colour.

type Sprite = {
  style: string
  cols: number
  rows: number
  fps: number
  palette: string[]
  alphabet: string
  frames: string[]
  grounds?: (string | null)[]
  first?: number
  total?: number
}

type State = { tick: number }

type Run = { text: string; color?: string; backgroundColor?: string }

const EMPTY = '.'

// The frame to draw now. Every host draws the same frame at the same moment,
// so the dance goes on without a restart when she moves to another message.
// `frames` may be a window of the dance, frames `first` on of `total`: past
// its end (the next window not handed yet) its last frame waits.
function frameOf(sprite: Sprite, tick: number): string {
  const total = sprite.total ?? sprite.frames.length
  const first = sprite.first ?? 0
  const now = globalThis.Date?.now?.()
  const step = typeof now === 'number' ? Math.floor((now * sprite.fps) / 1000) : tick
  const into = (((step % total) - first) % total + total) % total

  return sprite.frames[Math.min(into, sprite.frames.length - 1)] ?? ''
}

function colour(sprite: Sprite, letter: string | undefined): string | undefined {
  if (letter === undefined || letter === EMPTY) {
    return undefined
  }

  return sprite.palette[sprite.alphabet.indexOf(letter)]
}

function lines(sprite: Sprite, frame: string): Run[][] {
  const points = Array.from(frame)
  const out: Run[][] = []
  let at = 0

  for (let row = 0; row < sprite.rows; row++) {
    const ground = sprite.grounds?.[row] ?? undefined
    const runs: Run[] = []
    for (let col = 0; col < sprite.cols; col++) {
      const glyph = points[at]
      let cell: Run
      if (glyph === undefined || glyph === EMPTY) {
        cell = { text: ' ', backgroundColor: ground }
        at += 1
      } else {
        cell = { text: glyph, color: colour(sprite, points[at + 1]), backgroundColor: colour(sprite, points[at + 2]) ?? ground }
        at += 3
      }
      const last = runs[runs.length - 1]
      if (last && last.color === cell.color && last.backgroundColor === cell.backgroundColor) {
        last.text += cell.text
      } else {
        runs.push(cell)
      }
    }
    out.push(runs)
  }

  return out
}

export default function Dancer(sprite: Sprite, surface: ClientSurface<State>) {
  const { Box, Text } = surface.elements

  if (surface.state === undefined) {
    let tick = 0
    surface.every(Math.max(16, Math.round(1000 / sprite.fps)), () => {
      tick += 1
      surface.setState({ tick })
    })
    surface.setState({ tick })
  }

  const frame = frameOf(sprite, surface.state?.tick ?? 0)

  return (
    <Box flexDirection="column">
      {lines(sprite, frame).map(runs => (
        <Text>
          {runs.map(run => (
            <Text color={run.color} backgroundColor={run.backgroundColor}>
              {run.text}
            </Text>
          ))}
        </Text>
      ))}
    </Box>
  )
}
