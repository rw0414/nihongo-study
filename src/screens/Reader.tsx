import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { chapterAt, printedPage } from '../book'
import { usePageImage } from '../usePageImage'
import { go } from '../App'

// 원본 페이지 보기. 좌우 스와이프 또는 하단 버튼으로 넘김, 이미지를 두 번 탭하면 확대.
export default function Reader({ bookId, page }: { bookId: string; page: number }) {
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const chapters = useLiveQuery(() => db.chapters.where('bookId').equals(bookId).toArray(), [bookId])
  const url = usePageImage(bookId, page)
  const [zoom, setZoom] = useState(false)
  const touchX = useRef<number | null>(null)
  const scroller = useRef<HTMLDivElement>(null)

  const chapter = chapters && chapterAt(chapters, page)

  // 마지막으로 본 쪽 저장, 처음 연 목차는 '학습 중'으로 표시
  useEffect(() => {
    db.books.update(bookId, { lastPage: page, lastOpenedAt: Date.now() })
    scroller.current?.scrollTo(0, 0)
  }, [bookId, page])
  useEffect(() => {
    if (chapter?.status === 'new') db.chapters.update(chapter.id, { status: 'reading' })
  }, [chapter])

  if (!book) return null
  const move = (p: number) => {
    if (p >= 1 && p <= book.pageCount) location.replace(`#/read/${bookId}/${p}`) // 쪽 이동은 뒤로가기 기록에 쌓지 않음
  }
  const toggleDone = () =>
    chapter && db.chapters.update(chapter.id, { status: chapter.status === 'done' ? 'reading' : 'done' })

  return (
    <div className="reader">
      <header className="reader-top">
        <button className="link" onClick={() => go(`/book/${bookId}`)}>‹ 목차</button>
        <span className="reader-chapter">{chapter?.title ?? book.title}</span>
      </header>
      <div
        ref={scroller}
        className={`reader-page ${zoom ? 'zoom' : ''}`}
        onTouchStart={e => { touchX.current = e.touches[0].clientX }}
        onTouchEnd={e => {
          if (zoom || touchX.current === null) return
          const dx = e.changedTouches[0].clientX - touchX.current
          if (Math.abs(dx) > 60) move(dx < 0 ? page + 1 : page - 1)
          touchX.current = null
        }}
        onDoubleClick={() => setZoom(z => !z)}
      >
        {url && <img src={url} alt={`${page}쪽`} />}
      </div>
      <footer className="reader-bottom">
        <button className="btn" disabled={page <= 1} onClick={() => move(page - 1)}>‹ 이전</button>
        <span className="muted small center">
          p.{printedPage(page, book.printedPageOffset)}<br />{page}/{book.pageCount}
        </span>
        {chapter && (
          <button className={`btn ${chapter.status === 'done' ? 'done' : ''}`} onClick={toggleDone}>
            {chapter.status === 'done' ? '✓ 완료' : '완료'}
          </button>
        )}
        <button className="btn" disabled={page >= book.pageCount} onClick={() => move(page + 1)}>다음 ›</button>
      </footer>
    </div>
  )
}
