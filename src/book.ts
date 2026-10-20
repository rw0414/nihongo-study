// 교재 패키지 검증과 목차 계산. UI와 분리된 순수 함수라 테스트하기 쉽다.
import type { Chapter } from './db'

export interface PackageChapter {
  id: string
  parentId: string | null
  level: number
  title: string
  startPage: number
  endPage: number
}

export interface Manifest {
  format: 1
  id: string
  title: string
  pageCount: number
  printedPageOffset: number
  sourceFile: string
  sourceType: 'text' | 'scanned'
  tocPages: number[]
  chapters: PackageChapter[]
}

/** manifest.json 검증. 잘못된 패키지를 반쯤 저장하는 일을 막기 위해 저장 전에 전부 확인한다. */
export function parseManifest(json: unknown): Manifest {
  const m = json as Manifest
  const fail = (msg: string): never => { throw new Error(`교재 패키지 오류: ${msg}`) }
  if (!m || typeof m !== 'object') fail('manifest.json이 없습니다')
  if (m.format !== 1) fail(`지원하지 않는 형식(format=${m.format})`)
  if (!/^[0-9a-f]{16}$/.test(m.id)) fail('교재 ID가 올바르지 않습니다')
  if (!m.title) fail('제목이 없습니다')
  if (!Number.isInteger(m.pageCount) || m.pageCount < 1) fail('쪽수가 올바르지 않습니다')
  if (!Array.isArray(m.chapters)) fail('목차가 없습니다')
  const ids = new Set(m.chapters.map(c => c.id))
  for (const c of m.chapters) {
    if (!(c.startPage >= 1 && c.startPage <= c.endPage && c.endPage <= m.pageCount))
      fail(`목차 '${c.title}'의 쪽 범위(${c.startPage}~${c.endPage})가 올바르지 않습니다`)
    if (c.parentId !== null && !ids.has(c.parentId)) fail(`목차 '${c.title}'의 상위 항목이 없습니다`)
  }
  return m
}

/** 해당 쪽을 포함하는 가장 깊은(구체적인) 목차 */
export function chapterAt(chapters: Chapter[], page: number): Chapter | undefined {
  let best: Chapter | undefined
  for (const c of chapters)
    if (c.startPage <= page && page <= c.endPage && (!best || c.level > best.level)) best = c
  return best
}

/** 하위 항목이 없는 목차(실제 학습 단위) */
export function leafChapters(chapters: Chapter[]): Chapter[] {
  const parents = new Set(chapters.map(c => c.parentId))
  return chapters.filter(c => !parents.has(c.id))
}

/** 교재 진도율(0~1): 완료한 학습 단위 / 전체 학습 단위 */
export function progress(chapters: Chapter[]): number {
  const leaves = leafChapters(chapters)
  return leaves.length ? leaves.filter(c => c.status === 'done').length / leaves.length : 0
}

/** 화면 표시용 인쇄 쪽 번호 */
export const printedPage = (pdfPage: number, offset: number) => pdfPage - offset
