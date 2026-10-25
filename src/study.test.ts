import { describe, expect, it } from 'vitest'
import { dayContent, diff, grade, nextDay, normalize, pickSentences, pickVocab, streak, chunks, shuffle, traps, orderSentences, stagePercent, stars } from './study'
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

describe('맛보기 블록', () => {
  it('단어·조사로 나누고 활용 어미는 붙임', () => {
    expect(chunks('これは辞書だ。')).toEqual(['これ', 'は', '辞書', 'だ'])
    expect(chunks('夜の外出は危険だった')).toEqual(['夜', 'の', '外出', 'は', '危険', 'だった'])
    expect(chunks('祖母は不幸じゃありません')).toEqual(['祖母', 'は', '不幸', 'じゃ', 'ありません'])
    expect(chunks('その国は安全じゃなかった').join('|')).toMatch(/なかった$/)
    expect(chunks('その メールは迷惑でした').slice(-1)).toEqual(['でした'])
  })
  it('섞으면 순서가 바뀜', () => expect(shuffle(['a', 'b', 'c'])).not.toEqual(['a', 'b', 'c']))
})

describe('실력 다지기 중복 제거', () => {
  const day = { cards: [], pages: [1, 1] as [number, number], grammarIds: new Set(['g1']), sentenceRefs: new Set(['s-d1', 's-d2']) }
  const all = [
    { id: 'u/s-e1', src: 'example', grammar: ['g1'], page: 1, answers: ['これは本だ。'] },
    { id: 'u/s-d1', src: 'drill', grammar: [], page: 1, answers: ['これは 本だ'] },
    { id: 'u/s-d2', src: 'drill', grammar: [], page: 1, answers: ['それは本だ'] },
  ]
  it('본문 예문과 같은 실력 다지기 문제는 빠짐', () => expect(pickSentences(all, day, 'u').map(s => s.id)).toEqual(['u/s-e1', 'u/s-d2']))
})

describe('맛보기 함정·예문 순서', () => {
  const seq = (...xs: number[]) => { let i = 0; return () => xs[i++ % xs.length] }
  it('함정은 문장 길이에 따라 1~3개, 정답 블록과 겹치지 않음', () => {
    const b = ['私', 'は', '韓国人', 'じゃ', 'ありません', 'でした']
    const t = traps(b, ['日本人', '私たち', '韓国'], seq(0))
    expect(t).toHaveLength(2)
    expect(t[0]).toBe('が')
    expect(t.some(x => b.includes(x))).toBe(false)
    expect(traps(['冬', 'は', '寒い'], [], seq(0))).toEqual(['が'])
    expect(traps(['この', '部屋', 'は', '狭い', 'です', 'ね', 'とても'], [], seq(0.99))).toContain('広い')
  })
  it('큰 문제 순서는 지키고 안에서는 섞음', () => {
    const cards = [
      { id: 'a', kind: 'grammar', page: 1, title: '', grammar: 'g1', blocks: [] },
      { id: 'b', kind: 'drill', page: 2, title: '', blocks: [{ t: 'p', text: '① 표' }, { t: 'q', ref: 'd1' }, { t: 'q', ref: 'd2' }, { t: 'p', text: '② 문장' }, { t: 'q', ref: 'd3' }] },
    ] as never
    const S = [{ id: 'u/d3', grammar: [] }, { id: 'u/d1', grammar: [] }, { id: 'u/s-e1', grammar: ['g1'] }, { id: 'u/d2', grammar: [] }]
    const o = orderSentences(S, cards, 'u', seq(0.9, 0.1)).map(s => s.id)
    expect(o[0]).toBe('u/s-e1')
    expect(o.slice(1, 3).sort()).toEqual(['u/d1', 'u/d2'])
    expect(o[3]).toBe('u/d3')
  })
})

describe('로드맵', () => {
  it('단계 진행률', () => {
    expect(stagePercent('vocab')).toBe(0)
    expect(stagePercent('vocab', { step: 'vocab', queue: ['a', 'b'], i: 1 })).toBe(35)
    expect(stagePercent('vocab', { step: 'vocab-review', queue: ['a'], i: 0 })).toBe(70)
    expect(stagePercent('grammar', { step: 'grammar', queue: ['a', 'b', 'c', 'd'], i: 3 })).toBe(75)
    expect(stagePercent('sentence', { step: 'done', queue: [], i: 0 })).toBe(100)
  })
  it('별 개수', () => {
    expect(stars({ vocab: 10, vocabOk: 10, sentences: 10, sentencesOk: 9 })).toBe(3)
    expect(stars({ vocab: 10, vocabOk: 7, sentences: 0, sentencesOk: 0 })).toBe(2)
    expect(stars({ vocab: 10, vocabOk: 3, sentences: 10, sentencesOk: 5 })).toBe(1)
  })
})
