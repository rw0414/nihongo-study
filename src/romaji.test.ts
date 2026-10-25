import { describe, expect, it } from 'vitest'
import { toRomaji } from './romaji'

describe('가나 → 쿼티 입력', () => {
  it('기본·탁음·요음·촉음·ん', () => {
    expect(toRomaji('か')).toBe('ka')
    expect(toRomaji('がっこう')).toBe('gakkou')
    expect(toRomaji('きゃ')).toBe('kya')
    expect(toRomaji('しゃしん')).toBe('shashinn')
    expect(toRomaji('まっちゃ')).toBe('matcha')
    expect(toRomaji('ゃ')).toBe('xya')
    expect(toRomaji('っ')).toBe('xtu')
    expect(toRomaji('を')).toBe('wo')
  })
  it('가타카나·장음', () => {
    expect(toRomaji('カ')).toBe('ka')
    expect(toRomaji('コーヒー')).toBe('ko-hi-')
    expect(toRomaji('ファイル')).toBe('fairu')
  })
})
