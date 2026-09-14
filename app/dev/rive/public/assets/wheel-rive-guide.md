# 振り分けホイール — Rive制作のたたき台

現在の`AxisAssignFocus.vue`を参考にした素材案です。演出の採否・調整値はUser判断です。
SVG試作とRiveランタイムの描画性能は別に評価します。

## 2026-09-10: Editor上の試作

[制作したファイルを開く](https://editor.rive.app/file/untitled/2564146)（UserのRiveログインが必要）。

- ファイル `Untitled`、アートボード `AssignWheel`（375 × 336）、ステートマシン `Wheel`。
- データバインディング: View Model `AssignWheel` / Instance `Default` / Boolean `isOpen`。初期値はfalse。
- `isOpen = false`で`Closed`、trueで`Open`へ切り替わる。両方向700ms、cubic-bezier(0.65, 0, 0.35, 1)。
- EditorのAnimateで`Wheel`を選び、再生しながらバインド済みの`Default`インスタンスの`isOpen`を切り替える。静止状態だけを見る場合は`Closed` / `Open`のタイムラインを選ぶ。
- 図形・英字ラベル・数量は編集可能。カード上の業務操作やドラッグは未接続。今回のラベル・数量は固定の仮データ。
- 日本語の試作にはフォント調整が必要。MCPのTTFアップロードが`not enabled for this editor`で拒否されたため、現状はInterの仮英字。Editorのフォント選択から日本語対応フォントを設定して確認する。
- `wheel-rive-open.png` / `wheel-rive-closed.png`はRive自身が描画した確認用画像。動画・ランタイム性能の証拠ではない。
- 試作のアートボード高は336固定で、収納時も中央にカードを残す。実画面の高さ336→56の変更、可変幅、日本語、連打中の反転、動的な分類・数量は後続の検討項目。
- MCPのheadless検証では入力なしでClosed、true→falseでClosed→Open→Closedを確認。早い反転は開く遷移が終わってから閉じる挙動。停止後の入力ではシミュレーターが再始動しないケースがあり、実際のEditor操作・Webランタイムでの再開は別途確認する。
- **現在のworkspaceプランでは`.riv`と`.rev`の書き出しが利用不可**。`.riv`のexportでプラン制限を確認し、別形式での再試行はしていない。プランを変更していないため、アプリでの実再生・スマホ性能は未確認。
- 検証ログ: `dev/rive/verification/wheel-editor.json`。試験ページの上部から確認画像とEditorを開ける。

## 素材

- `wheel-open.svg`: 375 × 336。展開時の参考配置。
- `wheel-closed.svg`: 375 × 56。収納時の参考配置。
- 色: 選択枠・バッジ `#2563eb`、選択面 `#eff6ff`、通常枠 `#e2e8f0`。
- カード高さ56、角丸12、バッジ48 × 32（収納時は高さ44）、右の操作領域64。
- 既存のCSS 3D回転を、位置・拡大縮小で2Dに近似しています。影・上下フェードはこの最初の素材に含めていません。
- 図形のグループ名は両SVGで共通。`card-selected`が中央、`card-above-1..3`と`card-below-1..3`が前後、`action-rail`が右操作部です。
- 文字・件数は動的データなのでSVGへ焼き込んでいません。試験ページだけ仮の名称と件数を表示しています。

## Editorでの構成案

1. Riveで新規ファイルを開き、375 × 336のアートボードを作る。`wheel-open.svg`を取り込む。
2. `wheel-closed.svg`は収納状態の参照用。別アートボードへ読み込み、二重に描画しない。
3. 分類名・件数はRiveのTextとData Binding、またはVue側の文字を重ねる方式で設定する。どちらを採用するかは未決。
4. 同じオブジェクト群で`Open`と`Closed`の状態を作る。単にSVGを2枚入れただけではアニメーションにならない。
5. 中央カードを残し、上下カードの位置・縦横スケール・不透明度、右操作部の不透明度、中央カードとバッジの幅・高さを補間する。
6. 元UIの基準時間は700ms。試験ページでは400 / 700 / 1000msを比較できる。既存の扇の補間に合わせ、前半加速・後半減速（cubic ease-in-out）を基準とする。
7. 作成済みのステートマシン名は`Wheel`、開閉のBooleanはView Model `AssignWheel`の`isOpen`。Web側から値を渡す接続は書き出し後に行う。
8. 実際の画面領域を336→56へ縮める処理と、Rive内の表示位置・アートボードの扱いを同じ開閉状態に連動させる。キャンバス全体を縦につぶして文字まで縮めない。
9. フォント等を利用する場合は埋め込みで書き出し、`.riv`を試験ページで選択する。

可変件数・分類数、無限回転、ドラッグ・慣性、業務操作との結合はまだ実装していません。
この素材は展開・収納の見え方を比較するためのたたき台です。

## CodexからEditorを操作するための接続

Rive公式MCPはWindows / macOSのデスクトップEditorに対応しています。
対応版を起動し、編集用のファイルとアートボードを開いた状態で、
`http://127.0.0.1:9791/mcp`へ接続する構成です。
2026-09-08の未インストール時点ではECONNREFUSEDでしたが、Userのインストール後に接続成功。
この環境のDesktop EditorとMCP server v0.6で、上記の図形・文字・開閉設定を作成できました。
書き出しは実際にプラン制限で拒否されています。購入や契約の変更はしていません。

公式資料:

- [SVGの取り込み](https://rive.app/docs/editor/assets/svg)
- [Rive MCP連携](https://rive.app/docs/editor/ai/mcp)
- [.rivの書き出し](https://rive.app/docs/editor/exporting/exporting-for-runtime)
- [フォント選択と文字の書き出し範囲](https://rive.app/docs/editor/text/fonts)
