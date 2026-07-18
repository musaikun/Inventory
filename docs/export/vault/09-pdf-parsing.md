---
title: "PDF解析"
aliases:
  - "PDF解析"
---
# 09 PDF解析

スナップショット: 2026-07-15 / v0.48

## 現状の実装
- **Worker側抽出**: `POST /pdf` — pdfjs を Worker 内で実行しテキスト抽出（クライアント非力端末対策）
- **列マッピングUI**: PdfImporterModal / PdfColumnMapper — 抽出テキストから品目・単位・単価の列を指定
- **レシピ保存**: `pdfProfiles`（localStorage `inventory_pdf_profiles_v1`）— 同じ仕入先のPDFは2回目から自動マッピング
- CSV/Excel/テキスト貼り付けも同系の取込フローに統一

## 既知の課題
| 課題 | 状態 |
|---|---|
| `/pdf` が無認証・サイズ無制限・レート制限なし（経済的DoS） | ⚠️ Wave 2.5 で対策（S-D） |
| Worker CPU 時間の課金（巨大PDF） | サイズ上限（例5MB）とセットで対策 |
| スキャンPDF（画像のみ）は抽出不可 | → [10 OCR](10-ocr.md) |

## 記録すること（今後）
- 取り込めなかったPDFの実例（仕入先名・フォーマット特徴）→ パーサー改善の需要根拠
- レシピ保存の利用状況（効いているか）
