import { describe, expect, it } from 'vitest'
import { accuracy, avgResponse, bestStreak, doneDays, learnedByDay, minutesByDay, pct, weeklyTrend } from './stats'
import type { Review, Session } from './db'

const T0 = new Date('2026-10-20T09:00:00').getTime()
const sess = (date: string, start: number, mins?: number): Session => ({
  key: 'k', unitId: 'b/c-1', date, startedAt: start, endedAt: mins === undefined ? undefined : start + mins * 60000,
  state: { step: 'done', queue: [], i: 0, wrongV: [], wrongS: [], tries: {} }, stats: { vocab: 0, vocabOk: 0, sentences: 0, sentencesOk: 0, cards: 0 },
})
const rev = (date: string, at: number, type: Review['itemType'], correct: boolean, phase: Review['phase'] = 'new', id = 'x', ms = 3000): Review =>
  ({ itemId: id, itemType: type, unitId: 'b/c-1', date, at, phase, correct, responseMs: ms })

describe('학습 시간과 완료한 날', () => {
  const sessions = [sess('2026-10-20', T0, 12), sess('2026-10-20', T0 + 3600000, 5), sess('2026-10-21', T0 + 86400000)]
  const reviews = [rev('2026-10-21', T0 + 86400000 + 4 * 60000, 'vocab', true)]
  const m = minutesByDay(sessions, reviews)
  it('하루에 여러 세션은 합산, 끝나지 않은 세션은 마지막 답까지', () => {
    expect(m.get('2026-10-20')).toBe(17)
    expect(m.get('2026-10-21')).toBe(4)
  })
  it('기준: 루틴 완료 / 목표 시간', () => {
    expect([...doneDays(sessions, m, { goalMinutes: 15, streakRule: 'routine' })]).toEqual(['2026-10-20'])
    expect([...doneDays(sessions, m, { goalMinutes: 3, streakRule: 'minutes' })].sort()).toEqual(['2026-10-20', '2026-10-21'])
  })
  it('최장 연속 학습', () => expect(bestStreak(new Set(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-05']))).toBe(3))
})

describe('정답률·응답 시간', () => {
  const rs = [rev('2026-10-19', 1, 'vocab', true), rev('2026-10-19', 2, 'vocab', false), rev('2026-10-20', 3, 'vocab', true, 'review'),
    rev('2026-10-20', 4, 'sentence', false, 'new', 's', 9000), rev('2026-10-20', 5, 'sentence', true, 'new', 's', 999999)]
  it('처음/복습 구분', () => {
    expect(pct(accuracy(rs, 'vocab', 'new'))).toBe(50)
    expect(pct(accuracy(rs, 'vocab', 'review'))).toBe(100)
    expect(pct(accuracy(rs, 'sentence'))).toBe(50)
    expect(pct(accuracy([], 'vocab'))).toBeNull()
  })
  it('주별 추이: 이번 주(월요일 시작)가 마지막', () => {
    const w = weeklyTrend(rs, '2026-10-21', 2)
    expect(w.map(x => x.week)).toEqual(['2026-10-12', '2026-10-19'])
    expect(w[1].vocab).toBe(67)
    expect(w[0].vocab).toBeNull()
  })
  it('평균 응답 시간은 2분 넘는 답 제외', () => expect(avgResponse(rs, 'sentence')).toBe(9))
  it('처음 본 날 기준 학습 수', () => expect(learnedByDay([rev('2026-10-19', 1, 'vocab', true, 'new', 'a'), rev('2026-10-20', 2, 'vocab', true, 'review', 'a'), rev('2026-10-20', 3, 'vocab', true, 'new', 'b')], 'vocab'))
    .toEqual(new Map([['2026-10-19', 1], ['2026-10-20', 1]])))
})
