// 학습 통계 (Phase 5). 폰 안의 학습 기록(reviews·sessions)만으로 계산하는 순수 함수.
import type { Review, Session, UserSettings } from './db'
import { addDays } from './srs'

const CAP_MS = 90 * 60000 // 세션 하나를 최대 90분으로 (켜 두고 자리를 비운 경우)

/** 일별 학습 시간(분). 세션 시작~끝, 끝나지 않은 세션은 그 사이 마지막 답까지 */
export function minutesByDay(sessions: Session[], reviews: Review[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of sessions) {
    const end = s.endedAt ?? Math.max(s.startedAt, ...reviews.filter(r => r.date === s.date && r.at >= s.startedAt).map(r => r.at))
    const ms = Math.min(Math.max(end - s.startedAt, 0), CAP_MS)
    out.set(s.date, (out.get(s.date) ?? 0) + ms / 60000)
  }
  return out
}

/** 학습 완료로 인정한 날: 설정에 따라 '루틴 1회 완료' 또는 '목표 시간 달성' */
export function doneDays(sessions: Session[], minutes: Map<string, number>, st: UserSettings): Set<string> {
  if (st.streakRule === 'minutes') return new Set([...minutes].filter(([, m]) => m >= st.goalMinutes).map(([d]) => d))
  return new Set(sessions.filter(s => s.endedAt).map(s => s.date))
}

/** 가장 길었던 연속 학습일 */
export function bestStreak(days: Set<string>): number {
  let best = 0
  for (const d of days) {
    if (days.has(addDays(d, -1))) continue // 연속 구간의 첫날에서만 센다
    let n = 1
    while (days.has(addDays(d, n))) n++
    best = Math.max(best, n)
  }
  return best
}

export interface Rate { ok: number; total: number }
export const pct = (r: Rate) => (r.total ? Math.round((r.ok / r.total) * 100) : null)

/** 정답률 (단어/예문, 처음 학습/복습 구분) */
export function accuracy(reviews: Review[], type: Review['itemType'], phase?: Review['phase']): Rate {
  const rs = reviews.filter(r => r.itemType === type && (!phase || r.phase === phase))
  return { ok: rs.filter(r => r.correct).length, total: rs.length }
}

/** 주 단위(월요일 시작) 정답률 추이, 최근 n주 */
export function weeklyTrend(reviews: Review[], today: string, weeks = 8) {
  const d = new Date(today + 'T12:00:00')
  const monday = addDays(today, -((d.getDay() + 6) % 7))
  return Array.from({ length: weeks }, (_, k) => {
    const from = addDays(monday, -7 * (weeks - 1 - k)), to = addDays(from, 6)
    const rs = reviews.filter(r => r.date >= from && r.date <= to)
    return { week: from, vocab: pct(accuracy(rs, 'vocab')), sentence: pct(accuracy(rs, 'sentence')) }
  })
}

/** 평균 응답 시간(초). 2분 넘는 답(자리 비움)은 뺀다 */
export function avgResponse(reviews: Review[], type: Review['itemType']): number | null {
  const ms = reviews.filter(r => r.itemType === type && r.responseMs > 0 && r.responseMs < 120000).map(r => r.responseMs)
  return ms.length ? Math.round(ms.reduce((a, b) => a + b, 0) / ms.length / 100) / 10 : null
}

/** 지금까지 학습한 단어 수 (처음 본 날 기준) */
export function learnedByDay(reviews: Review[], type: Review['itemType']): Map<string, number> {
  const first = new Map<string, string>()
  for (const r of reviews) if (r.itemType === type && (!first.has(r.itemId) || r.date < first.get(r.itemId)!)) first.set(r.itemId, r.date)
  const out = new Map<string, number>()
  for (const day of first.values()) out.set(day, (out.get(day) ?? 0) + 1)
  return out
}

/** 교재 진도: 콘텐츠가 있는(학습 가능한) 단원 중 완료한 수 */
export function leafChaptersDone(chapters: { id: string; parentId: string | null; status: string }[], learnable: Set<string>) {
  const leaves = chapters.filter(c => learnable.has(c.id))
  return { done: leaves.filter(c => c.status === 'done').length, total: leaves.length }
}

