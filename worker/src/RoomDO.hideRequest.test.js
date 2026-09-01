/**
 * ゲストからの「非表示にしてほしい」申請の中継（User 要件）。
 *
 * ゲストは品目リストを直接変えられない。DO は申請をホストへ渡すだけで、
 * **ここでは何も隠さない**。承認された結果は、ホストが送り直す config で全員へ降りる。
 *
 * 守りたいのは3つ:
 *   ・申請はホストにだけ届く（他のゲストへ配らない）
 *   ・返事は申請した端末にだけ返る（requestId で引く）
 *   ・ホスト以外は返事を出せない（承認をゲストが自作できない）
 */
import { describe, it, expect } from 'vitest'
import { RoomDO } from './RoomDO.js'
import { makeState } from '../test/doState.js'

function makeWs(attachment = null) {
  const sent = []
  let current = attachment == null ? null : { ...attachment }
  return {
    deserializeAttachment() { return current },
    serializeAttachment(v) { current = v },
    send(data) { sent.push(JSON.parse(data)) },
    close() {},
    _sent: sent,
  }
}

const guest = (name, id) => makeWs({ joined: true, isHost: false, deviceId: id, deviceName: name })
const host  = ()          => makeWs({ joined: true, isHost: true,  deviceId: 'host', deviceName: 'ホスト' })

const of = (ws, type) => ws._sent.filter(m => m.type === type)

describe('RoomDO — 非表示申請の中継', () => {
  it('申請はホストにだけ届き、申請者の名前が付く', async () => {
    const h = host(), g = guest('Aさん', 'g1'), other = guest('Bさん', 'g2')
    const room = new RoomDO(makeState([h, g, other]), {})

    await room._handleMessage(g, { type: 'item_hide_request', name: 'トマト', requestId: 'r1' })

    expect(of(h, 'item_hide_request')).toEqual([{
      type: 'item_hide_request',
      requestId: 'r1',
      name: 'トマト',
      fromDeviceId: 'g1',
      fromDeviceName: 'Aさん',
    }])
    expect(of(other, 'item_hide_request')).toEqual([])   // 他のゲストには配らない
    expect(of(g, 'item_hide_response')).toEqual([])      // まだ返事は無い
  })

  it('ホストの返事は申請した端末にだけ返る', async () => {
    const h = host(), a = guest('Aさん', 'g1'), b = guest('Bさん', 'g2')
    const room = new RoomDO(makeState([h, a, b]), {})

    await room._handleMessage(a, { type: 'item_hide_request', name: 'トマト', requestId: 'r1' })
    await room._handleMessage(h, { type: 'item_hide_response', requestId: 'r1', approved: true, name: 'トマト' })

    expect(of(a, 'item_hide_response')).toEqual([
      { type: 'item_hide_response', requestId: 'r1', approved: true, name: 'トマト' },
    ])
    expect(of(b, 'item_hide_response')).toEqual([])
  })

  // 同じ品目を2人が申請しても、返事は requestId ごとに申請元へ返る。
  // 片方だけに返すと、もう一方は「申請中…」のまま待ち続ける。
  it('同じ品目への2件の申請に、それぞれ返事を返せる', async () => {
    const h = host(), a = guest('Aさん', 'g1'), b = guest('Bさん', 'g2')
    const room = new RoomDO(makeState([h, a, b]), {})

    await room._handleMessage(a, { type: 'item_hide_request', name: 'トマト', requestId: 'r1' })
    await room._handleMessage(b, { type: 'item_hide_request', name: 'トマト', requestId: 'r2' })
    await room._handleMessage(h, { type: 'item_hide_response', requestId: 'r1', approved: true, name: 'トマト' })
    await room._handleMessage(h, { type: 'item_hide_response', requestId: 'r2', approved: true, name: 'トマト' })

    expect(of(a, 'item_hide_response')).toHaveLength(1)
    expect(of(b, 'item_hide_response')).toHaveLength(1)
  })

  it('ホストが居なければ、その場で失敗を返す', async () => {
    const g = guest('Aさん', 'g1')
    const room = new RoomDO(makeState([g]), {})

    await room._handleMessage(g, { type: 'item_hide_request', name: 'トマト', requestId: 'r1' })

    expect(of(g, 'item_hide_response')).toEqual([{
      type: 'item_hide_response', requestId: 'r1', approved: false, reason: 'host_offline', name: 'トマト',
    }])
  })

  // 承認を名乗れるのはホストだけ。ゲストが自分で承認を送っても中継しない。
  it('ゲストは返事を出せない', async () => {
    const h = host(), a = guest('Aさん', 'g1'), b = guest('Bさん', 'g2')
    const room = new RoomDO(makeState([h, a, b]), {})

    await room._handleMessage(a, { type: 'item_hide_request', name: 'トマト', requestId: 'r1' })
    await room._handleMessage(b, { type: 'item_hide_response', requestId: 'r1', approved: true, name: 'トマト' })

    expect(of(a, 'item_hide_response')).toEqual([])
  })

  it('品目名か requestId が空の申請は中継しない', async () => {
    const h = host(), g = guest('Aさん', 'g1')
    const room = new RoomDO(makeState([h, g]), {})

    await room._handleMessage(g, { type: 'item_hide_request', name: '   ', requestId: 'r1' })
    await room._handleMessage(g, { type: 'item_hide_request', name: 'トマト', requestId: '' })

    expect(of(h, 'item_hide_request')).toEqual([])
  })

  // 同じ requestId の返事は1回だけ。2度目は宛先が無く、他の端末へ漏れない。
  it('同じ requestId へ二度返しても、二度目はどこへも届かない', async () => {
    const h = host(), a = guest('Aさん', 'g1')
    const room = new RoomDO(makeState([h, a]), {})

    await room._handleMessage(a, { type: 'item_hide_request', name: 'トマト', requestId: 'r1' })
    await room._handleMessage(h, { type: 'item_hide_response', requestId: 'r1', approved: true, name: 'トマト' })
    await room._handleMessage(h, { type: 'item_hide_response', requestId: 'r1', approved: false, name: 'トマト' })

    expect(of(a, 'item_hide_response')).toHaveLength(1)
  })
})
