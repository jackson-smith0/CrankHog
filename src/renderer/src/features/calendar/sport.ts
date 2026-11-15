import { Activity, Bike, Dumbbell, Footprints, Waves, type LucideIcon } from 'lucide-react'
import { activityGroup, type SportGroup } from '@core/sport/group'
import type { OtherActivity } from '../../db/db'

const GROUP_ICON: Record<SportGroup, LucideIcon> = { ride: Bike, run: Footprints, swim: Waves, other: Activity }

/** One icon per sport group, for the volume pane and planned sessions. */
export const groupIcon = (g: SportGroup): LucideIcon => GROUP_ICON[g]

/** The sport's icon: rides, runs and walks, swims, strength, anything else. */
export function sportIcon(a: Pick<OtherActivity, 'sport' | 'subSport'> & { group?: SportGroup | null }): LucideIcon {
  if (a.sport === 'training' || a.subSport === 'strength_training') return Dumbbell
  return GROUP_ICON[activityGroup(a)]
}

export { sportLabel } from '@core/fit/sport'
