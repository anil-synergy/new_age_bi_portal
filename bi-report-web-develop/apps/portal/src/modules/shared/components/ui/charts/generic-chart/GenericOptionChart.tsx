'use client'

import * as React from 'react'
import { ChartFrame, EChart } from '../shared'
import { useChartTheme } from '../useChartTheme'

export interface GenericOptionChartProps {
  option: Record<string, unknown>
  height?: number | string
  className?: string
  ariaLabel?: string
}

export const GenericOptionChart = React.forwardRef<HTMLDivElement, GenericOptionChartProps>(
  ({ option, height = 300, className, ariaLabel }, ref) => {
    const theme = useChartTheme()
    const merged = React.useMemo(
      () => ({
        color: theme.colors,
        textStyle: { color: theme.textColor },
        ...option,
      }),
      [option, theme],
    )
    return (
      <ChartFrame ref={ref} height={height} className={className} ariaLabel={ariaLabel}>
        <EChart option={merged} />
      </ChartFrame>
    )
  },
)
GenericOptionChart.displayName = 'GenericOptionChart'