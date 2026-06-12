# /ship — ビルド確認 → コミット → プッシュ

以下の手順を順番に実行する。

## 1. ビルド確認
```
cd /home/user/Inventory/app && npm run build
```
エラーがあれば**ここで止まる**。修正してから再度 /ship を実行するよう伝える。

## 2. 変更ファイルの確認
```
git status
git diff --stat
```
コミット対象のファイルを把握する。`.env` や秘密情報が含まれていないこと確認。

## 3. コミット
変更内容を日本語で要約したコミットメッセージを作成してコミット。
フッターに必ずセッションURLを含める：
```
https://claude.ai/code/session_01TdD2fvTpy58GFQTbP7BXpR
```

## 4. プッシュ
```
git push -u origin claude/restaurant-inventory-system-0XNHA
```
失敗した場合は最大4回リトライ（2s, 4s, 8s, 16s）。

## 完了報告
プッシュ後、コミットハッシュと変更ファイル数を簡潔に報告する。
