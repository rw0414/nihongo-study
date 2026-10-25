// 간격 반복 복습 (Phase 4). SM-2를 단순하게 바꾼 방식 — UI와 분리된 순수 함수.
//  - 그날 처음 답한 결과로만 다음 복습일을 정한다 (같은 날 다시 본 것은 기록만, 일정은 그대로)
//  - 다시(again): 내일 다시 · 쉬움 정도 낮춤 / 어려움(hard): 간격 조금만 늘림
//  - 알맞음(good): 1일 → 3일 → 간격 × ease / 쉬움(easy): 더 길게 · ease 올림
// ponytail: 고정 상수 SM-2. 학습 기록이 쌓이면(Phase 5) 정답률에 맞춰 상수를 조정하거나 FSRS로 교체.
import type { VocabGrade } from './db'

export type ErrorType = '조사' | '활용' | '표기' | '누락' | '기타' | '모름'

export interface Sched {
  itemId: string
  itemType: 'vocab' | 'sentence'
  unitId: string
  reps: number // 연속으로 기억한 횟수 (다시 → 0)
  ease: number // 간격 배수 (1.3 ~)
  interval: number // 일
  due: string // 다음 복습일 YYYY-MM-DD
  lastDate: string // 마지막으로 일정을 바꾼 날
  lastGrade?: VocabGrade
  lapses: number // 기억했다가 다시 잊은 횟수
  wrongCount: number // 누적 오답 (그날 첫 답 기준)
  correctCount: number
  streak: number // 최근 연속 정답
  errors: Partial<Record<ErrorType, number>> // 예문 오답 원인
  related?: boolean // 같은 문법을 자주 틀려서 추가된 예문
  // 단어(안키식 시간 일정): 다시 나오는 시각, 남은 학습 단계 수(0 = 졸업), 학습 단계 개수(2 = 새 단어, 1 = 다시 학습)
  dueAt?: number
  left?: number
  steps?: number
}

export const addDays = (day: string, n: number) => {
  const d = new Date(day + 'T12:00:00')
  d.setDate(d.getDate() + n)
  return d.toLocaleDateString('sv')
}

export const newSched = (itemId: string, itemType: Sched['itemType'], unitId: string, today: string): Sched => ({
  itemId, itemType, unitId, reps: 0, ease: 2.5, interval: 0, due: today, lastDate: '', lapses: 0, wrongCount: 0, correctCount: 0, streak: 0, errors: {},
})

/** 답 하나를 반영한 다음 일정. 오늘 이미 반영했으면 그대로 돌려준다.
 *  ok: 오답 집계 기준 (단어는 '다시'만 오답, 예문은 채점이 틀리면 '어려움'이어도 오답) */
export function review(prev: Sched, g: VocabGrade, today: string, error?: ErrorType, ok = g !== 'again'): Sched {
  if (prev.lastDate === today) return prev
  const s = { ...prev, errors: { ...prev.errors } }
  if (g === 'again') {
    if (s.reps > 0) s.lapses++
    s.reps = 0
    s.interval = 1
    s.ease = Math.max(1.3, s.ease - 0.2)
  } else if (g === 'hard') {
    s.reps++
    s.interval = Math.max(1, Math.round(s.interval * 1.2))
    s.ease = Math.max(1.3, s.ease - 0.15)
  } else {
    s.reps++
    const easy = g === 'easy'
    s.interval = s.reps === 1 ? (easy ? 3 : 1) : s.reps === 2 ? (easy ? 6 : 3) : Math.round(s.interval * s.ease * (easy ? 1.3 : 1))
    if (easy) s.ease += 0.15
  }
  s.wrongCount += ok ? 0 : 1
  s.correctCount += ok ? 1 : 0
  s.streak = ok ? s.streak + 1 : 0
  if (error) s.errors[error] = (s.errors[error] ?? 0) + 1
  s.lastGrade = g
  s.lastDate = today
  s.due = addDays(today, s.interval)
  return s
}

/** 예문 채점 결과 → 복습 등급 */
export function sentenceGrade(r: { ok: boolean; score: number; particleHint?: boolean; errorType?: ErrorType } | null): { grade: VocabGrade; error?: ErrorType } {
  if (!r) return { grade: 'again', error: '모름' }
  if (r.ok) return { grade: 'good' }
  return { grade: r.score >= 80 ? 'hard' : 'again', error: r.errorType ?? (r.particleHint ? '조사' : '기타') }
}

/** 오늘 복습할 것: 복습일이 지났고 오늘 아직 안 본 항목, 오래 밀린 것부터 */
export function dueToday(all: Sched[], today: string, type: Sched['itemType'], exclude: Set<string>, limit: number): string[] {
  return all
    .filter(s => s.itemType === type && s.due <= today && s.lastDate !== today && !exclude.has(s.itemId))
    .sort((a, b) => a.due.localeCompare(b.due) || b.wrongCount - a.wrongCount)
    .slice(0, limit)
    .map(s => s.itemId)
}

/** 오답 상태: 틀린 적 없음 / 아직 약함 / 회복 중(1~2번 연속 정답) / 회복(3번 이상 연속 정답) */
export function recovery(s: Sched): 'none' | 'weak' | 'recovering' | 'recovered' {
  if (s.wrongCount === 0) return 'none'
  return s.streak >= 3 ? 'recovered' : s.streak >= 1 ? 'recovering' : 'weak'
}

/** 같은 문법을 2개 이상 틀렸으면, 아직 복습 일정이 없는 같은 문법 예문을 최대 n개 골라 추가 연습으로 */
export function relatedPicks(
  grammar: string,
  unitSentences: { id: string; grammar: string[] }[],
  sched: Map<string, Sched>,
  n = 2,
): string[] {
  const same = unitSentences.filter(s => s.grammar.includes(grammar))
  const wrong = same.filter(s => (sched.get(s.id)?.wrongCount ?? 0) > 0).length
  if (wrong < 2) return []
  return same.filter(s => !sched.has(s.id)).slice(0, n).map(s => s.id)
}

// ── 단어: 안키(Anki) 기본 설정과 똑같이 '시간'으로 다시 나온다. 버튼은 모름(Again)·알고 있음(Good) ──
//  새 단어: 학습 단계 1분 → 10분 → 졸업(1일 뒤). 모름이면 1분 단계부터 다시
//  복습 단어: 알고 있음 → 간격 × ease(기본 2.5), 최소 +1일 / 모름 → ease −0.2(최소 1.3), 10분 뒤 다시 학습 → 1일 뒤
//  지금 나올 단어가 없으면 20분 안에 나올 학습 중 단어를 미리 보여 준다 (안키 '미리 학습' 한도 20분)
export const MIN = 60000
export const LEARN_STEPS = [1, 10] // 분
export const RELEARN_STEPS = [10]
export const LEARN_AHEAD = 20 * MIN

/** 그날 0시 (복습 단어는 그날이 되면 나온다) */
export const dayStart = (day: string) => new Date(day + 'T00:00:00').getTime()
const today = (now: number) => new Date(now).toLocaleDateString('sv')

/** 지금 단어 상태: 새 단어 / 학습 중(분 단위) / 복습(일 단위) */
export function vocabState(s: Sched | undefined): 'new' | 'learning' | 'review' {
  if (!s || (!s.lastDate && !s.reps && s.left === undefined)) return 'new'
  if (s.left) return 'learning'
  return s.reps > 0 ? 'review' : 'learning'
}
/** 다시 나오는 시각 (옛 기록은 복습일 0시) */
export const dueAt = (s: Sched) => s.dueAt ?? dayStart(s.due)

/** 단어 답 하나 → 다음 일정 */
export function ankiAnswer(prev: Sched, know: boolean, now: number): Sched {
  const t = today(now)
  const first = prev.lastDate !== t // 오답 노트 통계는 그날 첫 답으로
  const s: Sched = {
    ...prev, lastGrade: know ? 'good' : 'again', lastDate: t,
    wrongCount: prev.wrongCount + (first && !know ? 1 : 0), correctCount: prev.correctCount + (first && know ? 1 : 0),
    streak: first ? (know ? prev.streak + 1 : 0) : prev.streak,
  }
  const at = (ms: number) => { s.dueAt = now + ms; s.due = today(s.dueAt) }
  const graduate = (days: number) => { s.left = 0; s.interval = days; s.due = addDays(t, days); s.dueAt = dayStart(s.due) }
  const state = vocabState(prev)
  if (state === 'review') {
    if (know) { s.reps = prev.reps + 1; graduate(Math.max(prev.interval + 1, Math.round(prev.interval * prev.ease))) }
    else { s.lapses = prev.lapses + 1; s.ease = Math.max(1.3, prev.ease - 0.2); s.reps = 0; s.interval = 1; s.steps = RELEARN_STEPS.length; s.left = RELEARN_STEPS.length; at(RELEARN_STEPS[0] * MIN) }
    return s
  }
  // 새 단어·학습 중
  const steps = state === 'new' ? LEARN_STEPS : prev.steps === RELEARN_STEPS.length ? RELEARN_STEPS : LEARN_STEPS
  s.steps = steps.length
  const left = state === 'new' ? steps.length : prev.left || 1
  if (!know) { s.left = steps.length; at(steps[0] * MIN); return s }
  if (left - 1 > 0) { s.left = left - 1; at(steps[steps.length - s.left] * MIN); return s }
  s.reps = Math.max(prev.reps, 0) + 1
  graduate(1)
  return s
}

/** 지금 복습할 단어: 때가 된 것(오래된 것부터). 없으면 20분 안에 나올 학습 중 단어 */
export function dueVocab(all: Sched[], now: number, limit = 200): string[] {
  const vocab = all.filter(s => s.itemType === 'vocab' && vocabState(s) !== 'new')
  const due = vocab.filter(s => dueAt(s) <= now)
  const pool = due.length ? due : vocab.filter(s => vocabState(s) === 'learning' && dueAt(s) <= now + LEARN_AHEAD)
  return pool.sort((a, b) => dueAt(a) - dueAt(b)).slice(0, limit).map(s => s.itemId)
}
