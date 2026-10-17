/** General Settings control for the size of the Electron desktop companion window. */
import { SegmentedControl } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopCompanionScale, DesktopCompanionSizeView } from '../types.ts'
import css from './CompanionSizeRow.module.css'

/** Segment values; the segment carries the copy key, the shell carries the scale. */
type CompanionStepId = 'small' | 'medium' | 'large'

const STEP_SCALES: Readonly<Record<CompanionStepId, DesktopCompanionScale>> = {
  small: 0.85, medium: 1, large: 1.25,
}

const SCALE_STEPS: Readonly<Record<DesktopCompanionScale, CompanionStepId>> = {
  0.85: 'small', 1: 'medium', 1.25: 'large',
}

/** Accepted setting and writer supplied by the settings owner. */
export interface CompanionSizeRowInjected {
  hooks: { companionSize: ObservableSnapshot<DesktopCompanionSizeView> }
  setSize(scale: DesktopCompanionScale): Promise<void>
}

/**
 * Render the desktop companion size steps.
 * @param props - observed size, writer, and localized copy.
 * @returns the General Settings row.
 */
export function CompanionSizeRow({ useCompanionSize, setSize, t }:
  PropsRuntime<'settings.general.item'> & PropsLocale<'settings'> & InjectFace<CompanionSizeRowInjected>) {
  const { scale, failed } = useCompanionSize(value => value)
  return <div className={css.row}>
    <div>
      <div className={css.title}>{t('companionSize.title')}</div>
      {failed && <div className={css.error} role="alert">{t('companionSize.error')}</div>}
    </div>
    <SegmentedControl
      id="companion-size"
      label={t('companionSize.title')}
      value={SCALE_STEPS[scale]}
      options={[
        { value: 'small', label: t('companionSize.small') },
        { value: 'medium', label: t('companionSize.medium') },
        { value: 'large', label: t('companionSize.large') },
      ]}
      onChange={(next) => { void setSize(STEP_SCALES[next]) }}
    />
  </div>
}
