/**
 * Available languages for SeevvoDownloader.
 *
 * Please keep the locale key in alphabetical order.
 */
export const availableLanguages = [
  {
    value: 'en-US',
    label: 'English',
  },
  {
    value: 'zh-CN',
    label: '简体中文',
  },
]

const checkLngIsAvailable = (locale) => {
  return availableLanguages.some((lng) => lng.value === locale)
}

/**
 * getLanguage
 * @param { String } locale
 *
 * Only locales with a `startsWith` fallback need explicit handling
 * for same-prefix variants.
 *
 * en, en-AU, en-CA, en-GB, en-IN, en-NZ, en-US, en-XA, en-ZA
 * zh, zh-CN, zh-HK, zh-TW
 */
export const getLanguage = (locale = 'en-US') => {
  if (checkLngIsAvailable(locale)) {
    return locale
  }

  if (locale.startsWith('en')) {
    return 'en-US'
  }

  if (locale === 'zh-HK' || locale === 'zh-TW') {
    return 'zh-CN'
  }

  if (locale.startsWith('zh')) {
    return 'zh-CN'
  }

  return 'en-US'
}