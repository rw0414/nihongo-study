import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Book } from '../db'
import { chapterAt, leafChapters, progress } from '../book'
import { importBookPackage } from '../importBook'
import { usePageImage } from '../usePageImage'
import { go } from '../App'

function BookCover({ book }: { book: Book }) {
  const url = usePageImage(book.id, 1)
  return <div className="cover">{url && <img src={url} alt="" />}</div>
}

function BookRow({ book }: { book: Book }) {
  const chapters = useLiveQuery(() => db.chapters.where('bookId').equals(book.id).toArray(), [book.id])
  if (!chapters) return null
  const pct = Math.round(progress(chapters) * 100)
  const current = book.lastOpenedAt ? chapterAt(chapters, book.lastPage) : undefined
  return (
    <button className="card book-row" onClick={() => go(`/book/${book.id}`)}>
      <BookCover book={book} />
      <div className="grow" style={{ display: 'flex', flexDirection: 'column' }}>
        <div className="book-title">{book.title}</div>
        <div className="muted small">{book.pageCount}쪽 · {leafChapters(chapters).length}개 단원 · {book.sourceType === 'scanned' ? '스캔본' : '텍스트'}</div>
        <div className="chips"><span className="tag">원본 열람만 가능</span></div>
        <div style={{ marginTop: 'auto' }}>
          <div className="bar"><div style={{ width: `${pct}%` }} /></div>
          <div className="muted small" style={{ marginTop: 4 }}>
            진도 {pct}%{current ? ` · ${current.title}` : ' · 아직 시작하지 않음'}
          </div>
        </div>
      </div>
    </button>
  )
}

export default function Library() {
  const books = useLiveQuery(() => db.books.orderBy('id').toArray())
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<string>()

  async function onFile(f?: File) {
    if (!f) return
    setBusy(true); setMsg(undefined)
    try {
      const id = await importBookPackage(f)
      go(`/book/${id}`)
    } catch (e) {
      setMsg((e as Error).message)
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <>
      <h1>라이브러리</h1>
      <div className="sub">교재 {books?.length ?? 0}권</div>
      {books?.map(b => <BookRow key={b.id} book={b} />)}
      <button className="btn dashed wide" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? '가져오는 중… (큰 교재는 1분 정도 걸려요)' : '+ 교재 추가'}
      </button>
      <input ref={input} type="file" accept=".zip,application/zip" hidden onChange={e => onFile(e.target.files?.[0])} />
      {msg && <p className="error">{msg}</p>}
      <div className="muted small" style={{ lineHeight: 1.6 }}>
        교재 PDF는 PC에서 Claude Code가 페이지 이미지·목차로 변환합니다. 변환된 교재 파일(.zip)을 여기서 불러오세요.
      </div>
    </>
  )
}
