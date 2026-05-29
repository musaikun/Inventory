# /check — クイックビルドチェック

```
cd /home/user/Inventory/app && npm run build 2>&1 | tail -8
```

エラーがあれば内容を確認して原因を特定する。
ビルドが通れば「✓ ビルド成功」と一言報告する。
