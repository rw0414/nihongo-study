import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, deleteBook, type Book, type Chapter, type Unit as UnitRow } from '../db'
import { chapterAt, leafChapters, printedPage, progress } from '../book'
import { importUnitFiles } from '../importBook'
import { go } from '../App'

const STATUS = { new: '', reading: '학습 중', done: '완료' }

// 목차는 PDF 책갈피처럼: 누르면 그 단원의 원본 페이지로. 변환된 단원은 '학습 내용'으로 콘텐츠 화면도 열 수 있다
function Unit({ c, book, current, content }: { c: Chapter; book: Book; current: boolean; content?: UnitRow }) {
  const cid = c.id.slice(book.id.length + 1)
  return (
    <div className={`toc-unit ${current ? 'current' : ''}`} role="button" tabIndex={0}
      onClick={() => go(`/read/${book.id}/${c.startPage}`)}>
      <div className="grow">
        <div className="t">{c.title}</div>
        <div className="muted small">
          {content ? `문법 ${content.data.grammar.length} · 예문 ${content.data.sentences.length} · ` : ''}
          p.{printedPage(c.startPage, book.printedPageOffset)} · {c.endPage - c.startPage + 1}쪽
        </div>
      </div>
      {c.status !== 'new' && <span className={`tag ${c.status}`}>{STATUS[c.status]}</span>}
      {content && <button className="btn mini" onClick={e => { e.stopPropagation(); go(`/unit/${book.id}/${cid}`) }}>학습 내용</button>}
    </div>
  )
}

export default function BookDetail({ bookId }: { bookId: string }) {
  const book = useLiveQuery(() => db.books.get(bookId).then(b => b ?? null), [bookId]) // null = 없음, undefined = 불러오는 중
  const chapters = useLiveQuery(() => db.chapters.where('[bookId+order]').between([bookId, 0], [bookId, Infinity]).toArray(), [bookId])
  const units = useLiveQuery(async () => new Map((await db.units.where('bookId').equals(bookId).toArray()).map(u => [u.id, u])), [bookId])
  const input = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  if (book === undefined || !chapters || !units) return null
  if (!book) return <p>교재를 찾을 수 없습니다.</p>

  const leaves = leafChapters(chapters)
  const done = leaves.filter(c => c.status === 'done').length
  const pct = Math.round(progress(chapters) * 100)
  const children = (id: string) => chapters.filter(c => c.parentId === id)
  const here = book.lastOpenedAt ? chapterAt(chapters, book.lastPage) : undefined
  const contains = (c: Chapter) => !!here && c.startPage <= here.startPage && here.endPage <= c.endPage

  async function importContent(files: File[]) {
    if (!files.length) return
    try {
      const n = await importUnitFiles(files)
      setMsg({ ok: true, text: `단원 ${n}개의 콘텐츠를 가져왔어요.` })
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message })
    }
    if (input.current) input.current.value = ''
  }

  async function remove() {
    if (!confirm(`'${book!.title}'을(를) 삭제할까요? 교재 이미지와 진도 기록이 모두 지워집니다.`)) return
    await deleteBook(bookId)
    go('/library')
  }

  // 최상위(마당)는 접기/펼치기, 그 아래 마디는 주황 소제목, 하위가 없는 항목은 학습 단위
  return (
    <>
      <button className="link" onClick={() => go('/library')}>‹ 라이브러리</button>
      <h1 style={{ fontSize: 22 }}>{book.title}</h1>
      <div>
        <div className="bar"><div style={{ width: `${pct}%` }} /></div>
        <div className="muted small" style={{ marginTop: 4 }}>진도 {pct}% · {leaves.length}개 단원 중 {done}개 완료 · {book.pageCount}쪽</div>
      </div>
      <div className="row">
        <button className="btn primary grow" onClick={() => go(`/read/${bookId}/${book.lastPage}`)}>
          {book.lastOpenedAt ? `이어서 보기 · p.${printedPage(book.lastPage, book.printedPageOffset)}` : '처음부터 보기'}
        </button>
        {book.tocPages[0] && <button className="btn" onClick={() => go(`/read/${bookId}/${book.tocPages[0]}`)}>원본 차례</button>}
      </div>

      <div className="toc">
        {chapters.filter(c => c.level === 0).map(part => {
          const kids = children(part.id)
          if (!kids.length) return <Unit key={part.id} c={part} book={book} current={here?.id === part.id} content={units.get(part.id)} />
          return (
            <details key={part.id} open={contains(part)}>
              <summary><span className="grow">{part.title}</span><span className="muted small">{leaves.filter(l => l.startPage >= part.startPage && l.endPage <= part.endPage).length}개</span></summary>
              {kids.map(sec => {
                const leafs = children(sec.id)
                if (!leafs.length) return <Unit key={sec.id} c={sec} book={book} current={here?.id === sec.id} content={units.get(sec.id)} />
                return (
                  <div key={sec.id}>
                    <div className="toc-section">{sec.title}</div>
                    {leafs.map(u => <Unit key={u.id} c={u} book={book} current={here?.id === u.id} content={units.get(u.id)} />)}
                  </div>
                )
              })}
            </details>
          )
        })}
      </div>
      <button className="btn dashed wide" onClick={() => input.current?.click()}>+ 단원 콘텐츠 가져오기 (.json)</button>
      <input ref={input} type="file" accept=".json,application/json" multiple hidden onChange={e => importContent([...(e.target.files ?? [])])} />
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
      <button className="btn danger wide" onClick={remove}>교재 삭제</button>
    </>
  )
}
