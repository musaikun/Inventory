import { createApp } from 'vue'
import App from './App.vue'
import './style.css'
import { initAnalytics } from './utils/analytics.js'

void initAnalytics()
createApp(App).mount('#app')
