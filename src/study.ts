// 학습 로직 (Phase 3). UI와 분리된 순수 함수: 하루 분량 고르기, 예문 채점, 연속 학습일.
import type { Card, UnitContent } from './content'
import { analyze, toErrorType, type Finding } from './feedback'
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
type SentenceLike = { id: string; grammar: string[]; page: number }

/** 오늘 외울 단어: 교재 단어 목록 + 승인된 AI 제안 (본문에서 모은 단어는 단원 화면에서만 참고) */
export function pickVocab<V extends VocabLike>(all: V[], day: DayContent, isLastPart: boolean): V[] {
  const [from, to] = day.pages
  return all.filter(v => {
    if (v.origin === 'ai') return v.approved !== false && isLastPart // AI 제안은 쪽 정보가 없어서 마지막 날에
    if (v.origin !== 'list') return false
    return v.page === undefined || (v.page >= from && v.page <= to + 1) // +1: 장문 단어 목록이 다음 쪽에 걸치는 경우
  })
}

/** 오늘 쓸 예문: 오늘 카드가 참조하는 문제 + 오늘 문법의 본문 예문 */
export function pickSentences<S extends SentenceLike>(all: S[], day: DayContent, unitId: string): S[] {
  return all.filter(s => {
    const raw = s.id.slice(unitId.length + 1)
    return day.sentenceRefs.has(raw) || (raw.startsWith('s-e') && s.grammar.some(g => day.grammarIds.has(g)))
  })
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
