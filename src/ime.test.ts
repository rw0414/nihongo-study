import { describe, expect, it } from 'vitest'
import { feed, flush, backspace, type ImeState } from './ime'

const type = (keys: string, kata = false) => { let s: ImeState = { text: '', buf: '' }; for (const k of keys) s = feed(s, k, kata); return flush(s, kata) }

describe('앱 키보드 로마자 입력', () => {
  it('기본·요음·촉음·ん', () => {
    expect(type('watashiha')).toBe('わたしは')
    expect(type('gakkou')).toBe('がっこう')
    expect(type('kyou')).toBe('きょう')
    expect(type('kanji')).toBe('かんじ')
    expect(type('honnya')).toBe('ほんや')
    expect(type('hon')).toBe('ほん')
    expect(type('matcha')).toBe('まっちゃ')
    expect(type('xya')).toBe('ゃ')
    expect(type('sinbun')).toBe('しんぶん')
    expect(type('jya')).toBe('じゃ')
  })
  it('가타카나·장음·문장부호', () => {
    expect(type('ko-hi-', true)).toBe('コーヒー')
    expect(type('famiri-', true)).toBe('ファミリー')
    expect(type('hai.')).toBe('はい。')
  })
  it('입력 중 상태와 지우기', () => {
    let s: ImeState = { text: '', buf: '' }
    for (const k of 'ky') s = feed(s, k)
    expect(s).toEqual({ text: '', buf: 'ky' })
    s = backspace(s)
    expect(s).toEqual({ text: '', buf: 'k' })
    s = feed(s, 'a')
    expect(backspace(s)).toEqual({ text: '', buf: '' })
  })
})
