import { describe, expect, it } from 'vitest'
import { chapterAt, parseManifest, progress } from './book'
import type { Chapter } from './db'

const ch = (id: string, parentId: string | null, level: number, s: number, e: number, status: Chapter['status'] = 'new'): Chapter =>
  ({ id, bookId: 'b', parentId, level, order: 0, title: id, startPage: s, endPage: e, status })

const chapters = [
  ch('part', null, 0, 20, 60),
  ch('sec', 'part', 1, 22, 60),
  ch('u1', 'sec', 2, 23, 29, 'done'),
  ch('u2', 'sec', 2, 30, 60),
]

describe('목차 계산', () => {
  it('가장 깊은 목차를 찾는다', () => {
    expect(chapterAt(chapters, 25)?.id).toBe('u1')
    expect(chapterAt(chapters, 21)?.id).toBe('part')
    expect(chapterAt(chapters, 5)).toBeUndefined()
  })
  it('진도율은 학습 단위(하위 항목 없는 목차) 기준', () => {
    expect(progress(chapters)).toBe(0.5)
  })
})

describe('manifest 검증', () => {
  const good = {
    format: 1, id: '0123456789abcdef', title: 't', pageCount: 60, printedPageOffset: 0,
    sourceFile: 'a.pdf', sourceType: 'scanned', tocPages: [],
    chapters: [{ id: 'c-1', parentId: null, level: 0, title: 'x', startPage: 1, endPage: 60 }],
  }
  it('정상 패키지 통과', () => expect(parseManifest(good).id).toBe(good.id))
  it('쪽 범위 오류 거부', () =>
    expect(() => parseManifest({ ...good, chapters: [{ ...good.chapters[0], endPage: 61 }] })).toThrow(/쪽 범위/))
  it('없는 상위 목차 거부', () =>
    expect(() => parseManifest({ ...good, chapters: [{ ...good.chapters[0], parentId: 'zz' }] })).toThrow(/상위/))
  it('형식 오류 거부', () => expect(() => parseManifest({ ...good, format: 2 })).toThrow(/형식/))
})
