import { buildAdvancedForm, buildAdvancedSystemConfig } from '@/composables/useAdvancedPreference'
import { buildDownloadsForm, buildDownloadsSystemConfig } from '@/composables/useDownloadsPreference'
import { buildNetworkForm, buildNetworkSystemConfig } from '@/composables/useNetworkPreference'
import type { AppConfig } from '@shared/types'

export function buildSystemConfigFromAppConfig(config: AppConfig, defaultDir = ''): Record<string, string> {
  const downloadsSystem = buildDownloadsSystemConfig(buildDownloadsForm(config, defaultDir))
  const networkSystem = buildNetworkSystemConfig(buildNetworkForm(config))
  const { form: advancedForm } = buildAdvancedForm(config)
  const advancedSystem = buildAdvancedSystemConfig(advancedForm)

  return {
    ...downloadsSystem,
    ...networkSystem,
    ...advancedSystem,
    'rpc-secret': config.rpcSecret,
    'rpc-listen-port': String(config.rpcListenPort),
  }
}
