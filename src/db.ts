// 로컬 데이터베이스 (브라우저 IndexedDB). 앱을 껐다 켜도 유지된다.
// 전체 데이터 모델은 docs/DESIGN.md 참고. Phase 1에서는 교재·목차·원문 페이지만 사용.
// 테이블을 추가할 때는 version(2).stores({...}) 처럼 버전을 올려서 추가한다 (기존 데이터 유지).
import Dexie, { type Table } from 'dexie'
import type { RawSentence, RawVocab, UnitContent } from './content'

export interface Book {
  id: string // 원본 PDF의 SHA-256 앞 16자리 → 같은 PDF 중복 등록 방지
  title: string
  pageCount: number
  printedPageOffset: number // PDF 쪽 = 인쇄 쪽 + offset
  sourceFile: string
  sourceType: 'text' | 'scanned'
  tocPages: number[]
  addedAt: number
  lastOpenedAt?: number
  lastPage: number
}

export type ChapterStatus = 'new' | 'reading' | 'done'

export interface Chapter {
  id: string // `${bookId}/${패키지 목차 id}`
  bookId: string
  parentId: string | null
  level: number // 0=마당, 1=마디, 2=과 (교재마다 다를 수 있음)
  order: number
  title: string
  startPage: number // PDF 기준 1부터
  endPage: number
  status: ChapterStatus
}

export interface SourcePage {
  bookId: string
  page: number // PDF 기준 1부터
  image: Blob
}

// ── Phase 2: 단원 콘텐츠 ──
// 단원 문서(카드·문법)는 통째로, 단어·예문은 개별 수정·학습 이력 연결을 위해 따로 저장한다.
export interface Unit {
  id: string // = Chapter.id
  bookId: string
  data: UnitContent
  status: 'review' | 'checked' // 검토 필요 / 검토 완료
  importedAt: number
}

export interface Vocab extends RawVocab {
  id: string // `${unitId}/${원본 id}`
  unitId: string
  bookId: string
  approved?: boolean // AI 제안 단어: undefined=대기, true=승인, false=삭제(숨김, 다시 가져와도 안 살아남)
  edited?: boolean // 사용자가 고친 항목은 콘텐츠를 다시 가져와도 덮어쓰지 않음
}

export interface Sentence extends RawSentence {
  id: string
  unitId: string
  bookId: string
  edited?: boolean
}

class StudyDB extends Dexie {
  books!: Table<Book, string>
  chapters!: Table<Chapter, string>
  pages!: Table<SourcePage, [string, number]>
  units!: Table<Unit, string>
  vocab!: Table<Vocab, string>
  sentences!: Table<Sentence, string>

  constructor() {
    super('nihongo-study')
    this.version(1).stores({
      books: 'id, lastOpenedAt',
      chapters: 'id, bookId, [bookId+order]',
      pages: '[bookId+page], bookId',
    })
    this.version(2).stores({
      units: 'id, bookId',
      vocab: 'id, unitId, bookId, ja',
      sentences: 'id, unitId, bookId',
    })
  }
}

export const db = new StudyDB()

export async function deleteBook(bookId: string) {
  await db.transaction('rw', [db.books, db.chapters, db.pages, db.units, db.vocab, db.sentences], async () => {
    for (const t of [db.units, db.vocab, db.sentences]) await t.where('bookId').equals(bookId).delete()
    await db.pages.where('bookId').equals(bookId).delete()
    await db.chapters.where('bookId').equals(bookId).delete()
    await db.books.delete(bookId)
  })
}
