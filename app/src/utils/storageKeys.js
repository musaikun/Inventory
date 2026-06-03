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
  learningSessions: 'inventory_learning_v1',
  syncSession:      '_sync_session_v1',
  shopCode:         '_shop_code',
  hostTokenPrefix:  '_host_token_',  // + shopCode をサフィックスに付けて使用
  pendingSession:   '_pending_session_v1',
}
