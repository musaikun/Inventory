# Rive試験環境

appディレクトリで実行:

```powershell
npm ci
npm run dev:rive
```

http://127.0.0.1:5174/ を開き、Rive Editorから書き出した`.riv`ファイルを選びます。
制作には[Rive Editor](https://rive.app/editor)を使用します。
ページ上部にはRive Editorで制作した開閉2状態の静止画像とEditorへのリンクがあります。
アートボード`AssignWheel`、ステートマシン`Wheel`、View Model `AssignWheel`のBoolean `isOpen`で開閉します。
現在のworkspaceプランでは`.riv`を書き出せず、制作したホイールのWeb再生は未確認です。
確認方法と残作業は[素材制作手順](public/assets/wheel-rive-guide.md)に記録しています。

「既存UIからの素材案」は、素材が無くても動くSVGの試作です。
展開・収納、400 / 700 / 1000ms、開き具合のスライダーで動きを検討できます。
これはRiveでの再生結果ではありません。下部の`.riv`読み込み欄で実際のRive再生を確認します。

試作用SVGと制作手順は`dev/rive/public/assets/`に保存しています。ページからもダウンロードできます。
SVGを作り直す場合は`node dev/rive/export-wheel-draft.mjs`を実行します。
Editorへの取り込み・MCP連携は[素材制作手順](public/assets/wheel-rive-guide.md)を参照してください。

画像・フォント・音声は`.riv`へ埋め込んでください。外部のRive Asset CDNは無効です。
選択したファイルはブラウザ内で読み込み、サーバーや在庫データへ保存しません。

1. ファイルを選択し、「読み込み完了」になることを確認する。
2. アートボードとステートマシンを選ぶ。未指定時の再生対象はファイルとランタイムの既定に従うため、評価するステートマシンは明示的に選ぶ。
3. キャンバス上の操作、再生・一時停止・読み直し、375 / 768 / 1024pxでの見え方を確認する。
4. タブを隠して戻る。端末の「動きを減らす」を有効にすると静止表示になることを確認する。
5. 不正な`.riv`でエラーが出て、正常ファイルを選び直せることを確認する。

スマホから同じLANのPCへ接続する場合:

```powershell
npm run dev:rive -- --host 0.0.0.0
```

Viteが表示するNetwork URLをスマホで開きます。PC側のファイアウォール設定によっては接続許可が必要です。
この試験ページは開発用です。公開用サーバーには使用しません。

試験ページのビルド確認:

```powershell
npm run build:rive
```

出力はGit管理対象外の`app/dist-rive/`です。通常の`npm run build`やPWAには試験ページを含めません。
再生部品は`src/components/RiveCanvas.vue`、WASMの配信設定は`src/utils/riveRuntime.js`です。
現在は試験ページのみが部品を参照します。振り分け画面への適用はUser判断後の別作業です。

ランタイムは`@rive-app/webgl2@2.42.0`へ固定し、主WASMと旧端末用fallbackを同じpackageからViteのURL importで配信します。
読み込み時だけJSを取得し、閉じた際に`cleanup()`、非表示・一時停止時に描画ループを停止します。
スマホの負荷を抑えるため描画解像度のdevicePixelRatioは最大2です。

製品画面への組み込み前に、素材・ステートマシン・業務操作との対応、エラー時の代替表示、
実機性能、PWAでの`.riv`/`.wasm`キャッシュ方針を確定してください。
公開CSPのWASM許可とPWAキャッシュは、別タスクUI-005でClaude Codeが準備しています。
配信先・実機での検証は[UI-005](../../../docs/quality-foundation/tasks/UI-005.md)を参照してください。
UI-004の素材制作では公開ヘッダーを変更していません。

公式資料:

- [Web導入](https://rive.app/docs/runtimes/web/web-js)
- [CanvasとWebGL2](https://rive.app/docs/runtimes/web/canvas-vs-webgl)
- [WASMの自己配信](https://rive.app/docs/runtimes/web/preloading-wasm)
