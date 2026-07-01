import webpush from 'web-push'

function _initVapid(env) {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return false
  webpush.setVapidDetails(
    env.VAPID_SUBJECT || 'mailto:support@tanaoro.com',
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  )
  return true
}

async function _send(env, sub, payload) {
  if (!_initVapid(env)) return
  try {
    await webpush.sendNotification(
      { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
      JSON.stringify(payload),
      { TTL: 60 * 60 * 24 }
    )
  } catch (err) {
    if (err.statusCode === 404 || err.statusCode === 410) {
      await env.DB.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').bind(sub.endpoint).run()
    }
  }
}

export async function savePushSubscription(db, shopCode, sub) {
  await db.prepare(`
    INSERT INTO push_subscriptions (shop_code, endpoint, p256dh, auth)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(endpoint) DO UPDATE SET
      shop_code  = excluded.shop_code,
      p256dh     = excluded.p256dh,
      auth       = excluded.auth,
      updated_at = datetime('now')
  `).bind(shopCode, sub.endpoint, sub.keys?.p256dh ?? '', sub.keys?.auth ?? '').run()
}

export async function deletePushSubscription(db, shopCode, endpoint) {
  await db.prepare('DELETE FROM push_subscriptions WHERE shop_code = ? AND endpoint = ?')
    .bind(shopCode, endpoint).run()
}

export async function handleCron(env) {
  if (!env.DB || !env.VAPID_PUBLIC_KEY) return

  const now  = new Date()
  // JST = UTC+9
  const jst  = new Date(now.getTime() + 9 * 3600 * 1000)
  const jstDay   = jst.getUTCDate()
  const jstMonth = jst.getUTCMonth() + 1
  const jstYear  = jst.getUTCFullYear()

  const lastDayOfMonth = new Date(jstYear, jstMonth, 0).getDate()
  const isMonthEnd     = jstDay === lastDayOfMonth

  const { results: subs } = await env.DB.prepare(`
    SELECT ps.shop_code, ps.endpoint, ps.p256dh, ps.auth,
           (SELECT MAX(ended_at) FROM sessions WHERE shop_code = ps.shop_code AND status = 'completed') AS last_completed_at,
           s.created_at AS store_created_at
    FROM push_subscriptions ps
    LEFT JOIN stores s ON s.shop_code = ps.shop_code
  `).all()

  for (const sub of (subs ?? [])) {
    if (isMonthEnd) {
      await _send(env, sub, {
        title: 'タナオロ',
        body:  '本日が月末です。タナオロで棚卸を開始しましょう📋',
        tag:   'month-end',
        url:   '/',
      })
      continue
    }

    const lastAt      = sub.last_completed_at ? new Date(sub.last_completed_at) : null
    const createdAt   = sub.store_created_at  ? new Date(sub.store_created_at)  : null
    const daysSinceLast   = lastAt    ? Math.floor((now - lastAt)    / 86400000) : null
    const daysSinceCreate = createdAt ? Math.floor((now - createdAt) / 86400000) : null

    if (!lastAt && daysSinceCreate === 7) {
      await _send(env, sub, {
        title: 'タナオロ',
        body:  'タナオロを試してみましょう✨ 品目リストがなくても今すぐ棚卸を始められます',
        tag:   'onboarding',
        url:   '/',
      })
      continue
    }

    if (daysSinceLast === 25) {
      await _send(env, sub, {
        title: 'タナオロ',
        body:  '今月の棚卸はもうすぐです📋 タナオロで棚卸を始めましょう',
        tag:   'reminder',
        url:   '/',
      })
    } else if (daysSinceLast === 32) {
      await _send(env, sub, {
        title: 'タナオロ',
        body:  '棚卸が遅れています⚠️ 前回から32日が経ちました',
        tag:   'reminder',
        url:   '/',
      })
    }
  }

  // 途中放置セッション（24時間以上放置・7日以内開始）
  const { results: stale } = await env.DB.prepare(`
    SELECT s.shop_code, ps.endpoint, ps.p256dh, ps.auth
    FROM sessions s
    JOIN push_subscriptions ps ON ps.shop_code = s.shop_code
    WHERE s.status = 'active'
      AND s.updated_at < datetime('now', '-24 hours')
      AND s.started_at > datetime('now', '-7 days')
  `).all()

  for (const row of (stale ?? [])) {
    await _send(env, row, {
      title: 'タナオロ',
      body:  '棚卸が途中のままです🔖 続きからすぐ再開できます',
      tag:   'stale-session',
      url:   '/',
    })
  }
}
