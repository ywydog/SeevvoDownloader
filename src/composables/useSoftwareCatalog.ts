/**
 * @fileoverview 软件清单数据访问：加载 software-catalog.json 并分类。
 */
import { ref, computed } from 'vue'
import catalogData from '@shared/software-catalog.json'

export interface SoftwareCatalogItem {
  /** 软件显示名 */
  name: string
  /** 下载保存的文件名 */
  filename: string
  /** 直链 URL（无 github_path 时生效） */
  url?: string
  /** GitHub Releases 路径（走下载源前缀拼接） */
  github_path?: string
  /** 是否为压缩包（需要解压） */
  decompress?: boolean
}

/** 分类标签 */
export type SoftwareCategory = '希沃' | '日常' | '工具'

/** 软件分类规则（按名称前缀归类） */
function categorize(name: string): SoftwareCategory {
  if (name.startsWith('希沃') || name.includes('希象') || name.includes('希沃品课') || name.includes('远程互动')) {
    return '希沃'
  }
  if (['微信', 'QQ', '网易云音乐', 'office2021'].includes(name)) {
    return '日常'
  }
  if (['ClassIsland2', 'ClassWidgets'].includes(name)) {
    return '工具'
  }
  return '希沃'
}

export interface SoftwareEntry extends SoftwareCatalogItem {
  category: SoftwareCategory
}

const rawItems = (catalogData as SoftwareCatalogItem[]) ?? []

const items = rawItems.map((item) => ({
  ...item,
  category: categorize(item.name),
}))

const list = ref<SoftwareEntry[]>(items)

export function useSoftwareCatalog() {
  const all = computed(() => list.value)
  const categories: SoftwareCategory[] = ['希沃', '日常', '工具']

  function byCategory(cat: SoftwareCategory): SoftwareEntry[] {
    return list.value.filter((s) => s.category === cat)
  }

  function findByName(name: string): SoftwareEntry | undefined {
    return list.value.find((s) => s.name === name)
  }

  return { all, categories, byCategory, findByName }
}
