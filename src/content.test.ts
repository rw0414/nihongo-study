import { describe, expect, it } from 'vitest'
import { readFileSync, existsSync, readdirSync } from 'node:fs'
import { basename, join } from 'node:path'
import { parseUnit } from './content'

const base = {
  format: 1, bookId: 'b', chapterId: 'c-1', title: 't', pages: [1, 2],
  grammar: [{ id: 'g1', no: 1, pattern: '〜だ', meaning: '~이다', page: 1 }],
  cards: [{ id: 'k1', kind: 'practice', page: 1, title: 'x', blocks: [{ t: 'q', ref: 's1' }] }],
  sentences: [{ id: 's1', src: 'practice', grammar: ['g1'], page: 1, ko: '가', answers: ['A'] }],
  vocab: [{ id: 'v1', ja: '辞書', reading: 'じしょ', ko: '사전', origin: 'list' }],
}

describe('단원 콘텐츠 검증', () => {
  it('정상 통과', () => expect(parseUnit(base).chapterId).toBe('c-1'))
  it('없는 예문 참조 거부', () =>
    expect(() => parseUnit({ ...base, cards: [{ ...base.cards[0], blocks: [{ t: 'q', ref: 'zz' }] }] })).toThrow(/zz/))
  it('없는 문법 참조 거부', () =>
    expect(() => parseUnit({ ...base, sentences: [{ ...base.sentences[0], grammar: ['g9'] }] })).toThrow(/g9/))
  it('정답 없는 예문 거부', () =>
    expect(() => parseUnit({ ...base, sentences: [{ ...base.sentences[0], answers: [] }] })).toThrow(/정답/))
  it('잘못된 단어 출처 거부', () =>
    expect(() => parseUnit({ ...base, vocab: [{ ...base.vocab[0], origin: 'x' }] })).toThrow(/출처/))

  // 실제 변환 파일 전부 검증 (교재 파일은 저장소에 없으므로 없으면 건너뜀)
  const dirs = existsSync('books') ? readdirSync('books').map(d => join('books', d, 'content')).filter(existsSync) : []
  const files = dirs.flatMap(d => readdirSync(d).filter(f => f.endsWith('.json')).map(f => join(d, f)))
  it.each(files.length ? files : ['(없음)'])('변환 파일 %s', f => {
    if (f === '(없음)') return
    const u = parseUnit(JSON.parse(readFileSync(f, 'utf8')))
    expect(basename(f, '.json')).toBe(u.chapterId)
    expect(u.review, '선생님 검토 기록(review)이 없습니다').toBeTruthy()
    expect(u.sentences.every(s => s.kana?.length), '가나 읽기(kana)가 빠진 예문이 있습니다').toBe(true)
  })
})
