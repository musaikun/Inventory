self.addEventListener('push', event => {
  const data = event.data?.json() ?? {}
  event.waitUntil(
    self.registration.showNotification(data.title || 'タナオロ', {
      body:  data.body  || '',
      icon:  '/icon-192.png',
      badge: '/icon-192.png',
      tag:   data.tag   || 'tanaoro',
      data:  { url: data.url || '/' },
    })
  )
})

self.addEventListener('notificationclick', event => {
  event.notification.close()
  const url = event.notification.data?.url || '/'
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      for (const c of list) {
        if ('focus' in c) return c.focus()
      }
      return clients.openWindow(url)
    })
  )
})
