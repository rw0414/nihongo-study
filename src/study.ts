// 학습 로직 (Phase 3). UI와 분리된 순수 함수: 하루 분량 고르기, 예문 채점, 연속 학습일.
import type { Card, UnitContent } from './content'
import { analyze, toErrorType, type Finding } from './feedback'
import { BLOCKS } from './blocks'
import type { ErrorType } from './srs'

// ── 하루 분량 ──

export interface DayContent {
  title?: string // 나눈 단원이면 "(1) …"
  cards: Card[]
  pages: [number, number]
  grammarIds: Set<string>
  sentenceRefs: Set<string> // 카드에서 참조하는 예문 원본 id (s-p1-1 등)
}

/** 단원(또는 그 중 한 part)의 카드·쪽 범위·문법 */
export function dayContent(u: UnitContent, partId?: string): DayContent {
  const part = u.parts?.find(p => p.id === partId)
  const ids = part && new Set(part.cards)
  const cards = u.cards.filter(c => !ids || ids.has(c.id))
  const pages = cards.map(c => c.page)
  return {
    title: part?.title,
    cards,
    pages: [Math.min(...pages), Math.max(...pages)],
    grammarIds: new Set(cards.flatMap(c => (c.grammar ? [c.grammar] : []))),
    sentenceRefs: new Set(cards.flatMap(c => c.blocks.flatMap(b => (b.t === 'q' ? [b.ref] : [])))),
  }
}

type VocabLike = { id: string; origin: string; page?: number; approved?: boolean }
type SentenceLike = { id: string; grammar: string[]; page: number; src?: string; answers?: string[] }

/** 오늘 외울 단어: 교재 단어 목록 + 승인된 AI 제안 (본문에서 모은 단어는 단원 화면에서만 참고) */
export function pickVocab<V extends VocabLike>(all: V[], day: DayContent, isLastPart: boolean): V[] {
  const [from, to] = day.pages
  return all.filter(v => {
    if (v.origin === 'ai') return v.approved !== false && isLastPart // AI 제안은 쪽 정보가 없어서 마지막 날에
    if (v.origin !== 'list') return false
    return v.page === undefined || (v.page >= from && v.page <= to + 1) // +1: 장문 단어 목록이 다음 쪽에 걸치는 경우
  })
}

/** 오늘 쓸 예문: 오늘 카드가 참조하는 문제 + 오늘 문법의 본문 예문. 실력 다지기 중 본문 예문과 정답이 같은 문제는 뺀다 */
export function pickSentences<S extends SentenceLike>(all: S[], day: DayContent, unitId: string): S[] {
  const ex = new Set(all.filter(s => s.src === 'example').flatMap(s => (s.answers ?? []).map(normalize)))
  return all.filter(s => {
    const raw = s.id.slice(unitId.length + 1)
    if (s.src === 'drill' && s.answers?.some(a => ex.has(normalize(a)))) return false
    return day.sentenceRefs.has(raw) || (raw.startsWith('s-e') && s.grammar.some(g => day.grammarIds.has(g)))
  })
}

// ── 맛보기 연습: 단어 블록 배열 ──

// 따로 떼는 말: 조사·이음말·문장 끝 (私|は|韓国人|じゃ|ありません|でした)
const STAND = new Set(['は', 'が', 'を', 'に', 'で', 'と', 'へ', 'も', 'の', 'や', 'ね', 'よ', 'な', 'か', 'から', 'まで', 'より', 'だけ', 'しか', 'ばかり', 'など', 'って', 'けど', 'ので', 'のに', 'には', 'では',
  'だ', 'です', 'だった', 'でした', 'じゃ', 'ありません', 'でしょう', 'だろう'])
const OKURI = new Set(['か', 'な', 'しか', 'よ', 'って'])
const NA_I = new Set(['嫌い'])
// 그 자체로 완결된 히라가나 낱말 (뒤 히라가나를 붙이지 않음)
const DEMO = new Set(['これ', 'それ', 'あれ', 'どれ', 'ここ', 'そこ', 'あそこ', 'どこ', 'この', 'その', 'あの', 'どの', 'こちら', 'そちら', 'あちら', 'どちら', 'いつ', 'もう', 'まだ', 'よく', 'とても', 'あまり', 'きっと', 'ちょっと', 'ぜひ', 'さっき', 'ただ', 'でも', 'また'])
// 그 자체로 낱말인 히라가나 (が|ない 의 ない)
const WORDS = new Set(['ない', 'ある', 'いる', 'する', 'なる', 'いい', 'よく', 'もう', 'まだ', 'とても'])
const HIRA_ONLY = /^[ぁ-ゟー]+$/, KATA_LIKE = /^[゠-ヿA-Za-zＡ-Ｚａ-ｚ0-9０-９ー]+$/, KANJI = /[一-鿿々]/
const DIGIT_END = /[0-9０-９]$/

/** 정답 문장을 단어·조사 블록으로. 기기 내장 단어 분리 결과를 활용형(弾|いた → 弾いた)·외래어(シャー|ペン)·복합어 단위로 다시 묶는다 */
export function chunks(answer: string): string[] {
  if (BLOCKS[answer]) return BLOCKS[answer]
  const seg = new Intl.Segmenter('ja', { granularity: 'word' })
  const raw = [...seg.segment(answer.replace(IGNORE, ''))].map(x => x.segment).filter(t => /[ぁ-ゟ゠-ヿ一-鿿A-Za-z0-9０-９]/.test(t))
  // 분리기가 잘게 나눈 문장 끝말을 다시 붙인다 (だ|っ|た → だった, で|した → でした)
  const toks: string[] = []
  for (let i = 0; i < raw.length; i++) {
    let k = 4
    while (k > 1 && !(i + k <= raw.length && STAND.has(raw.slice(i, i + k).join('')))) k--
    toks.push(raw.slice(i, i + k).join(''))
    i += k - 1
  }
  const out: { t: string; stand: boolean; n: number }[] = []
  toks.forEach((t, k) => {
    const p = out.at(-1)
    const add = () => { p!.t += t; p!.n++ }
    if (HIRA_ONLY.test(t)) {
      const nextHira = HIRA_ONLY.test(toks[k + 1] ?? '') && !STAND.has(toks[k + 1])
      // か・な・しか・よ・って는 낱말의 일부일 수 있다: 앞 낱말에 이어지면 활용 어미(楽|しか|った, 開|か|ない, 行|って),
      // 낱말 처음이면 히라가나 낱말(か|わい|かった, よ|かった). 그 밖의 조사·문장 끝말은 늘 따로
      if (OKURI.has(t)) {
        if (p && !p.stand && (nextHira || t === 'って' || (KANJI.test(p.t) && HIRA_ONLY.test(toks[k + 1] ?? '')))) { add(); return }
        if ((!p || p.stand) && nextHira && !WORDS.has(toks[k + 1])) { out.push({ t, stand: false, n: 1 }); return }
      }
      // 동사 음편 + で/だ (急い|で, 頼ん|だ). 嫌いだ 같은 な형용사는 제외
      if (/^[でだ]$/.test(t) && p && !p.stand && KANJI.test(p.t) && /[一-鿿々][いん]$/.test(p.t) && !NA_I.has(p.t)) { add(); return }
      if (STAND.has(t)) { out.push({ t, stand: true, n: 1 }); return }
      // て형 뒤에 새 동사가 이어지면 끊는다 (行って|こない)
      const te = p && KANJI.test(p.t) && /[てで]$/.test(p.t) && !/^(た|る|い)$/.test(t)
      if (p && !p.stand && !te && !DEMO.has(p.t)) { add(); return }
      out.push({ t, stand: false, n: 1 }); return
    }
    if (KATA_LIKE.test(t)) { if (p && !p.stand && KATA_LIKE.test(p.t)) add(); else out.push({ t, stand: false, n: 1 }); return }
    // 한자: お·ご 뒤, 숫자 뒤, 한자끼리는 한 낱말
    if (p && !p.stand && (/^[おご]$/.test(p.t) || DIGIT_END.test(p.t) || /^[一-鿿々]+$/.test(p.t))) { add(); return }
    out.push({ t, stand: false, n: 1 })
  })
  return out.map(x => x.t)
}

// ── 함정 블록 ──
const PARTICLE_TRAP: Record<string, string[]> = {
  は: ['が'], が: ['は', 'を'], を: ['が', 'に'], に: ['で', 'へ'], で: ['に', 'を'], へ: ['を'], と: ['や'], の: ['が'], も: ['は'],
  から: ['まで'], まで: ['から'], より: ['から'], や: ['と'], には: ['では'], では: ['には'],
}
// 문장 끝말·활용을 다른 시제·긍정/부정으로 (だ→です, 読みました→読みます)
const END_TRAP: Record<string, string[]> = { だ: ['です'], です: ['だ'], だった: ['でした'], でした: ['だった'], じゃ: ['で'], ありません: ['あります'] }
const CONJ: [RegExp, string][] = [[/ました$/, 'ます'], [/ません$/, 'ました'], [/ます$/, 'ました'], [/なかった$/, 'ない'], [/ない$/, 'なかった'], [/かった$/, 'い'], [/くない$/, 'い']]
// 반대말 (어간): 大きい↔小さい …
const ANTONYM: [string, string][] = [['大き', '小さ'], ['高', '安'], ['新し', '古'], ['暑', '寒'], ['長', '短'], ['多', '少な'], ['広', '狭'], ['強', '弱'], ['重', '軽'],
  ['近', '遠'], ['明る', '暗'], ['好き', '嫌い'], ['上手', '下手'], ['得意', '苦手'], ['開け', '閉め'], ['熱', '冷た'], ['早', '遅'], ['太', '細'], ['厚', '薄'], ['易し', '難し']]

/**
 * 맛보기 연습의 함정 블록 1~3개 (문장이 길수록 많이). 조사 바꾸기 → 반대말·시제 바꾸기 → 같은 단원의 비슷한 소리 낱말 순.
 * words = 같은 단원 단어(표기)
 */
export function traps(blocks: string[], words: string[], rnd = Math.random): string[] {
  const n = blocks.length <= 4 ? 1 : blocks.length <= 7 ? 2 : 3
  const have = new Set(blocks), out: string[] = []
  const add = (t?: string) => { if (t && !have.has(t) && !out.includes(t) && out.length < n) out.push(t) }
  const pick = <T,>(a: T[]) => a[Math.floor(rnd() * a.length)]
  const parts = blocks.filter(b => PARTICLE_TRAP[b])
  if (parts.length) add(pick(PARTICLE_TRAP[pick(parts)]))
  for (const b of blocks) {
    const ant = ANTONYM.find(([x, y]) => b.startsWith(x) || b.startsWith(y))
    if (ant) add(b.startsWith(ant[0]) ? ant[1] + b.slice(ant[0].length) : ant[0] + b.slice(ant[1].length))
  }
  for (const b of [...blocks].reverse()) {
    if (END_TRAP[b]) add(END_TRAP[b][0])
    const c = CONJ.find(([re]) => re.test(b) && /[一-鿿]/.test(b))
    if (c) add(b.replace(c[0], c[1]))
  }
  // 비슷한 소리: 첫 글자가 같은 같은 단원 단어, 없으면 아무 단원 단어
  const pool = words.filter(w => !have.has(w) && [...w].length <= 6)
  const like = pool.filter(w => blocks.some(b => b[0] === w[0]))
  while (out.length < n && (like.length || pool.length)) {
    const list = like.length ? like : pool
    const w = list.splice(Math.floor(rnd() * list.length), 1)[0]
    add(w)
  }
  return out
}

/**
 * 예문 순서: 원본의 큰 문제 순서(카드 순, 실력 다지기의 ①②…)는 지키고 그 안에서는 섞는다.
 * 본문 예문(카드에서 직접 부르지 않는 것)은 그 문법 카드 자리에 둔다.
 */
export function orderSentences<S extends { id: string; grammar: string[] }>(list: S[], cards: Card[], unitId: string, rnd = Math.random): S[] {
  const group = new Map<string, number>(), byGrammar = new Map<string, number>()
  let g = 0
  for (const c of cards) {
    g++
    if (c.grammar && !byGrammar.has(c.grammar)) byGrammar.set(c.grammar, g)
    for (const b of c.blocks) {
      if (b.t === 'p' && /^[①-⑳]/.test(b.text)) g++ // 큰 문제 번호(갈색 네모)
      if (b.t === 'q') group.set(`${unitId}/${b.ref}`, g)
    }
  }
  const gOf = (s: S) => group.get(s.id) ?? Math.min(...s.grammar.map(x => byGrammar.get(x) ?? Infinity))
  const groups = new Map<number, S[]>()
  for (const s of list) { const k = gOf(s); groups.set(k, [...(groups.get(k) ?? []), s]) }
  return [...groups.keys()].sort((a, b) => a - b).flatMap(k => groups.get(k)!.map(x => [x, rnd()] as const).sort((a, b) => a[1] - b[1]).map(x => x[0]))
}

/** 섞기 (원래 순서와 같으면 한 번 더) */
export function shuffle<T>(a: T[]): T[] {
  for (let k = 0; k < 5; k++) {
    const b = [...a].sort(() => Math.random() - 0.5)
    if (a.length < 2 || b.some((x, i) => x !== a[i])) return b
  }
  return [...a].reverse()
}

// ── 예문 채점 ──

// 채점에서 무시하는 것: 공백, 문장부호, 물결표
const IGNORE = /[\s。、．，.,!！?？「」『』・〜~]/g
export const normalize = (s: string) => s.normalize('NFKC').replace(IGNORE, '')

export type DiffPart = { t: 'same' | 'miss' | 'extra'; s: string } // miss = 정답에 있는데 빠짐, extra = 잘못 들어감

/** 글자 단위 차이 (LCS). 짧은 예문이라 O(n·m)로 충분 */
export function diff(answer: string, input: string): DiffPart[] {
  const a = [...answer], b = [...input]
  const L = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--)
    for (let j = b.length - 1; j >= 0; j--)
      L[i][j] = a[i] === b[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1])
  const out: DiffPart[] = []
  const push = (t: DiffPart['t'], s: string) => (out.at(-1)?.t === t ? (out.at(-1)!.s += s) : out.push({ t, s }))
  let i = 0, j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) { push('same', a[i]); i++; j++ }
    else if (j < b.length && (i === a.length || L[i][j + 1] >= L[i + 1][j])) { push('extra', b[j]); j++ }
    else { push('miss', a[i]); i++ }
  }
  return out
}

const sameLen = (d: DiffPart[]) => d.filter(p => p.t === 'same').reduce((n, p) => n + [...p.s].length, 0)

/** 한자 단어를 읽기로 바꾼다 (긴 단어부터). 한자·가나를 섞어 쓴 답을 가나 정답과 비교할 때 사용 */
export function toKana(s: string, readings: [string, string][]) {
  for (const [ja, r] of readings) if (s.includes(ja)) s = s.split(ja).join(r)
  return s
}

export interface Grade {
  ok: boolean
  score: number // 0~100
  kanaOnly: boolean // 가나로만(또는 한자·가나 섞어서) 맞게 씀
  best: string // 가장 가까운 정답 (원래 표기)
  diff: DiffPart[]
  particleHint: boolean // 가장 중요한 실수가 조사
  errorType?: ErrorType // 복습 일정·오답 노트용 큰 분류
  findings: Finding[] // 실수 유형별 설명 (최대 3개)
}

/** 로컬 채점. readings(교재 단어의 한자→읽기)를 주면 한자·가나를 섞어 쓴 답도 정답으로 본다 */
export function grade(
  input: string,
  s: { answers: string[]; alts?: string[]; kana?: string[]; userAlts?: string[] },
  readings: [string, string][] = [],
): Grade {
  const n = normalize(input)
  const written = [...s.answers, ...(s.alts ?? []), ...(s.userAlts ?? [])]
  const ok = (best: string, kanaOnly: boolean): Grade => ({ ok: true, score: 100, kanaOnly, best, diff: [{ t: 'same', s: n }], particleHint: false, findings: [] })
  const exact = written.find(a => normalize(a) === n)
  if (exact) return ok(exact, false)
  const kanaN = normalize(toKana(input, readings))
  const kanaIdx = (s.kana ?? []).findIndex(k => normalize(k) === n || normalize(k) === kanaN)
  if (kanaIdx >= 0) return ok(written[kanaIdx] ?? written[0], true)

  // 가장 비슷한 정답과 비교: 한자 표기 정답 ↔ 내 답 그대로, 가나 정답 ↔ 내 답을 가나로 바꾼 것
  const cands = [
    ...written.map(w => ({ show: w, norm: normalize(w), inp: n })),
    ...(s.kana ?? []).map((k, i) => ({ show: written[i] ?? written[0], norm: normalize(k), inp: kanaN })),
  ]
  let best = cands[0], bestD = diff(best.norm, best.inp), bestSim = -1
  for (const c of cands) {
    const d = diff(c.norm, c.inp)
    const sim = (2 * sameLen(d)) / ([...c.norm].length + [...c.inp].length || 1)
    if (sim > bestSim) { best = c; bestD = d; bestSim = sim }
  }
  const findings = analyze(best.norm, best.inp, bestD)
  return {
    ok: false, score: Math.round(bestSim * 100), kanaOnly: false, best: best.show, diff: bestD,
    particleHint: findings[0]?.kind === '조사', errorType: toErrorType(findings), findings,
  }
}

// ── 날짜·연속 학습 ──

/** 기기 현지 시간 기준 YYYY-MM-DD (자정 기준으로 날짜가 바뀜) */
export const dayKey = (t: number | Date = Date.now()) => new Date(t).toLocaleDateString('sv')

/** 연속 학습일: 오늘(또는 오늘 아직이면 어제)부터 거꾸로 이어진 날 수 */
export function streak(doneDays: Iterable<string>, today = dayKey()): number {
  const set = new Set(doneDays)
  const d = new Date(today + 'T12:00:00')
  if (!set.has(dayKey(d))) d.setDate(d.getDate() - 1)
  let n = 0
  while (set.has(dayKey(d))) { n++; d.setDate(d.getDate() - 1) }
  return n
}

// ── 오늘의 학습 고르기 ──

export interface NextDay { unitId: string; partId?: string; title: string; partTitle?: string }

/** 목차 순서대로 아직 끝내지 않은 첫 하루 분량. doneKeys = 완료한 `${unitId}#${partId ?? 'all'}` */
export function nextDay(
  chapters: { id: string; title: string; order: number }[],
  units: Map<string, { data: Pick<UnitContent, 'parts' | 'sentences' | 'cards'> }>,
  doneKeys: Set<string>,
): NextDay | undefined {
  for (const c of [...chapters].sort((a, b) => a.order - b.order)) {
    const u = units.get(c.id)
    if (!u) continue
    const parts = u.data.parts ?? [undefined]
    for (const p of parts) if (!doneKeys.has(`${c.id}#${p?.id ?? 'all'}`)) return { unitId: c.id, partId: p?.id, title: c.title, partTitle: p?.title }
  }
}

// ── 홈 로드맵 ──

type CursorLike = { step: string; queue: string[]; i: number }
/** 한 단계의 진행률(0~100). 단어·예문은 새로 배우기 70~80%, 복습이 나머지 */
export function stagePercent(stage: 'vocab' | 'grammar' | 'sentence', c?: CursorLike): number {
  if (!c) return 0
  if (c.step === 'done') return 100
  const f = c.queue.length ? Math.min(c.i / c.queue.length, 1) : 0
  const head = stage === 'vocab' ? 70 : 80
  if (stage === 'grammar') return Math.round(f * 100)
  if (c.step === 'vocab' || c.step === 'sentence') return Math.round(f * head)
  if (c.step.endsWith('intro')) return head
  return Math.round(head + f * (100 - head))
}

/** 스테이지 별 1~3개: 단어·예문 처음 정답률 평균 90% 이상 ★3, 70% 이상 ★2 */
export function stars(st: { vocab: number; vocabOk: number; sentences: number; sentencesOk: number }): number {
  const rates = [st.vocab ? st.vocabOk / st.vocab : null, st.sentences ? st.sentencesOk / st.sentences : null].filter((x): x is number => x !== null)
  const r = rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : 1
  return r >= 0.9 ? 3 : r >= 0.7 ? 2 : 1
}
