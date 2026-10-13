// 暗証番号（PIN）の決まり。オーナー（店舗）とスタッフで同じ（D-030・User 決定 2026-10-13）。
//
// 6桁＝100万通り。同じ数字だけ・連番・短い並びのくり返しは、総当たりで最初に試されるので使わせない。
// 2026-10-13 より前に登録した店のオーナー PIN は4桁のまま入れられる（stores.pin_digits が NULL＝4桁）。
// その店はログインした時点で6桁への変更を求める（pinUpgradeRequired）。
export const PIN_DIGITS = 6
/** 以前の登録で使えたオーナー PIN の桁数（変更を求めるまでの間だけ受け付ける） */
export const LEGACY_OWNER_PIN_DIGITS = 4

/** 6桁の暗証番号として使えるか。使えなければ理由（画面にそのまま出す）、使えれば '' */
export function pinProblem(pin) {
  if (!/^\d{6}$/.test(pin)) return '暗証番号は6桁の数字で入れてください'
  if (/^(\d)\1{5}$/.test(pin)) return '同じ数字だけの暗証番号は使えません'
  const asc = '01234567890', desc = '09876543210'
  if (asc.includes(pin) || desc.includes(pin)) return '連続した数字の暗証番号は使えません'
  if (/^(\d\d\d)\1$/.test(pin) || /^(\d\d)\1\1$/.test(pin)) return '同じ並びのくり返しは使えません'
  return ''
}

/** 保存している桁数から、6桁への変更が要るか（NULL は以前の4桁） */
export function needsPinUpgrade(pinDigits) {
  return (Number(pinDigits) || LEGACY_OWNER_PIN_DIGITS) < PIN_DIGITS
}
