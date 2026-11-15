// The format guide for run, swim and other session files: the rules, the
// header lines, the steps, and the four examples (from @core/multisport/
// examples, which the tests parse). docs/WORKOUT-FORMAT.md says the same.
import { useState } from 'react'
import { Copy, Download, HelpCircle } from 'lucide-react'
import { strToU8, zipSync } from 'fflate'
import { SESSION_EXAMPLES } from '@core/multisport/examples'
import { bridge } from '../../platform/bridge'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'

const HEADERS: [string, string, string, string][] = [
  ['sport', 'Yes, for anything that isn’t a bike workout', 'run, swim, other', 'The card’s icon, and the weekly volume row it counts in'],
  ['name', 'No', 'Text', 'The card’s title. Without it, the file name without its date'],
  ['date', 'No', 'YYYY-MM-DD', 'The day it goes on. Wins over the date in the file name'],
  ['pool', 'No, swims only', '25m, 50m, 25y', 'Shown with the swim. A distance that isn’t whole lengths gets a warning'],
  ['duration', 'For a session with no steps', '45m, 1h, 1h15m', 'Planned time'],
  ['distance', 'No, sessions with no steps', '8km, 5mi, 2000mtr, 1650y', 'Planned distance'],
  ['effort', 'No, sessions with no steps', 'easy, moderate, hard, max', 'Planned load: 40, 60, 80 or 100 TSS an hour (moderate when left out)'],
  ['notes', 'No', 'One line of text', 'Shown when you open the session'],
]

function Code({ children }: { children: string }) {
  return <code className="rounded bg-panel-3 px-1 py-0.5 font-mono text-[12px]">{children}</code>
}

async function saveExamples() {
  const files = Object.fromEntries(SESSION_EXAMPLES.map((e) => [e.fileName, strToU8(e.text)]))
  await bridge().invoke('files.saveAs', { defaultName: 'CrankHog session examples.zip', bytes: zipSync(files), filters: [{ name: 'Zip', extensions: ['zip'] }] })
}

/** The guide itself. */
export function FormatGuide() {
  const [copied, setCopied] = useState<string | null>(null)
  const copy = (name: string, text: string) =>
    void navigator.clipboard
      ?.writeText(text)
      .then(() => setCopied(name))
      .catch(() => undefined)
  return (
    <div className="space-y-5 text-sm leading-relaxed" data-testid="format-guide">
      <section>
        <h3 className="font-display text-base font-semibold">One session per file</h3>
        <p className="mt-1 text-ink-dim">
          A plain text file ending in <Code>.txt</Code>. Header lines first, then a blank line, then the steps. The steps are intervals.icu’s workout text, so the same lines work there. The header is CrankHog’s and is left out when a session goes to intervals.icu.
        </p>
      </section>
      <section>
        <h3 className="font-display text-base font-semibold">The file name sets the day</h3>
        <p className="mt-1 text-ink-dim">
          <Code>2026-12-02_Threshold 4x8.txt</Code> goes on 2 December. Without a date the session goes to the library, or into a plan’s next day. A <Code>date:</Code> line wins over the file name.
        </p>
      </section>
      <section>
        <h3 className="font-display text-base font-semibold">Header lines</h3>
        <p className="mt-1 text-ink-dim">
          One <Code>key: value</Code> per line, in any order.
        </p>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="eyebrow text-ink-faint">
              <tr>
                <th className="py-1 pr-3">Key</th>
                <th className="py-1 pr-3">Needed</th>
                <th className="py-1 pr-3">Values</th>
                <th className="py-1">On the calendar</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {HEADERS.map(([k, req, vals, what]) => (
                <tr key={k}>
                  <td className="py-1.5 pr-3 font-mono">{k}</td>
                  <td className="py-1.5 pr-3 text-ink-dim">{req}</td>
                  <td className="py-1.5 pr-3 font-mono text-ink-dim">{vals}</td>
                  <td className="py-1.5 text-ink-dim">{what}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <section>
        <h3 className="font-display text-base font-semibold">Steps</h3>
        <ol className="mt-1 list-decimal space-y-1 pl-5 text-ink-dim">
          <li>
            A step is a line starting with <Code>- </Code>, then a length, then at most one target, then any words.
          </li>
          <li>
            Time: <Code>30s</Code>, <Code>10m</Code>, <Code>1h</Code>, <Code>1h20m</Code>, <Code>5m30s</Code>. <strong className="text-ink">m always means minutes.</strong> Distance: <Code>400mtr</Code> (metres), <Code>1km</Code>, <Code>1.5km</Code>, <Code>1mi</Code>, <Code>100y</Code> (yards).
          </li>
          <li>
            Targets: a pace (<Code>4:30/km Pace</Code>, <Code>7:15/mi Pace</Code>, <Code>1:45/100m Pace</Code>, <Code>1:35/100y Pace</Code>, or a range <Code>4:20-4:40/km Pace</Code>); a percent of threshold pace (<Code>95% Pace</Code>, <Code>90-95% Pace</Code>); a pace zone (<Code>Z3 Pace</Code>); a heart rate (<Code>Z2 HR</Code>, <Code>75% LTHR</Code>, <Code>140-150bpm</Code>). No target means easy; words like <Code>easy</Code>, <Code>drill</Code>, <Code>kick</Code>, <Code>pull</Code> or <Code>fins</Code> stay as the step’s note.
          </li>
          <li>
            Rest: <Code>- 20s rest</Code>.
          </li>
          <li>
            Repeats: a line ending in a count, like <Code>Main set 4x</Code> or just <Code>4x</Code>, repeats the steps under it up to the next blank line. One level only: to repeat a set inside a set, write it out.
          </li>
          <li>
            Any other line, like <Code>Warmup</Code>, is a section title.
          </li>
          <li>
            A file with no steps is a planned session, like a squash game or an easy run. It needs a <Code>duration</Code> or a <Code>distance</Code>.
          </li>
        </ol>
      </section>
      <section>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-display text-base font-semibold">Examples</h3>
          <Button size="sm" onClick={() => void saveExamples()} data-testid="save-examples">
            <Download className="size-3.5" /> Save examples
          </Button>
        </div>
        <div className="mt-2 grid gap-3 md:grid-cols-2">
          {SESSION_EXAMPLES.map((e) => (
            <figure key={e.fileName} className="rounded-xl border border-line bg-panel-2 p-3">
              <figcaption className="flex items-start justify-between gap-2">
                <span>
                  <span className="block font-mono text-xs font-semibold">{e.fileName}</span>
                  <span className="text-xs text-ink-faint">{e.about}</span>
                </span>
                <Button size="iconSm" variant="ghost" onClick={() => copy(e.fileName, e.text)} aria-label={`Copy ${e.fileName}`}>
                  <Copy className="size-3.5" />
                </Button>
              </figcaption>
              <pre className="mt-2 overflow-x-auto font-mono text-[12px] leading-snug">{e.text}</pre>
              {copied === e.fileName && <div className="text-xs text-good">Copied</div>}
            </figure>
          ))}
        </div>
      </section>
      <section>
        <h3 className="font-display text-base font-semibold">How the calendar’s numbers are worked out</h3>
        <ul className="mt-1 list-disc space-y-1 pl-5 text-ink-dim">
          <li>
            <strong className="text-ink">Time.</strong> Time steps add up as written. Distance steps use your threshold run pace or swim threshold pace (CSS) from Settings, Athlete; a step with no target is easy (75 % of threshold for runs, 80 % for swims). Without the threshold, a distance-only session shows its distance and no time.
          </li>
          <li>
            <strong className="text-ink">Load.</strong> Pace steps score by pace against threshold, heart-rate steps by your threshold heart rate, zones by their middle, and a session with no steps by its effort. Without what it needs the load is blank, never 0.
          </li>
        </ul>
      </section>
    </div>
  )
}

/** "Format guide": opens the guide in a dialog. */
export function FormatGuideLink({ label = 'Format guide' }: { label?: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} data-testid="format-guide-link">
        <HelpCircle className="size-3.5" /> {label}
      </Button>
      {open && (
        <Dialog open onOpenChange={(o) => !o && setOpen(false)} title="Run, swim and other session files" description="How to write a file so it lands on the calendar the way you meant." className="w-[min(860px,calc(100vw-32px))]">
          <FormatGuide />
        </Dialog>
      )}
    </>
  )
}
