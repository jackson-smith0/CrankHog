// The four example files the format guide shows (docs/WORKOUT-FORMAT.md and
// the in-app guide). Tests parse each one and check what it adds up to, and
// that the doc quotes each verbatim, so the guide and the parser stay in step.

export interface SessionExample {
  fileName: string
  /** What it shows, in a sentence. */
  about: string
  text: string
}

export const SESSION_EXAMPLES: readonly SessionExample[] = [
  {
    fileName: '2026-12-02_Threshold 4x8.txt',
    about: 'A run with a repeated main set: heart-rate zones for the easy parts, a pace range for the efforts.',
    text: `sport: run
name: Threshold 4x8

Warmup
- 15m Z2 HR

Main set 4x
- 8m 4:10-4:20/km Pace
- 2m Z1 HR

Cooldown
- 10m Z1 HR
`,
  },
  {
    fileName: '2026-12-03_CSS 10x100.txt',
    about: 'A pool swim in metres, with drills, rests and a main set at a pace per 100 m.',
    text: `sport: swim
name: CSS 10x100
pool: 25m

Warmup
- 400mtr easy

Drills 4x
- 50mtr drill
- 15s rest

Main set 10x
- 100mtr 1:40/100m Pace
- 15s rest

Cooldown
- 200mtr easy
`,
  },
  {
    fileName: '2026-12-04_Squash.txt',
    about: 'A session with no steps: just how long and how hard.',
    text: `sport: other
name: Squash
duration: 60m
effort: hard
`,
  },
  {
    fileName: 'Easy 8k.txt',
    about: 'No date in the name, so it goes to the library to plan later.',
    text: `sport: run
name: Easy 8k
distance: 8km
effort: easy
`,
  },
]
