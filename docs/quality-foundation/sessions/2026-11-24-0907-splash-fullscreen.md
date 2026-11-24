# 2026-11-24 起動アニメーションを画面全体に（v0.215.2）

- User: 起動アニメーションが中央の四角に収まって見える。スマホの画面全体で表現したい。モック（https://claude.ai/artifact/HxojCHULoV2qhuuzJRmuvk）を見て「これで実装」
- 原因: `StartupSplash.vue` が 320×320px の固定の舞台を中央に置き、その中の座標だけで動かしていた
- 変更（`StartupSplash.vue`）: 舞台を画面全体に。人は四隅寄り（割合）、カードは人と画面の外から。輪は幅の約76%。背景の粒が画面全体を漂い、進み具合に応じて輪へ寄る。完成で光の波が画面の端まで広がり、輪をくぐるように拡大してホームへ（完成→ホーム約1.16秒、旧0.76秒）。最低1.6秒・最大6秒・動きを控える設定は従来どおり
- test: `StartupSplash.test.js` の閉じるまでの時間を新しい演出に合わせた
- 検証: `cd app && npm test` 245 files・2301 pass ／ `npm run build` OK ／ `vite preview` を 375×780 の実ブラウザで開き、全画面で動いて約4秒以内に閉じる・エラーなしを確認
- feature-checklist: 同期・API・D1・認可・文言の変更なし（N/A）
- 残件: 実機（Android Chrome / iOS Safari）での見え方は User 確認
