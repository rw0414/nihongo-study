// 로컬 데이터베이스 (브라우저 IndexedDB). 앱을 껐다 켜도 유지된다.
// 전체 데이터 모델은 docs/DESIGN.md 참고.
// 테이블을 추가할 때는 version(2).stores({...}) 처럼 버전을 올려서 추가한다 (기존 데이터 유지).
import Dexie, { type Table } from 'dexie'
import type { RawSentence, RawVocab, UnitContent } from './content'
import { newSched, review as applyReview, sentenceGrade, type Sched } from './srs'

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
  userAlts?: string[] // 사용자가 '맞게 처리'한 답 (내 판단으로 정답)
  teacherAsk?: string[] // '선생님 확인 요청'한 답 — 나중에 Claude Code에서 검토
}

// ── Phase 3: 학습 기록 ──
export type VocabGrade = 'again' | 'hard' | 'good' | 'easy' // 다시 / 어려움 / 알맞음 / 쉬움

/** 답 하나하나의 기록 (ReviewHistory). Phase 4 복습 일정 계산과 Phase 5 통계의 원천 */
export interface Review {
  id?: number
  itemType: 'vocab' | 'sentence'
  itemId: string
  unitId: string
  date: string // 현지 날짜 YYYY-MM-DD
  at: number
  phase: 'new' | 'review' // 처음 학습 / 같은 날 틀린 것 다시
  correct: boolean
  grade?: VocabGrade
  score?: number // 예문 점수 0~100
  answer?: string // 예문 입력값
  responseMs: number
}

export type Step = 'vocab' | 'vocab-intro' | 'vocab-review' | 'grammar' | 'sentence' | 'sentence-intro' | 'sentence-review' | 'done'
/** 하루 루틴의 세 단계. 홈에서 원하는 단계부터 골라서 할 수 있고, 단계마다 진행 위치를 따로 기억한다 */
export type Stage = 'vocab' | 'grammar' | 'sentence'
export const STAGES: Stage[] = ['vocab', 'grammar', 'sentence']
export interface Cursor { step: Step; queue: string[]; i: number } // step 'done' = 그 단계 끝

/** 하루 루틴 1회 (StudySession). 진행 상태를 저장해 두었다가 앱을 다시 열면 이어서 한다 */
export interface Session {
  id?: number
  key: string // `${unitId}#${partId ?? 'all'}`, 오답만 학습은 `review#${bookId}`
  unitId: string
  partId?: string
  date: string
  startedAt: number
  endedAt?: number // 있으면 완료
  // wrongV/S = 오늘 틀린 것, dueV/S = 복습할 때가 된 것 (시작할 때 정해 둠)
  // step/queue/i = 지금 보고 있는 단계의 위치 (옛 기록 호환), pos = 단계별 위치, newV = 이번에 처음 배우는 단어
  // 단어 dueV는 안키식 시간 일정으로 그때그때 다시 계산한다
  state: { step: Step; queue: string[]; i: number; stage?: Stage; pos?: Partial<Record<Stage, Cursor>>; newV?: string[]; wrongV: string[]; wrongS: string[]; dueV?: string[]; dueS?: string[]; tries: Record<string, number> }
  stats: { vocab: number; vocabOk: number; sentences: number; sentencesOk: number; cards: number }
  activeMs?: number // 실제로 학습한 시간 (화면이 켜져 있고 1분 안에 조작한 시간만)
}

class StudyDB extends Dexie {
  books!: Table<Book, string>
  chapters!: Table<Chapter, string>
  pages!: Table<SourcePage, [string, number]>
  units!: Table<Unit, string>
  vocab!: Table<Vocab, string>
  sentences!: Table<Sentence, string>
  reviews!: Table<Review, number>
  sessions!: Table<Session, number>
  schedules!: Table<Sched, string>
  settings!: Table<{ key: string; value: unknown }, string>

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
    this.version(3).stores({
      reviews: '++id, itemId, unitId, date',
      sessions: '++id, key, unitId, date',
    })
    // Phase 4: 항목별 복습 일정. 그동안의 학습 기록을 순서대로 다시 반영해서 만든다
    this.version(4).stores({ schedules: 'itemId, itemType, unitId, due' }).upgrade(async tx => {
      const map = new Map<string, Sched>()
      await tx.table<Review>('reviews').orderBy('id').each(r => {
        const prev = map.get(r.itemId) ?? newSched(r.itemId, r.itemType, r.unitId, r.date)
        const g = r.itemType === 'vocab' ? { grade: r.grade ?? (r.correct ? 'good' : 'again') } : sentenceGrade(r.correct ? { ok: true, score: 100 } : r.answer ? { ok: false, score: r.score ?? 0 } : null)
        map.set(r.itemId, applyReview(prev, g.grade as VocabGrade, r.date, 'error' in g ? g.error : undefined, r.itemType === 'vocab' ? g.grade !== 'again' : r.correct))
      })
      await tx.table('schedules').bulkPut([...map.values()])
    })
    // Phase 5: 사용자 설정 (하루 목표, 연속 학습 기준). 백업에 포함
    this.version(5).stores({ settings: 'key' })
  }
}

export const db = new StudyDB()

export async function deleteBook(bookId: string) {
  await db.transaction('rw', [db.books, db.chapters, db.pages, db.units, db.vocab, db.sentences, db.reviews, db.sessions, db.schedules], async () => {
    for (const t of [db.units, db.vocab, db.sentences]) await t.where('bookId').equals(bookId).delete()
    for (const t of [db.reviews, db.sessions, db.schedules]) await t.where('unitId').startsWith(`${bookId}/`).delete()
    await db.pages.where('bookId').equals(bookId).delete()
    await db.chapters.where('bookId').equals(bookId).delete()
    await db.books.delete(bookId)
  })
}

// ── 사용자 설정 ──
export interface UserSettings {
  goalMinutes: number // 하루 학습 목표(분)
  streakRule: 'routine' | 'minutes' // 연속 학습으로 인정하는 기준: 루틴 1회 완료 / 목표 시간 달성
  furigana: boolean // 모든 한자에 후리가나
  keySound: boolean // 앱 키보드 소리
  keyHaptic: boolean // 앱 키보드 진동
}
export const DEFAULT_SETTINGS: UserSettings = { goalMinutes: 15, streakRule: 'routine', furigana: true, keySound: true, keyHaptic: true }

export async function getSettings(): Promise<UserSettings> {
  const rows = await db.settings.toArray()
  return { ...DEFAULT_SETTINGS, ...Object.fromEntries(rows.map(r => [r.key, r.value])) }
}
export const setSetting = <K extends keyof UserSettings>(key: K, value: UserSettings[K]) => db.settings.put({ key, value })

