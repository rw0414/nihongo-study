import { describe, expect, it } from 'vitest'
import { align, bracketPairs, buildDict, rubySegments } from './furigana'

const ruby = (segs: { t: string; r?: string }[]) => segs.map(s => (s.r ? `${s.t}(${s.r})` : s.t)).join('')

describe('후리가나', () => {
  it('문장과 읽기를 맞춰 한자마다 읽기', () =>
    expect(align('主人は外国人じゃありません。', 'しゅじんはがいこくじんじゃありません。')).toEqual([
      { t: '主人', r: 'しゅじん' }, { t: 'は' }, { t: '外国人', r: 'がいこくじん' }, { t: 'じゃありません。' },
    ]))
  it('숫자가 섞여도 맞춤 (4時 よじ), 문장부호 차이는 무시', () => {
    expect(ruby(align('約束は4時じゃありませんでした。', 'やくそくはよじじゃありませんでした。'))).toBe('約束(やくそく)は4時(よじ)じゃありませんでした。')
    expect(ruby(align('8時を過ぎれば電車は空きます。', 'はちじをすぎれば、でんしゃはすきます。'))).toBe('8時(はちじ)を過(す)ぎれば電車(でんしゃ)は空(す)きます。')
  })
  it('送り仮名(오쿠리가나)도 맞춤', () => expect(align('朝ごはん', 'あさごはん')).toEqual([{ t: '朝', r: 'あさ' }, { t: 'ごはん' }]))
  it('맞지 않으면 통째로', () => expect(align('学生', 'がっこう です')).toEqual([{ t: '学生', r: 'がっこうです' }]))
  it('본문의 [읽기] 표기', () => expect(bracketPairs("'사전'은 辞書[じしょ]라고 해요. 1本[いっ ぽん] お店[おみせ] それは有名な人[ゆうめいなひと]")).toEqual([['辞書', 'じしょ'], ['1本', 'いっぽん'], ['お店', 'おみせ'], ['有名な人', 'ゆうめいなひと']]))
  it('[읽기]는 낱말 전체에 맞춰 붙임', () => expect(ruby(rubySegments('それは有名な人[ゆうめいなひと]だ。お店[おみせ]', new Map()))).toBe('それは有名(ゆうめい)な人(ひと)だ。お店(みせ)'))

  const dict = buildDict([['外国人', 'がいこくじん'], ['人', 'ひと'], ['日本', 'にほん'], ['今日', 'きょう'], ['時', 'とき'], ['若い時は', 'わかいときは'],
    ['何を', 'なにを'], ['何で', 'なんで'], ['生きる', 'いきる'], ['本', 'ほん']])
  it('사전으로 본문 한자에 읽기, 괄호 표기는 후리가나로 바꾸고 괄호 삭제', () =>
    expect(ruby(rubySegments('今日は辞書[じしょ]と外国人', dict))).toBe('今日(きょう)は辞書(じしょ)と外国人(がいこくじん)'))
  it('숫자+조수사는 규칙으로 (사전의 時=とき를 쓰지 않음)', () => {
    expect(ruby(rubySegments('約束は４時です', dict))).toBe('約束は４時(よじ)です')
    expect(ruby(rubySegments('14時と9時と3本と1人と20日', dict))).toBe('14時(じゅうよじ)と9時(くじ)と3本(さんぼん)と1人(ひとり)と20日(はつか)')
    expect(ruby(rubySegments('若い時は', dict))).toBe('若(わか)い時(とき)は')
    expect(ruby(rubySegments('30分と2ヶ月と5,000万円', dict))).toBe('30分(さんじゅっぷん)と2ヶ月(にかげつ)と5,000万円(ごせんまんえん)')
    expect(ruby(rubySegments('1日に', dict))).toBe('1日に') // ついたち/いちにち 모름
    expect(ruby(rubySegments('渋い色[いろ]の', dict))).toBe('渋い色(いろ)の')
    expect(ruby(rubySegments('ながら歩き[ながらあるき] 하면서', dict))).toBe('ながら歩(ある)き 하면서')
  })
  it('읽기가 여러 개면 뒤 글자로 고르고, 모르면 달지 않음', () => {
    expect(ruby(rubySegments('何をする', dict))).toBe('何(なに)をする')
    expect(ruby(rubySegments('何でも', dict))).toBe('何(なん)でも')
    expect(ruby(rubySegments('何が', dict))).toBe('何が')
  })
  it('같은 한자라도 다른 활용(오쿠리가나)이면 달지 않음', () => {
    expect(ruby(rubySegments('生きる', dict))).toBe('生(い)きる')
    expect(ruby(rubySegments('生まれる', dict))).toBe('生まれる')
  })
  it('모르는 덩어리는 긴 단어부터 쪼개되, 한 글자 조각은 읽기를 달지 않음', () =>
    expect(ruby(rubySegments('日本人と猫', dict))).toBe('日本(にほん)人と猫'))
  it('한국어 문장 속 한자도 처리, 한글은 그대로', () => expect(ruby(rubySegments('人은 사람', dict))).toBe('人(ひと)은 사람'))
})
