import { Activity, Bike, Footprints, Gauge, Waves, type LucideProps } from 'lucide-react'
import type { SportGroup } from '@core/sport/group'

/** A sport's icon. `workout` shows the bike-workout gauge instead of the plain bike. */
export function SportIcon({ sport, workout = false, ...props }: { sport: SportGroup; workout?: boolean } & LucideProps) {
  switch (sport) {
    case 'ride':
      return workout ? <Gauge {...props} /> : <Bike {...props} />
    case 'run':
      return <Footprints {...props} />
    case 'swim':
      return <Waves {...props} />
    case 'other':
      return <Activity {...props} />
  }
}
