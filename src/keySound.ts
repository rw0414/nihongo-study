// 키 누를 때 나는 소리 (Web Audio로 직접 합성, 파일 없음). 부드러운 '톡' + 아주 작은 '틱' — 기계식 키보드 느낌
let ctx: AudioContext | undefined
let noise: AudioBuffer | undefined

function audio() {
  if (!ctx) {
    ctx = new AudioContext()
    noise = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 0.04), ctx.sampleRate)
    const d = noise.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3) // 빠르게 사라지는 잡음
  }
  if (ctx.state === 'suspended') ctx.resume()
  return ctx
}

export type KeyKind = 'key' | 'space' | 'delete' | 'enter'

/** 키 소리. 같은 키라도 음 높이를 조금씩 바꿔 자연스럽게 */
export function keySound(kind: KeyKind = 'key') {
  try {
    const c = audio(), t = c.currentTime
    const pitch = { key: 190, space: 120, delete: 150, enter: 230 }[kind] * (0.92 + Math.random() * 0.16)
    // 몸통: 낮은 '톡'
    const o = c.createOscillator(), g = c.createGain()
    o.type = 'sine'
    o.frequency.setValueAtTime(pitch, t)
    o.frequency.exponentialRampToValueAtTime(pitch * 0.45, t + 0.07)
    g.gain.setValueAtTime(0.0001, t)
    g.gain.exponentialRampToValueAtTime(kind === 'enter' ? 0.32 : 0.24, t + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09)
    o.connect(g).connect(c.destination)
    o.start(t)
    o.stop(t + 0.1)
    // 표면: 높고 짧은 '틱'
    const n = c.createBufferSource(), f = c.createBiquadFilter(), ng = c.createGain()
    n.buffer = noise!
    f.type = 'bandpass'
    f.frequency.value = 2600 + Math.random() * 900
    f.Q.value = 1.2
    ng.gain.value = kind === 'space' ? 0.05 : 0.09
    n.connect(f).connect(ng).connect(c.destination)
    n.start(t)
  } catch { /* 소리를 못 내는 기기 */ }
}

/** 살짝 진동 (안드로이드 크롬 등 지원 기기만, 아이폰 사파리는 진동 기능을 열어 주지 않음) */
export function keyBuzz(ms = 8) {
  try { navigator.vibrate?.(ms) } catch { /* 무시 */ }
}
