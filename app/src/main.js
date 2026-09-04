import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { initAnalytics } from './utils/analytics.js'
import { installMapGetOrInsert } from './utils/mapGetOrInsert.js'

// pdfjs が出荷ブラウザにまだ無いメソッドを素で呼ぶ。PDFを読む前に穴を埋める。
installMapGetOrInsert()

void initAnalytics()
createApp(App).mount('#app')
