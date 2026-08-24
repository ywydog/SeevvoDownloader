<script setup lang="ts">
/** @fileoverview Preference sub-navigation tabs. */
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter, useRoute } from 'vue-router'
import { SettingsOutline, DownloadOutline, GlobeOutline, ConstructOutline } from '@vicons/ionicons5'
import { type Component } from 'vue'
import SubnavPane, { type SubnavPaneItem } from '@/components/layout/SubnavPane.vue'

const { t } = useI18n()
const router = useRouter()
const route = useRoute()

const items: { key: string; icon: Component; route: string }[] = [
  { key: 'general', icon: SettingsOutline, route: '/preference/general' },
  { key: 'downloads', icon: DownloadOutline, route: '/preference/downloads' },
  { key: 'network', icon: GlobeOutline, route: '/preference/network' },
  { key: 'advanced', icon: ConstructOutline, route: '/preference/advanced' },
]

const subnavItems = computed<SubnavPaneItem[]>(() =>
  items.map((item) => ({
    ...item,
    label: t('preferences.' + item.key) || item.key,
    active: isActive(item.key),
  })),
)

function nav(path: string) {
  router.push({ path }).catch(() => {
    /* duplicate navigation */
  })
}

function isActive(key: string) {
  return route.path.includes(key)
}
</script>

<template>
  <SubnavPane :title="t('subnav.preferences') || 'Preferences'" :items="subnavItems" @navigate="nav" />
</template>
