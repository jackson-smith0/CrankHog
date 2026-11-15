import { useRef, useState } from 'react'
import { FileUp, Hammer } from 'lucide-react'
import { createPlan, importIntoPlan } from '../../plan/plans-repo'
import { Button } from '../../ui/Button'
import { Dialog } from '../../ui/Dialog'
import { Field, Input } from '../../ui/form'
import { IMPORT_EXTENSIONS } from '../../workouts/library'

/** Add a training plan: name it, then fill it from your own workout files or start empty. */
export function NewPlanFlow({ onClose, onCreated }: { onClose: () => void; onCreated: (planId: string) => void }) {
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const create = async (files?: FileList) => {
    setBusy(true)
    setError(null)
    try {
      const plan = await createPlan({ name: name.trim() || 'Training plan', source: files ? 'files' : 'manual' })
      if (files) {
        const r = await importIntoPlan(plan.id, await Promise.all(Array.from(files).map(async (f) => ({ name: f.name, text: await f.text() }))))
        if (r.failed.length > 0) setError(`Couldn't import ${r.failed.map((f) => f.name).join(', ')}`)
      }
      onCreated(plan.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} title="Add a training plan" description="A plan is your workouts in order, laid onto the days you ride.">
      <div className="space-y-4">
        <Field label="Name">
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Base 1" aria-label="Plan name" data-testid="new-plan-name" />
        </Field>
        <div className="grid gap-2 sm:grid-cols-2">
          <input ref={fileInput} type="file" multiple accept={IMPORT_EXTENSIONS.join(',')} className="hidden" onChange={(e) => e.target.files && void create(e.target.files)} data-testid="new-plan-files" />
          <Button disabled={busy} onClick={() => fileInput.current?.click()} className="h-auto flex-col items-start gap-1 py-3 text-left" data-testid="new-plan-import">
            <span className="flex items-center gap-2 font-semibold">
              <FileUp className="size-4" /> Import your workout files
            </span>
            <span className="text-xs font-normal text-ink-dim">Files named YYYY-MM-DD_name go on that day.</span>
          </Button>
          <Button disabled={busy} onClick={() => void create()} className="h-auto flex-col items-start gap-1 py-3 text-left" data-testid="new-plan-empty">
            <span className="flex items-center gap-2 font-semibold">
              <Hammer className="size-4" /> Start empty
            </span>
            <span className="text-xs font-normal text-ink-dim">Pick workouts from your library.</span>
          </Button>
        </div>
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </Dialog>
  )
}
