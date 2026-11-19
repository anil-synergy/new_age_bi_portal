import { echartsCoreModule as echarts } from '../shared'

let ready: Promise<void> | null = null

export function ensureMapsLoaded(): Promise<void> {
  if (ready) return ready
  ready = (async () => {
    const [{ default: world }, { default: india }] = await Promise.all([
      import('./geo/world-simplified.json'),
      import('./geo/india-simplified.json'),
    ])
    echarts.registerMap('world', world as never)
    echarts.registerMap('india', india as never)
  })()
  return ready
}