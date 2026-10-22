import { describe, expect, it } from 'vitest'
import { dayContent, diff, grade, nextDay, normalize, pickSentences, pickVocab, streak } from './study'
import type { UnitContent } from './content'

const s = { answers: ['妻は主婦ではありません。'], alts: ['妻は主婦じゃありません。'], kana: ['つまはしゅふではありません。', 'つまはしゅふじゃありません。'] }

describe('예문 채점', () => {
  it('공백·문장부호는 무시', () => expect(normalize(' 妻は 主婦。 ')).toBe('妻は主婦'))
  it('교재 정답과 같으면 정답', () => expect(grade('妻は主婦ではありません', s)).toMatchObject({ ok: true, score: 100 }))
  it('허용 답안도 정답', () => expect(grade('妻は主婦じゃありません。', s).ok).toBe(true))
  it('가나로만 써도 정답 (가나 표시)', () => expect(grade('つまはしゅふじゃありません', s)).toMatchObject({ ok: true, kanaOnly: true }))
  it('조사 하나 틀리면 부분 점수 + 조사 힌트', () => {
    const g = grade('妻が主婦ではありません。', s)
    expect(g.ok).toBe(false)
    expect(g.particleHint).toBe(true)
    expect(g.score).toBeGreaterThan(80)
    expect(g.diff).toContainEqual({ t: 'miss', s: 'は' })
    expect(g.diff).toContainEqual({ t: 'extra', s: 'が' })
  })
  it('많이 다르면 조사 힌트 없음', () => expect(grade('学生です', s).particleHint).toBe(false))
  it('diff는 두 문자열을 그대로 복원', () => {
    const d = diff('abcde', 'abxde')
    expect(d.filter(p => p.t !== 'extra').map(p => p.s).join('')).toBe('abcde')
    expect(d.filter(p => p.t !== 'miss').map(p => p.s).join('')).toBe('abxde')
  })
})

describe('연속 학습일', () => {
  it('오늘까지 이어진 날', () => expect(streak(['2026-10-19', '2026-10-20', '2026-10-21'], '2026-10-21')).toBe(3))
  it('오늘 아직이면 어제부터', () => expect(streak(['2026-10-19', '2026-10-20'], '2026-10-21')).toBe(2))
  it('끊기면 0', () => expect(streak(['2026-10-18'], '2026-10-21')).toBe(0))
  it('월말을 넘어도 이어짐', () => expect(streak(['2026-09-30', '2026-10-01'], '2026-10-01')).toBe(2))
})

describe('하루 분량', () => {
  const u = {
    cards: [
      { id: 'k1', kind: 'grammar', grammar: 'g1', page: 10, title: '', blocks: [] },
      { id: 'k2', kind: 'practice', grammar: 'g1', page: 10, title: '', blocks: [{ t: 'q', ref: 's-p1-1' }] },
      { id: 'k3', kind: 'grammar', grammar: 'g2', page: 12, title: '', blocks: [] },
      { id: 'k4', kind: 'drill', page: 14, title: '', blocks: [{ t: 'q', ref: 's-d1-1' }] },
    ],
    parts: [{ id: 'p1', title: '(1)', cards: ['k1', 'k2'] }, { id: 'p2', title: '(2)', cards: ['k3', 'k4'] }],
  } as unknown as UnitContent
  const U = 'b/c-1'
  const sents = [
    { id: `${U}/s-e1`, grammar: ['g1'], page: 10 }, { id: `${U}/s-e2`, grammar: ['g2'], page: 12 },
    { id: `${U}/s-p1-1`, grammar: ['g1'], page: 10 }, { id: `${U}/s-d1-1`, grammar: ['g1'], page: 14 },
  ]
  const vocab = [
    { id: 'v1', origin: 'list', page: 10 }, { id: 'v2', origin: 'list', page: 13 }, { id: 'v3', origin: 'text', page: 10 },
    { id: 'v4', origin: 'ai', approved: true }, { id: 'v5', origin: 'ai', approved: false },
  ]
  it('part 1: 그날 카드·예문·단어만', () => {
    const d = dayContent(u, 'p1')
    expect(d.cards.map(c => c.id)).toEqual(['k1', 'k2'])
    expect(pickSentences(sents, d, U).map(s => s.id.split('/').pop())).toEqual(['s-e1', 's-p1-1'])
    expect(pickVocab(vocab, d, false).map(v => v.id)).toEqual(['v1'])
  })
  it('마지막 part: 실력 다지기와 승인된 AI 단어 포함', () => {
    const d = dayContent(u, 'p2')
    expect(pickSentences(sents, d, U).map(s => s.id.split('/').pop())).toEqual(['s-e2', 's-d1-1'])
    expect(pickVocab(vocab, d, true).map(v => v.id)).toEqual(['v2', 'v4'])
  })
  it('나누지 않은 단원은 전체', () => expect(dayContent(u).cards).toHaveLength(4))
})

describe('오늘의 학습 고르기', () => {
  const chapters = [{ id: 'b/c-2', title: '02', order: 2 }, { id: 'b/c-1', title: '01', order: 1 }, { id: 'b/c-3', title: '03', order: 3 }]
  const units = new Map([
    ['b/c-1', { data: { cards: [], sentences: [] } }],
    ['b/c-2', { data: { cards: [], sentences: [], parts: [{ id: 'p1', title: '(1)', cards: [] }, { id: 'p2', title: '(2)', cards: [] }] } }],
  ])
  it('처음엔 첫 단원', () => expect(nextDay(chapters, units, new Set())?.unitId).toBe('b/c-1'))
  it('나눈 단원은 part 순서대로', () => expect(nextDay(chapters, units, new Set(['b/c-1#all', 'b/c-2#p1']))).toMatchObject({ unitId: 'b/c-2', partId: 'p2' }))
  it('콘텐츠 없는 단원은 건너뛰고, 다 끝나면 없음', () => expect(nextDay(chapters, units, new Set(['b/c-1#all', 'b/c-2#p1', 'b/c-2#p2']))).toBeUndefined())
})

describe('유연한 로컬 채점', () => {
  const s2 = { answers: ['主人は外国人じゃありません。'], kana: ['しゅじんはがいこくじんじゃありません。'] }
  const R: [string, string][] = [['外国人', 'がいこくじん'], ['主人', 'しゅじん']]
  it('한자·가나를 섞어 써도 정답', () => expect(grade('主人はがいこくじんじゃありません', s2, R)).toMatchObject({ ok: true, kanaOnly: true }))
  it('사용자가 맞게 처리한 답도 정답', () => expect(grade('主人は外国人じゃないです', { ...s2, userAlts: ['主人は外国人じゃないです。'] }).ok).toBe(true))
  it('끝 활용(시제)만 틀리면 활용 오류', () => expect(grade('辞書だ', { answers: ['辞書だった'] }).errorType).toBe('활용'))
  it('다른 명사를 쓰면 기타(단어)', () => expect(grade('主人は日本人じゃありません', s2).findings[0].kind).toBe('단어'))
  it('가나로 쓰다 틀려도 가나끼리 비교해서 정확히 짚음', () => expect(grade('しゅじんはかいこくじんじゃありません', s2, R).findings[0].kind).toBe('탁음'))
  it('조사만 틀리면 조사', () => expect(grade('主人が外国人じゃありません', s2).errorType).toBe('조사'))
})
