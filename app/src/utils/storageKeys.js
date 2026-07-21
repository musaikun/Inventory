/**
 * localStorage キー定義（中央管理）
 *
 * 将来のマルチデバイス同期に備え、すべてのキーをここで定義する。
 * プレフィックス化が必要になった際はこのファイルを変更するだけでよい。
 *
 * 現在のキー体系:
 *   inventory_v1          - 当日の棚卸データ
 *   inventory_history_v1  - 完了済み棚卸のスナップショット
 *   inventory_config_v1   - 品目リスト設定
 *   inventory_aliases_v1  - 自動学習エイリアス
 *   inventory_master_v1   - マスター辞書（1対多）
 *   _device_id            - デバイスUUID（変更不可）
 *   _device_name          - 端末名（ユーザー設定）
 */
export const STORAGE_KEYS = {
  inventory:        'inventory_v1',
  history:          'inventory_history_v1',
  config:           'inventory_config_v1',
  aliases:          'inventory_aliases_v1',
  master:           'inventory_master_v1',
  deviceId:         '_device_id',
  deviceName:       '_device_name',
  syncSession:      '_sync_session_v1',
  shopCode:         '_shop_code',
  hostTokenPrefix:  '_host_token_',  // + shopCode をサフィックスに付けて使用
  pendingSession:   '_pending_session_v1',
  authToken:        '_auth_token',
  authStoreName:    '_auth_store_name',
  tapContinuous:    'inv_tap_continuous',
  orders:           'inventory_orders_v1',
  movements:        'inventory_movements_v1',
  movementDraft:    'inventory_movement_draft_v1',  // 未記録の入出庫入力（端末に保持）
  dayNotes:         'inventory_day_notes_v1',  // 日別メモ（内部イベント・学習除外フラグ）
  pdfProfiles:      'inventory_pdf_profiles_v1',  // PDF列マッピングのレシピ保存
  dataOwner:        '_data_owner',   // localStorage の業務データが属する店舗コード（アカウント分離用）
  // 天気連携（端末固有・アカウント切替でも保持＝端末の物理位置は店舗が変わっても同じ）。
  // 業務データではないため accountData の全消去対象には含めない。
  weatherLoc:       'weather_loc',    // 天気表示の位置（緯度・経度・地名）
  weatherCache:     'weather_cache',  // 天気データの1hキャッシュ
}
