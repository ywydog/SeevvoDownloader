<script setup lang="ts">
/** @fileoverview Root application component with Naive UI theme provider and locale configuration. */
import { computed, provide } from 'vue'
import { useI18n } from 'vue-i18n'
import {
  NConfigProvider,
  NMessageProvider,
  NDialogProvider,
  darkTheme,
  type NLocale,
  type NDateLocale,
  zhCN,
  dateZhCN,
  enUS,
  dateEnUS,
} from 'naive-ui'
import { useTheme } from './composables/useTheme'
import { useReducedMotionClass } from './composables/useReducedMotion'
import { useVisibilityPause } from './composables/useVisibilityPause'

import { APP_COLOR_TOKENS_KEY, useColorScheme } from './composables/useColorScheme'

const { locale: currentLocale } = useI18n()
const { isDark } = useTheme()
const { colorTokens, themeOverrides } = useColorScheme()
provide(APP_COLOR_TOKENS_KEY, colorTokens)
useVisibilityPause()
useReducedMotionClass()

const theme = computed(() => (isDark.value ? darkTheme : null))

const naiveLocaleMap: Record<string, NLocale> = {
  'en-US': enUS,
  'zh-CN': zhCN,
}
const naiveDateLocaleMap: Record<string, NDateLocale> = {
  'en-US': dateEnUS,
  'zh-CN': dateZhCN,
}

const naiveLocale = computed(() => naiveLocaleMap[currentLocale.value] || null)
const naiveDateLocale = computed(() => naiveDateLocaleMap[currentLocale.value] || null)
</script>

<template>
  <NConfigProvider
    :theme="theme"
    :theme-overrides="themeOverrides"
    :locale="naiveLocale"
    :date-locale="naiveDateLocale"
  >
    <NMessageProvider>
      <NDialogProvider>
        <router-view />
      </NDialogProvider>
    </NMessageProvider>
  </NConfigProvider>
</template>

<style>
#app {
  height: 100%;
}
</style>
