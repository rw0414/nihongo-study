import { describe, expect, it } from 'vitest'
import { align, bracketPairs, buildDict, rubySegments } from './furigana'

describe('후리가나', () => {
  it('문장과 읽기를 맞춰 한자마다 읽기', () =>
    expect(align('主人は外国人じゃありません。', 'しゅじんはがいこくじんじゃありません。')).toEqual([
      { t: '主人', r: 'しゅじん' }, { t: 'は' }, { t: '外国人', r: 'がいこくじん' }, { t: 'じゃありません。' },
    ]))
  it('送り仮名(오쿠리가나)도 맞춤', () => expect(align('朝ごはん', 'あさごはん')).toEqual([{ t: '朝', r: 'あさ' }, { t: 'ごはん' }]))
  it('맞지 않으면 통째로', () => expect(align('学生', 'がっこう です')).toEqual([{ t: '学生', r: 'がっこう です' }]))
  it('본문의 [읽기] 표기', () => expect(bracketPairs("'사전'은 辞書[じしょ]라고 해요. 辞典[じ てん]")).toEqual([['辞書', 'じしょ'], ['辞典', 'じてん']]))
  const dict = buildDict([['外国人', 'がいこくじん'], ['人', 'ひと'], ['日本', 'にほん'], ['今日', 'きょう']])
  it('사전으로 본문 한자에 읽기, 괄호 표기는 후리가나로 바꾸고 괄호 삭제', () =>
    expect(rubySegments('今日は辞書[じしょ]と外国人', dict)).toEqual([
      { t: '今日', r: 'きょう' }, { t: 'は' }, { t: '辞書', r: 'じしょ' }, { t: 'と' }, { t: '外国人', r: 'がいこくじん' },
    ]))
  it('모르는 덩어리는 긴 단어부터 쪼개고, 끝까지 모르는 한자는 그대로', () =>
    expect(rubySegments('日本人と猫', dict)).toEqual([{ t: '日本', r: 'にほん' }, { t: '人', r: 'ひと' }, { t: 'と' }, { t: '猫' }]))
  it('한국어 문장 속 한자도 처리, 한글은 그대로', () => expect(rubySegments('人은 사람', dict)).toEqual([{ t: '人', r: 'ひと' }, { t: '은 사람' }]))
})
