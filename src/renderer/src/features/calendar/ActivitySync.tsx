import { useEffect, useState } from 'react'
import { RefreshCw } from 'lucide-react'
import { syncIntervalsActivities } from '../../plan/intervals-activities'
import { bridge } from '../../platform/bridge'
import { useSettings } from '../../stores/settings'
import { Button } from '../../ui/Button'
import { describeSync } from './sync-text'

/** Brings completed activities in from intervals.icu now, instead of waiting for the next sync. Shown once the rider has turned the sync on. */
export function ActivitySync({ onNotice }: { onNotice: (n: { tone: 'good' | 'bad'; text: string }) => void }) {
  const on = useSettings((s) => s.intervalsSync.activities)
  const [configured, setConfigured] = useState(false)
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let live = true
    void bridge()
      .invoke('intervals.status', {})
      .then((s) => live && setConfigured(s.configured))
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [])
  if (!on || !configured) return null
  const run = async () => {
    setBusy(true)
    try {
      const r = await syncIntervalsActivities()
      onNotice({ tone: 'good', text: describeSync(r) })
    } catch (e) {
      onNotice({ tone: 'bad', text: `Couldn't bring in activities from intervals.icu: ${e instanceof Error ? e.message : String(e)}` })
    } finally {
      setBusy(false)
    }
  }
  return (
    <Button size="sm" onClick={() => void run()} disabled={busy} data-testid="activity-sync" title="Runs, swims and everything else you recorded, from intervals.icu">
      <RefreshCw className={busy ? 'size-3.5 animate-spin' : 'size-3.5'} /> {busy ? 'Bringing in…' : 'Refresh activities'}
    </Button>
  )
}
