import { describe, expect, it } from 'vitest'
import { addDays, dueToday, newSched, recovery, relatedPicks, review, sentenceGrade, type Sched , vocabAnswer } from './srs'

const T = '2026-10-21'
const s0 = newSched('v1', 'vocab', 'b/c-1', T)

describe('간격 반복', () => {
  it('날짜 더하기 (월말·윤년)', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29')
  })
  it('계속 맞히면 간격이 1일 → 3일 → 7~8일로 늘어남', () => {
    const a = review(s0, 'good', T)
    expect([a.interval, a.due]).toEqual([1, '2026-10-22'])
    const b = review(a, 'good', a.due)
    expect(b.interval).toBe(3)
    const c = review(b, 'good', b.due)
    expect(c.interval).toBe(8) // 3 × 2.5
  })
  it('틀리면 내일 다시, 간격 초기화, 쉬움 정도 하락', () => {
    const b = review(review(s0, 'good', T), 'good', '2026-10-22')
    const w = review(b, 'again', '2026-10-25')
    expect([w.interval, w.due, w.reps, w.lapses, w.wrongCount, w.streak]).toEqual([1, '2026-10-26', 0, 1, 1, 0])
    expect(w.ease).toBeCloseTo(2.3)
  })
  it('쉬움은 더 길게', () => expect(review(s0, 'easy', T).interval).toBe(3))
  it('같은 날 두 번째 답은 일정을 바꾸지 않음 (같은 날 재노출 ≠ 다음 날 복습)', () => {
    const a = review(s0, 'again', T)
    expect(review(a, 'good', T)).toBe(a)
  })
  it('예문 채점 → 등급', () => {
    expect(sentenceGrade({ ok: true, score: 100 }).grade).toBe('good')
    expect(sentenceGrade({ ok: false, score: 89, particleHint: true })).toEqual({ grade: 'hard', error: '조사' })
    expect(sentenceGrade({ ok: false, score: 40 })).toEqual({ grade: 'again', error: '기타' })
    expect(sentenceGrade(null)).toEqual({ grade: 'again', error: '모름' })
  })
})

describe('오늘 복습할 항목', () => {
  const mk = (id: string, due: string, last = '', wrong = 0): Sched => ({ ...newSched(id, 'vocab', 'u', T), due, lastDate: last, wrongCount: wrong })
  const all = [mk('a', '2026-10-21'), mk('b', '2026-10-19'), mk('c', '2026-10-25'), mk('d', '2026-10-20', T), mk('e', '2026-10-21', '', 3)]
  it('지난 것부터, 오늘 본 것·미래·제외 항목 빼고', () => expect(dueToday(all, T, 'vocab', new Set(['a']), 10)).toEqual(['b', 'e']))
  it('개수 제한', () => expect(dueToday(all, T, 'vocab', new Set(), 1)).toEqual(['b']))
})

describe('오답 회복과 취약 문법', () => {
  it('회복 단계', () => {
    let s = review(s0, 'again', T)
    expect(recovery(s)).toBe('weak')
    s = review(s, 'good', '2026-10-22'); expect(recovery(s)).toBe('recovering')
    s = review(s, 'good', '2026-10-23'); s = review(s, 'good', '2026-10-26'); expect(recovery(s)).toBe('recovered')
  })
  it('같은 문법을 2개 이상 틀리면 같은 문법의 다른 예문 추가', () => {
    const sents = [{ id: 's1', grammar: ['g1'] }, { id: 's2', grammar: ['g1'] }, { id: 's3', grammar: ['g1'] }, { id: 's4', grammar: ['g2'] }]
    const wrong = (id: string) => ({ ...newSched(id, 'sentence', 'u', T), wrongCount: 1 })
    expect(relatedPicks('g1', sents, new Map([['s1', wrong('s1')]]))).toEqual([])
    expect(relatedPicks('g1', sents, new Map([['s1', wrong('s1')], ['s2', wrong('s2')]]))).toEqual(['s3'])
  })
})

describe('예문 오답 집계', () => {
  it('조사 하나 틀린 예문(어려움)도 오답으로 세고 원인을 남김', () => {
    const s = review(newSched('s1', 'sentence', 'u', T), 'hard', T, '조사', false)
    expect([s.wrongCount, s.streak, s.errors['조사'], s.interval]).toEqual([1, 0, 1, 1])
  })
})

describe('단어 안키 주기', () => {
  const t = '2026-10-22'
  const fresh = newSched('v1', 'vocab', 'u', t)
  it('새 단어는 알고 있음 두 번에 졸업, 1일 뒤', () => {
    const a = vocabAnswer(fresh, undefined, true, t)
    expect(a.learn).toMatchObject({ left: 1 })
    const b = vocabAnswer(a.sched, a.learn, true, t)
    expect(b.learn).toBeUndefined()
    expect(b.sched).toMatchObject({ reps: 1, interval: 1, due: '2026-10-23', wrongCount: 0 })
  })
  it('모름이면 학습 단계 처음부터, 졸업해도 오답으로 셈', () => {
    const a = vocabAnswer(fresh, undefined, true, t)
    const b = vocabAnswer(a.sched, a.learn, false, t)
    expect(b.learn).toMatchObject({ left: 2, wrong: true })
    const c = vocabAnswer(b.sched, b.learn, true, t), d = vocabAnswer(c.sched, c.learn, true, t)
    expect(d.sched).toMatchObject({ wrongCount: 1, interval: 1 })
  })
  it('복습: 알고 있음은 간격 × 2.5', () => {
    const r = vocabAnswer({ ...fresh, reps: 2, interval: 4, lastDate: '2026-10-18' }, undefined, true, t)
    expect(r.sched).toMatchObject({ interval: 10, due: '2026-11-01', reps: 3 })
  })
  it('복습: 모름은 ease −0.2, 한 번 다시 학습 후 1일 뒤', () => {
    const a = vocabAnswer({ ...fresh, reps: 3, interval: 10, lastDate: '2026-10-12' }, undefined, false, t)
    expect(a.sched).toMatchObject({ ease: 2.3, lapses: 1, reps: 0, due: '2026-10-23' })
    const b = vocabAnswer(a.sched, a.learn, true, t)
    expect(b.learn).toBeUndefined()
    expect(b.sched).toMatchObject({ interval: 1, due: '2026-10-23', wrongCount: 1, streak: 0 })
  })
  it('오늘 이미 끝낸 단어는 일정을 바꾸지 않음', () => {
    const done = { ...fresh, reps: 1, interval: 1, lastDate: t, due: '2026-10-23' }
    expect(vocabAnswer(done, undefined, true, t)).toEqual({ sched: done })
  })
})
