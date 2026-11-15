import { formatStep } from '@core/multisport/parse'
import type { SessionSection } from '@core/multisport/model'

/** A session's steps as the file reads them, section by section, with each repeat's count. */
export function SessionSteps({ sections, compact = false }: { sections: readonly SessionSection[]; compact?: boolean }) {
  if (sections.length === 0) return null
  return (
    <div className={compact ? 'space-y-1 text-[11px]' : 'space-y-2 text-sm'} data-testid="session-steps">
      {sections.map((s, i) => (
        <div key={i}>
          {(s.title || s.repeat > 1) && (
            <div className="eyebrow text-ink-faint">
              {s.title}
              {s.repeat > 1 && <span className="ml-1 font-display tabular text-ink-dim">{s.repeat}×</span>}
            </div>
          )}
          <ul className={s.repeat > 1 ? 'border-l-2 border-line-strong pl-2' : ''}>
            {s.steps.map((st, j) => (
              <li key={j} className="font-display tabular">
                {formatStep(st).replace(/^- /, '')}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
