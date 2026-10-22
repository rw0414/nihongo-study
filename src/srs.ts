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
