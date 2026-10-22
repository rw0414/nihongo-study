// 오답 상세 분석 (Phase 5). 문제마다 오답을 미리 적어 두지 않고, 정답과 내 답의 '글자 차이'와 '문장 끝'을 보고
// 한국어 화자가 자주 하는 실수 유형으로 분류한다. 모든 예문에 그대로 적용된다.
import type { DiffPart } from './study'
import type { ErrorType } from './srs'

export type Kind =
  | '어순' | '시제' | '부정' | '정중체' | '활용' | '조사'
  | '탁음' | '촉음' | '장음' | '요음' | '가나 종류' | '한자 표기' | '오타' | '단어' | '누락' | '추가'

export interface Finding { kind: Kind; text: string }

const PARTICLES = new Set([...'はがをにでとへものやかね'])
const HIRA = (c: string) => c >= 'ぁ' && c <= 'ゟ'
const KATA = (c: string) => c >= 'ァ' && c <= 'ヺ'
const KANJI = (c: string) => /[一-鿿々]/.test(c)
const SMALL: Record<string, string> = { ゃ: 'や', ゅ: 'ゆ', ょ: 'よ', っ: 'つ', ぁ: 'あ', ぃ: 'い', ぅ: 'う', ぇ: 'え', ぉ: 'お', ャ: 'ヤ', ュ: 'ユ', ョ: 'ヨ', ッ: 'ツ', ァ: 'ア', ィ: 'イ', ゥ: 'ウ', ェ: 'エ', ォ: 'オ' }
const base = (c: string) => c.normalize('NFD').replace(/[゙゚]/g, '') // 탁점·반탁점 제거
const toHira = (c: string) => (KATA(c) ? String.fromCharCode(c.charCodeAt(0) - 0x60) : c)

// 문장 끝 문법 형태 (긴 것부터). 이 꼬리가 다르면 시제·부정·정중체 실수로 본다
const ENDINGS = [
  'じゃありませんでした', 'ではありませんでした', 'じゃなかったです', 'ではなかったです', 'じゃありません', 'ではありません',
  'じゃなかった', 'ではなかった', 'じゃないです', 'ではないです', 'ませんでした', 'なかった', 'じゃない', 'ではない',
  'でした', 'ました', 'ません', 'だった', 'かった', 'ないです', 'です', 'ます', 'ない', 'だ', 'た',
]
function ending(s: string) {
  const e = ENDINGS.find(x => s.endsWith(x)) ?? ''
  return { start: [...s].length - [...e].length, text: e }
}
const isPast = (e: string) => /た$/.test(e)
const isNeg = (e: string) => /(ない|ません|なかった|ず)/.test(e)
const isPolite = (e: string) => /(です|ます|ません|でした|ました)/.test(e)

/** 한 글자 바뀜 분류 */
function swap(a: string, b: string): Finding {
  // 탁점만 다른 경우를 먼저 (が↔か처럼 둘 다 조사 글자여도 탁점 실수가 훨씬 흔함)
  // 조사 は・へ・を는 소리 나는 대로(わ・え・お) 쓰면 안 됨 (가장 흔한 초급 실수)
  const SOUND: Record<string, string> = { は: 'わ', へ: 'え', を: 'お' }
  if (SOUND[a] === b) return { kind: '조사', text: `조사 ${a}는 '${b}'로 읽지만 글자는 ${a}로 써요` }
  if (base(a) === base(b)) return { kind: '탁음', text: `${a}와 ${b}는 탁점(゛)·반탁점(゜)이 달라요` }
  if (PARTICLES.has(a) && PARTICLES.has(b)) return { kind: '조사', text: `조사 ${a}를 ${b}로 썼어요` }
  if (SMALL[a] === b || SMALL[b] === a) {
    const tsu = a === 'っ' || b === 'っ' || a === 'ッ' || b === 'ッ'
    return { kind: tsu ? '촉음' : '요음', text: tsu ? `작은 っ(촉음)와 큰 つ를 구분해요: ${a} → ${b}` : `작은 글자(${SMALL[a] ? a : b})로 써야 해요: ${a} → ${b}` }
  }
  if (toHira(a) === toHira(b)) return { kind: '가나 종류', text: `${a}는 ${KATA(a) ? '가타카나' : '히라가나'}로 써요` }
  if (KANJI(a) && KANJI(b)) return { kind: '한자 표기', text: `한자 ${a}를 ${b}로 썼어요 (읽기가 같은 다른 한자일 수 있어요)` }
  return { kind: '오타', text: `${a}를 ${b}로 썼어요` }
}

/** 빠진 글자 분류 */
function missing(m: string): Finding {
  if (m === 'っ' || m === 'ッ') return { kind: '촉음', text: '작은 っ(촉음)가 빠졌어요' }
  if (m === 'ー' || ((m === 'う' || m === 'い') && [...m].length === 1)) return { kind: '장음', text: `길게 읽는 소리(장음) ${m}가 빠졌어요` }
  if ([...m].every(c => PARTICLES.has(c))) return { kind: '조사', text: `조사 ${m}가 빠졌어요` }
  return { kind: '누락', text: `${m}가 빠졌어요` }
}

/** 더 들어간 글자 분류 */
function extra(x: string): Finding {
  if (x === 'っ' || x === 'ッ') return { kind: '촉음', text: '필요 없는 작은 っ가 들어갔어요' }
  if (x === 'ー') return { kind: '장음', text: '필요 없는 장음(ー)이 들어갔어요' }
  if ([...x].every(c => PARTICLES.has(c))) return { kind: '조사', text: `조사 ${x}는 필요 없어요` }
  return { kind: '추가', text: `${x}는 없어도 돼요` }
}

/**
 * 정답(answer)과 내 답(input) 비교 결과를 실수 유형별 설명으로. 중요한 것부터 최대 3개.
 * answer/input은 normalize된 문자열, d는 diff(answer, input).
 */
export function analyze(answer: string, input: string, d: DiffPart[]): Finding[] {
  if (!input) return []
  const out: Finding[] = []
  const sorted = (s: string) => [...s].sort().join('')
  if (answer !== input && sorted(answer) === sorted(input)) return [{ kind: '어순', text: '단어는 맞는데 순서가 달라요' }]

  // 1) 문장 끝 문법: 시제·부정·정중체·활용
  const eA = ending(answer), eI = ending(input)
  let skipFrom = Infinity // 문법으로 설명한 끝부분은 글자 단위 분석에서 뺀다
  if ((eA.text || eI.text) && eA.text !== eI.text) {
    if (isPast(eA.text) !== isPast(eI.text)) out.push({ kind: '시제', text: isPast(eA.text) ? `과거형이 필요해요 (…${eA.text})` : `현재형으로 써야 해요 (…${eA.text})` })
    if (isNeg(eA.text) !== isNeg(eI.text)) out.push({ kind: '부정', text: isNeg(eA.text) ? `부정 표현이 빠졌어요 (…${eA.text})` : '부정이 아니라 긍정 문장이에요' })
    if (isPolite(eA.text) !== isPolite(eI.text)) out.push({ kind: '정중체', text: isPolite(eA.text) ? `정중체(です・ます)로 써야 해요 (…${eA.text})` : `보통체(반말)로 써야 해요 (…${eA.text})` })
    if (!out.length && eA.text && eI.text) out.push({ kind: '활용', text: `문장 끝 활용이 달라요: …${eI.text} → …${eA.text}` })
    if (out.length) skipFrom = eA.start
  }

  // 2) 글자 단위: 연속된 차이를 한 덩어리로 (빠진 것 + 들어간 것)
  let i = 0
  const segs: { at: number; miss: string; extra: string }[] = []
  let cur: { at: number; miss: string; extra: string } | null = null
  for (const p of d) {
    if (p.t === 'same') { if (cur) segs.push(cur); cur = null; i += [...p.s].length; continue }
    cur ??= { at: i, miss: '', extra: '' }
    if (p.t === 'miss') { cur.miss += p.s; i += [...p.s].length } else cur.extra += p.s
  }
  if (cur) segs.push(cur)

  for (const s of segs) {
    if (s.at >= skipFrom) continue
    const m = [...s.miss], x = [...s.extra]
    if (m.length >= 2 && m.length === x.length && m.every(KANJI) && x.every(KANJI)) out.push({ kind: '단어', text: `${s.miss}(이)가 들어갈 자리에 ${s.extra}를 썼어요` })
    else if (m.length && m.length === x.length && m.length <= 3) {
      // 같은 종류의 실수는 한 덩어리로 설명 (ペン → ぺん 은 '가타카나로' 하나)
      const fs = m.map((c, k) => (c !== x[k] ? swap(c, x[k]) : null)).filter((f): f is Finding => !!f)
      if (fs.length > 1 && fs.every(f => f.kind === fs[0].kind)) out.push(fs[0].kind === '가나 종류' ? { kind: '가나 종류', text: `${s.miss}는 ${KATA(m[0]) ? '가타카나' : '히라가나'}로 써요` } : { ...fs[0], text: `${s.miss}를 ${s.extra}로 썼어요 (${fs[0].kind})` })
      else out.push(...fs)
    }
    else if (m.length && !x.length) out.push(missing(s.miss))
    else if (!m.length && x.length) out.push(extra(s.extra))
    else if (m.every(c => KANJI(c) || KATA(c)) || x.some(c => KANJI(c))) out.push({ kind: '단어', text: `${s.miss}(이)가 들어갈 자리에 ${s.extra}를 썼어요` })
    else out.push({ kind: '오타', text: `${s.miss}를 ${s.extra}로 썼어요` })
  }

  // 같은 설명은 하나로, 문법 → 조사 → 표기 → 나머지 순
  const rank: Kind[] = ['어순', '시제', '부정', '정중체', '활용', '조사', '단어', '한자 표기', '탁음', '촉음', '장음', '요음', '가나 종류', '오타', '누락', '추가']
  const uniq = [...new Map(out.map(f => [f.text, f])).values()]
  return uniq.sort((a, b) => rank.indexOf(a.kind) - rank.indexOf(b.kind)).slice(0, 3)
}

/** 복습 일정·오답 노트에 남기는 큰 분류 */
export function toErrorType(f: Finding[]): ErrorType {
  const k = f[0]?.kind
  if (!k) return '기타'
  if (k === '조사') return '조사'
  if (k === '시제' || k === '부정' || k === '정중체' || k === '활용') return '활용'
  if (k === '누락' || k === '추가') return '누락'
  if (k === '어순' || k === '단어') return '기타'
  return '표기'
}
