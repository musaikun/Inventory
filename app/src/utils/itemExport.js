import { useConfig } from '../composables/useConfig.js'
import { downloadItemTemplate } from '../composables/usePdfImporter.js'

// 現在の品目リストを CSV でダウンロード
export function downloadItemsCSV() {
  const { exportConfigCSV } = useConfig()
  const csv  = exportConfigCSV()
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = '棚卸品目リスト.csv'
  a.click()
  URL.revokeObjectURL(url)
}

// Excel テンプレートをダウンロード
export function downloadItemsTemplate() {
  downloadItemTemplate()
}
