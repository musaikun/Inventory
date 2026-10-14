// スタッフの画面を開く（ホームのカード・参加申請のやることから。User決定 2026-10-14）。
// 開くのは SessionListPage（ホーム）。やることの行など、どこからでも開けるよう小さな共有の印にする
import { ref } from 'vue'
export const staffPageOpen = ref(false)
export function openStaffPage() { staffPageOpen.value = true }
