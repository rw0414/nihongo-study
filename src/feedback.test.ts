import { describe, expect, it } from 'vitest'
import { analyze, toErrorType } from './feedback'
import { diff, normalize } from './study'

const kinds = (answer: string, input: string) => {
  const a = normalize(answer), b = normalize(input)
  return analyze(a, b, diff(a, b)).map(f => f.kind)
}

describe('오답 상세 분석', () => {
  it('탁음', () => expect(kinds('がっこう', 'かっこう')).toEqual(['탁음']))
  it('촉음 누락', () => expect(kinds('がっこう', 'がこう')).toEqual(['촉음']))
  it('장음 누락', () => expect(kinds('せんせい', 'せんせ')).toEqual(['장음']))
  it('요음(작은 글자)', () => expect(kinds('きょう', 'きよう')).toEqual(['요음']))
  it('한자 표기(동음이의어)', () => expect(kinds('会社員', '会社印')).toEqual(['한자 표기']))
  it('가타카나↔히라가나', () => expect(kinds('ペン', 'ぺん')).toEqual(['가나 종류']))
  it('조사', () => expect(kinds('妻は主婦です', '妻が主婦です')).toEqual(['조사']))
  it('시제', () => expect(kinds('学生でした', '学生です')).toContain('시제'))
  it('부정', () => expect(kinds('学生じゃない', '学生だ')).toContain('부정'))
  it('정중체/보통체 혼동', () => expect(kinds('学生じゃありません', '学生じゃない')).toEqual(['정중체']))
  it('어순', () => expect(kinds('これはほん', 'ほんはこれ')).toEqual(['어순']))
  it('글자 누락', () => expect(kinds('日曜日です', '日曜です')).toEqual(['누락']))
  it('다른 단어', () => expect(kinds('主人は外国人です', '主人は日本人です')).toEqual(['단어']))
  it('여러 실수는 문법 먼저, 최대 3개', () => {
    const k = kinds('学校はあそこでした', 'かっこうがあそこです')
    expect(k[0]).toBe('시제')
    expect(k.length).toBeLessThanOrEqual(3)
  })
  it('큰 분류', () => {
    expect(toErrorType([{ kind: '정중체', text: '' }])).toBe('활용')
    expect(toErrorType([{ kind: '탁음', text: '' }])).toBe('표기')
    expect(toErrorType([])).toBe('기타')
  })
  it('조사 は를 소리대로 わ로 쓴 경우', () => {
    const f = analyze('これはじしょだ', 'これわじしょだ', diff('これはじしょだ', 'これわじしょだ'))
    expect(f[0]).toMatchObject({ kind: '조사', text: expect.stringContaining("'わ'로 읽지만") })
  })
})
