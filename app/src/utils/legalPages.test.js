import { describe, it, expect } from 'vitest'
import { readFileSync, existsSync } from 'node:fs'
import { resolve } from 'node:path'

// 公開legalページ（PLAY-004 後半）の回帰テスト。
// 目的は3つ:
//  1. Google Play が要求する公開ページが実際に配信物（app/public）へ存在し、必要な記載を持つこと
//  2. 実装と食い違う古い記載（決済委託先・行動分析・1年/90日保持）が復活しないこと
//  3. 正本（docs/legal）・公開HTML・landing コピーが同じ事実を述べ続けること
// 文面を更新するときは、このテストが要求する事実を満たしたまま3か所を揃える。

// vitest は app/ を cwd として実行する（jsdom 環境では import.meta.url が file: とは限らない）
const root = resolve(process.cwd(), '..')
const read = (rel) => readFileSync(resolve(root, rel), 'utf8')
const exists = (rel) => existsSync(resolve(root, rel))

// DS-08 で統一する連絡先。変更時はここと全ページを同時に更新する。
const CONTACT = 'ss_inventory@outlook.com'
// 統一前のもう一方（VAPID default）。公開文書に混在してはいけない。
const OTHER_CONTACT = 'support@tanaoro.com'

const PUBLIC_PAGES = ['app/public/privacy.html', 'app/public/terms.html', 'app/public/support.html']
const LANDING_PAGES = ['landing/privacy.html', 'landing/terms.html', 'landing/support.html']
const ALL_HTML = [...PUBLIC_PAGES, ...LANDING_PAGES]
const LEGAL_DOCS = ['docs/legal/privacy-policy.md', 'docs/legal/terms.md']

describe('公開legalページ: 配信物としての存在と体裁', () => {
  it('Pages CSPはproductionと分離Pro ReviewのWorkerだけを明示許可する', () => {
    const headers = read('app/public/_headers')
    expect(headers).toContain('connect-src')
    expect(headers).toContain('https://inventory-sync.yuya-takaki.workers.dev')
    expect(headers).toContain('wss://inventory-sync.yuya-takaki.workers.dev')
    expect(headers).toContain('https://inventory-sync-pro-review.yuya-takaki.workers.dev')
    expect(headers).toContain('wss://inventory-sync-pro-review.yuya-takaki.workers.dev')
    expect(headers).toContain('https://eu.i.posthog.com')
    expect(headers).not.toContain('https://us.i.posthog.com')
    expect(headers).not.toContain('posthog-assets')
  })

  it.each(PUBLIC_PAGES)('%s が app/public にあり、Pages にそのまま配信される', (p) => {
    expect(exists(p)).toBe(true)
    expect(read(p).length).toBeGreaterThan(1000)
  })

  it.each(ALL_HTML)('%s はモバイル表示に必要な viewport と言語指定を持つ', (p) => {
    const html = read(p)
    expect(html).toContain('<html lang="ja">')
    expect(html).toContain('name="viewport"')
    expect(html).toContain('width=device-width')
    // 横スクロールを起こさないため、表は独自のスクロール領域に入れる
    if (html.includes('<table')) expect(html).toContain('class="scroll"')
  })

  it.each(ALL_HTML)('%s は外部リソースを読み込まない（CSP self のまま表示できる）', (p) => {
    const html = read(p)
    expect(html).not.toMatch(/<script/i)
    expect(html).not.toMatch(/src="https?:\/\//i)
    expect(html).not.toMatch(/<link[^>]+href="https?:\/\//i)
  })

  it.each([...ALL_HTML, ...LEGAL_DOCS])('%s はアプリ名と統一した問い合わせ先を示す', (p) => {
    const text = read(p)
    // Play の要件: 公開リソースに store listing のアプリ名（または開発者名）を示す
    expect(text).toContain('タナオロ')
    expect(text).toContain(CONTACT)
    expect(text).not.toContain(OTHER_CONTACT)
  })
})

describe('公開legalページ: 実装と一致しない記載が復活しない', () => {
  it.each([...ALL_HTML, ...LEGAL_DOCS])('%s に旧い保持期間・決済委託先・分析SDKの記載がない', (p) => {
    const text = read(p)
    // 旧policy: 操作ログ1年 / アクセスログ90日（実装は DO 24時間・失敗記録 最長約24時間15分）
    expect(text).not.toContain('90日')
    expect(text).not.toContain('1年間')
    // Stripe は未実装。委託先として列挙しない（「利用していません」の言及だけ許容する）
    expect(text).not.toContain('Stripe, Inc.')
    // PostHogは既定buildで無効。有効化前は委託先・分析基盤として列挙しない
    expect(text).not.toMatch(/PostHog[^等）]*(?:へ送信|に送信|を利用しています)/)
  })
})

describe('公開legalページ: 実装事実の記載', () => {
  const privacyCopies = ['app/public/privacy.html', 'landing/privacy.html', 'docs/legal/privacy-policy.md']

  it.each(privacyCopies)('%s が実装どおりの保持期間を述べている', (p) => {
    const text = read(p)
    expect(text).toContain('約24時間15分')   // login/IP 失敗記録（15分判定窓＋日次cleanup）
    expect(text).toContain('7日間')           // 削除receipt / 匿名tombstone
    expect(text).toContain('復元可能な期間は7日間') // D1 Time Travel（Free plan）
    expect(text).toContain('Freeプランでは3日間')  // Workers Logs
    expect(text).toContain('200件')           // DO の chat / 操作履歴
    expect(text).toContain('30日')            // 認証トークン
  })

  it.each(privacyCopies)('%s が任意権限の発生条件と端末内データを説明している', (p) => {
    const text = read(p)
    expect(text).toContain('現在地で天気を表示')  // 位置情報は自動取得しない
    expect(text).toContain('Web Speech API')      // 音声はブラウザ/OS側で処理され得る
    expect(text).toContain('端末内で解析')        // camera / file は送信しない
    expect(text).toContain('端末ID')              // 端末に保存される情報として列挙する
  })


  const termsCopies = ['app/public/terms.html', 'landing/terms.html', 'docs/legal/terms.md']

  it.each(termsCopies)('%s が現在の料金実装（決済なし）を述べている', (p) => {
    const text = read(p)
    expect(text).toContain('無料プランのみ')
    expect(text).toContain('店舗コードを1つ発行')
    expect(text).toContain('接続端末2台')
    expect(text).toContain('登録品目150件')
    expect(text).toContain('直近3回')
    expect(text).toContain('決済機能を提供しておらず')
    expect(text).toContain('自動的に有料へ切り替わることもありません')
    expect(text).not.toContain('前払い')
  })

  // 正本(docs/legal)と公開HTML・landingコピーで条文の事実がずれないこと。
  // markup が違うため行単位では比較できないので、齟齬が出た条文の要点を固定する。
  it.each(termsCopies)('%s の終了通知・免責・規約変更が3コピーで一致している', (p) => {
    const text = read(p)
    // 第6条3 / 第11条3: 連絡先を保持しない実装のため「個別通知」ではなく「掲示」
    expect(text).toContain('終了の30日前までに本サービス上へ掲示します')
    expect(text).toContain('掲示の30日前までに本サービス上でお知らせします')
    expect(text).not.toContain('利用者へ通知します')
    // 第7条2/5: 全部免責は消費者契約法8条で無効となり得るため「一切の」を置かない
    expect(text).not.toContain('一切の責任を負いません')
    // 第2条: 用語を「操作履歴」に統一
    expect(text).toContain('操作履歴等')
    expect(text).not.toContain('操作ログ等')
  })

  const supportCopies = ['app/public/support.html', 'landing/support.html']

  it.each(supportCopies)('%s が端末内データの消去手順を持つ（DS-02 の説明導線）', (p) => {
    const text = read(p)
    expect(text).toContain('この端末に残るデータの消去')
    expect(text).toContain('サイトデータ')
    expect(text).toContain('Safari')
    expect(text).toContain('Chrome')
  })

  // D-019: account削除の完了時に端末ID・端末名・天気の位置情報とキャッシュも自動削除する。
  // 実装は accountData.clearDeviceLocalData()（useDeviceId / useWeather の resetLocalData）。
  // 実装だけ変えて文面が「削除しても端末に残る」のままだと Data Safety の説明と矛盾するため固定する。
  it.each([...privacyCopies, ...supportCopies])('%s が端末固有データの自動削除を述べている', (p) => {
    const text = read(p)
    expect(text).toContain('端末ID・端末名・天気の位置情報とキャッシュ')
    expect(text).toContain('端末IDは削除後、次回の起動時に新しい値が発行されます')
    // 旧記載（削除しても端末に残る）の再発防止
    expect(text).not.toContain('端末ID・端末名・天気の位置情報は端末の設定として残ります')
    expect(text).not.toMatch(/<td>端末ID<\/td>\s*<td>ブラウザが生成した識別子/)
  })
})

describe('アプリからの導線', () => {
  it('公開削除ページが privacy / terms / support へリンクする', () => {
    const src = read('app/src/components/DeleteAccountPage.vue')
    expect(src).toContain("PRIVACY_URL = './privacy.html'")
    expect(src).toContain("TERMS_URL = './terms.html'")
    expect(src).toContain("SUPPORT_URL = './support.html'")
  })

  it('未ログインで最初に見えるランディング画面から3ページへ到達できる', () => {
    const src = read('app/src/components/LandingPage.vue')
    expect(src).toContain('href="./privacy.html"')
    expect(src).toContain('href="./terms.html"')
    expect(src).toContain('href="./support.html"')
  })

  it('設定画面から3ページと端末内データの説明へ到達できる', () => {
    const src = read('app/src/components/SettingsModal.vue')
    expect(src).toContain('href="./privacy.html"')
    expect(src).toContain('href="./terms.html"')
    expect(src).toContain('href="./support.html"')
    expect(src).toContain('この端末に残るデータ')
  })
})

describe('配信設定: 公開ページが SPA に飲まれない', () => {
  it('_redirects の legal ルールが catch-all より前にある', () => {
    const lines = read('app/public/_redirects')
      .split('\n')
      .map(l => l.trim())
      .filter(l => l && !l.startsWith('#'))
    const catchAll = lines.findIndex(l => l.startsWith('/*'))
    expect(catchAll).toBeGreaterThan(-1)
    for (const path of ['/privacy', '/terms', '/support']) {
      const i = lines.findIndex(l => l.startsWith(path + ' '))
      expect(i, `${path} のルールが必要`).toBeGreaterThan(-1)
      expect(i, `${path} は catch-all より前に置く`).toBeLessThan(catchAll)
    }
  })

  it('PWA の navigateFallback が公開ページを index.html へ倒さない', () => {
    const cfg = read('app/vite.config.js')
    const m = cfg.match(/navigateFallbackDenylist:\s*\[(.*?)\]/s)
    expect(m).toBeTruthy()
    expect(m[1]).toContain('privacy')
    expect(m[1]).toContain('terms')
    expect(m[1]).toContain('support')
  })
})
