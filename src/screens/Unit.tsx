import { useState, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Sentence, type Vocab } from '../db'
import type { Block, Card } from '../content'
import { printedPage } from '../book'
import { usePageImage } from '../usePageImage'
import { go } from '../App'
import { Ja } from '../Ja'

// 단원 콘텐츠 검토·수정 화면 (Phase 2). 탭: 문법 카드 / 단어 / 예문
type Tab = 'cards' | 'vocab' | 'sentences'

const ORIGIN = {
  list: { label: '교재 단어 목록', tag: 'info' },
  text: { label: '교재 본문·해설에 나온 표현', tag: '' },
  ai: { label: 'AI 제안 (교재에 없음)', tag: 'ai' },
} as const

const SRC = { example: '교재 예문', practice: '맛보기 연습', drill: '실력 다지기' }

/** 예문 속 목표 문법 부분 강조 */
function Hl({ text, hl }: { text: string; hl?: string }) {
  const i = hl ? text.lastIndexOf(hl) : -1
  if (i < 0) return <Ja text={text} />
  return <><Ja text={text.slice(0, i)} /><b className="hl"><Ja text={hl!} /></b><Ja text={text.slice(i + hl!.length)} /></>
}

function BlockView({ b, sentences }: { b: Block; sentences: Map<string, Sentence> }) {
  switch (b.t) {
    case 'p': return <p className="blk-p"><Ja text={b.text} /></p>
    case 'h': return <div className="blk-h"><Ja text={b.text} /></div>
    case 'note': return <div className="blk-note"><Ja text={b.text} /></div>
    case 'teacher': return <div className="blk-teacher"><span className="tag ai">선생님 노트 · AI</span><div><Ja text={b.text} /></div></div>
    case 'box': return <div className="blk-box jp"><Ja text={b.text} /></div>
    case 'ja': return <p className="blk-ja jp"><Ja text={b.text} /></p>
    case 'ko': return <p className="blk-p muted">{b.text}</p>
    case 'words': return <p className="blk-words">{b.text.split(' | ').map((w, i) => <span key={i}><Ja text={w} /></span>)}</p>
    case 'formula':
      return (
        <div className="blk-formula">
          <span className="f-left"><Ja text={b.left} /></span><span className="muted">+</span>
          <span className={`f-right jp ${b.crossed ? 'crossed' : ''}`}><Ja text={b.right} /><small>{b.rightSub}</small></span>
        </div>
      )
    case 'ex':
      return (
        <div className="blk-ex">
          <div className="jp ja"><Hl text={b.ja} hl={b.hl} /></div>
          {b.kana && <div className="jp kana">{b.kana}</div>}
          <div className="muted">{b.ko}</div>
        </div>
      )
    case 'table':
      return (
        <div className="blk-table"><table><tbody>
          {b.rows.map((r, i) => <tr key={i}>{r.map((c, j) => i === 0 ? <th key={j}><Ja text={c} /></th> : <td key={j} className="jp"><Ja text={c} /></td>)}</tr>)}
        </tbody></table></div>
      )
    case 'q': {
      const s = sentences.get(b.ref)
      if (!s) return <div className="error">예문 {b.ref} 없음</div>
      return (
        <details className="blk-q">
          <summary><span className="jp"><Ja text={s.given ?? s.ko} /></span> <span className="muted small">정답 보기</span></summary>
          {s.answers.map((a, i) => <div key={a} className="jp"><Ja text={a} kana={s.kana?.[i]} /></div>)}
          <div className="muted small">{s.ko}</div>
        </details>
      )
    }
  }
}

// 원본 페이지를 카드 바로 아래에 펼쳐 대조 (두 번 탭하면 전체 화면 보기)
export function OriginalPage({ bookId, page }: { bookId: string; page: number }) {
  const url = usePageImage(bookId, page)
  return url ? <img className="orig-page" src={url} alt={`원본 ${page}쪽`} onDoubleClick={() => go(`/read/${bookId}/${page}`)} /> : null
}

export function CardView({ c, sentences, offset, bookId }: { c: Card; sentences: Map<string, Sentence>; offset: number; bookId: string }) {
  const [orig, setOrig] = useState(false)
  const ai = c.kind === 'teacher'
  return (
    <section className={`card lesson-card ${ai ? 'ai-card' : ''}`}>
      <div className="row">
        <span className={`tag ${ai ? 'ai' : 'info'}`}>{ai ? '선생님 정리 · AI' : '교재 원문'}</span>
        <span className="grow" />
        {!ai && <button className="link small" onClick={() => setOrig(!orig)}>{orig ? '원본 닫기' : `원본 대조 p.${printedPage(c.page, offset)}`}</button>}
      </div>
      {orig && <OriginalPage bookId={bookId} page={c.page} />}
      <div className={`lc-title ${c.kind === 'grammar' ? 'jp grammar' : ''}`}><Ja text={c.title} /></div>
      {c.sub && <div className="lc-sub">{c.sub}</div>}
      {c.blocks.map((b, i) => <BlockView key={i} b={b} sentences={sentences} />)}
    </section>
  )
}

function VocabRow({ v }: { v: Vocab }) {
  const [edit, setEdit] = useState(false)
  const [f, setF] = useState({ ja: v.ja, reading: v.reading, ko: v.ko })
  if (edit) {
    return (
      <div className="edit-row">
        <label>표기<input className="jp" value={f.ja} onChange={e => setF({ ...f, ja: e.target.value })} /></label>
        <label>읽기<input className="jp" value={f.reading} onChange={e => setF({ ...f, reading: e.target.value })} /></label>
        <label>뜻<input value={f.ko} onChange={e => setF({ ...f, ko: e.target.value })} /></label>
        <div className="row">
          <button className="btn grow" onClick={() => setEdit(false)}>취소</button>
          <button className="btn primary grow" onClick={async () => { await db.vocab.update(v.id, { ...f, edited: true }); setEdit(false) }}>저장</button>
        </div>
      </div>
    )
  }
  return (
    <div className="item-row">
      <button className="grow item-main" onClick={() => setEdit(true)} aria-label={`${v.ja} 수정`}>
        <span className="jp item-ja"><Ja text={v.ja} kana={v.reading} /></span>
        {v.reading !== v.ja && <span className="jp muted"> {v.reading}</span>}
        <div className="muted">{v.ko}{v.edited && v.origin !== 'ai' && <span className="tag warn small-tag">수정함</span>}</div>
        {v.why && <div className="muted small">{v.why}</div>}
      </button>
      {v.origin === 'ai' && v.approved === undefined && (
        <div className="col">
          <button className="btn mini primary" onClick={() => db.vocab.update(v.id, { approved: true, edited: true })}>승인</button>
          <button className="btn mini" onClick={() => db.vocab.update(v.id, { approved: false, edited: true })}>삭제</button>
        </div>
      )}
      {v.origin === 'ai' && v.approved && <span className="tag done">승인됨</span>}
    </div>
  )
}

function SentenceRow({ s }: { s: Sentence }) {
  const [edit, setEdit] = useState(false)
  const [answers, setAnswers] = useState(s.answers.join('\n'))
  const [alts, setAlts] = useState((s.alts ?? []).join('\n'))
  const lines = (t: string) => t.split('\n').map(x => x.trim()).filter(Boolean)
  return (
    <div className="item-col">
      <div className="row small muted">
        <span className="tag">{SRC[s.src]}</span><span>p.{s.page}</span>{s.edited && <span className="tag warn">수정함</span>}
        <span className="grow" /><button className="link small" onClick={() => setEdit(!edit)}>{edit ? '닫기' : '수정'}</button>
      </div>
      <div style={{ fontWeight: 500 }}>{s.ko}</div>
      {s.given && <div className="jp muted">주어진 단어: <Ja text={s.given} /></div>}
      {s.hint && <div className="blk-note">{s.hint}</div>}
      {edit ? (
        <>
          <label className="small muted">교재 정답 (한 줄에 하나)<textarea className="jp" rows={3} value={answers} onChange={e => setAnswers(e.target.value)} /></label>
          <label className="small muted">허용 답안 (한 줄에 하나)<textarea className="jp" rows={2} value={alts} onChange={e => setAlts(e.target.value)} /></label>
          <button className="btn primary" disabled={!lines(answers).length}
            onClick={async () => { await db.sentences.update(s.id, { answers: lines(answers), alts: lines(alts), edited: true }); setEdit(false) }}>저장</button>
        </>
      ) : (
        <>
          {s.answerBy === 'teacher' && <span className="tag ai">선생님 작성 정답 (교재 정답 없음)</span>}
          {s.answers.map((a, i) => <div key={a} className="jp ans"><Ja text={a} kana={s.kana?.[i]} /></div>)}
          {s.alts?.map(a => <div key={a} className="jp ans alt"><Ja text={a} /> <span className="tag ai">AI 허용 답안</span></div>)}
          {s.kana?.map(a => <div key={a} className="jp ans alt">{a} <span className="tag ai">가나 입력 허용</span></div>)}
        </>
      )}
    </div>
  )
}

export default function UnitScreen({ bookId, cid }: { bookId: string; cid: string }) {
  const id = `${bookId}/${cid}`
  const [tab, setTab] = useState<Tab>('cards')
  const book = useLiveQuery(() => db.books.get(bookId).then(b => b ?? null), [bookId]) // null = 없음, undefined = 불러오는 중
  const unit = useLiveQuery(() => db.units.get(id), [id])
  const vocab = useLiveQuery(() => db.vocab.where('unitId').equals(id).toArray(), [id])
  const sentences = useLiveQuery(() => db.sentences.where('unitId').equals(id).toArray(), [id])
  if (!book || !unit || !vocab || !sentences) return null

  const u = unit.data
  const sMap = new Map(sentences.map(s => [s.id.slice(id.length + 1), s]))
  const visibleVocab = vocab.filter(v => v.approved !== false)
  const pending = visibleVocab.filter(v => v.origin === 'ai' && v.approved === undefined).length
  const order = (x: { id: string }) => Number(x.id.replace(/\D/g, ''))

  let body: ReactNode
  if (tab === 'cards') {
    // 하루 분량으로 나눈 단원은 (1)(2)… 제목을 카드 사이에 표시
    const partStart = new Map(u.parts?.map(p => [p.cards[0], p.title]))
    body = u.cards.map(c => (
      <div key={c.id} className="col">
        {partStart.has(c.id) && <h2 className="part-title">{partStart.get(c.id)}</h2>}
        <CardView c={c} sentences={sMap} offset={book.printedPageOffset} bookId={bookId} />
      </div>
    ))
  } else if (tab === 'vocab') {
    body = (Object.keys(ORIGIN) as (keyof typeof ORIGIN)[]).map(o => {
      const list = visibleVocab.filter(v => v.origin === o).sort((a, b) => order(a) - order(b))
      if (!list.length) return null
      return (
        <section key={o} className="card list-card">
          <div className="list-title"><span className={`tag ${ORIGIN[o].tag}`}>{ORIGIN[o].label}</span> <span className="muted small">{list.length}개</span></div>
          {list.map(v => <VocabRow key={v.id} v={v} />)}
        </section>
      )
    })
  } else {
    body = (['example', 'practice', 'drill'] as const).map(src => {
      const list = sentences.filter(s => s.src === src)
      if (!list.length) return null
      return (
        <section key={src} className="card list-card">
          <div className="list-title">{SRC[src]} <span className="muted small">{list.length}개</span></div>
          {list.map(s => <SentenceRow key={s.id} s={s} />)}
        </section>
      )
    })
  }

  return (
    <>
      <button className="link" onClick={() => go(`/book/${bookId}`)}>‹ 목차</button>
      <h1 style={{ fontSize: 22 }}>{u.title}</h1>
      <div className="row">
        <span className={`tag ${unit.status === 'checked' ? 'done' : 'warn'}`}>{unit.status === 'checked' ? (u.review ? 'AI 선생님 검토 완료' : '검토 완료') : '검토 필요'}</span>
        <span className="muted small">p.{u.pages[0]}~{u.pages[1]} · 문법 {u.grammar.length} · 단어 {visibleVocab.length} · 예문 {sentences.length}{u.parts ? ` · ${u.parts.length}일 분량` : ''}</span>
      </div>
      <div className="blk-note">
        AI가 원본 페이지를 읽어 옮긴 내용입니다. 카드의 '원본 대조'로 원래 페이지를 바로 확인할 수 있어요. 틀린 단어·예문은 눌러서 고치세요.
        {pending > 0 && ` AI가 제안한 단어 ${pending}개가 승인을 기다리고 있어요.`}
      </div>
      {u.review && (
        <details className="card review-log">
          <summary>AI 선생님 검토 기록 · {u.review.at} · 수정 {u.review.fixes.length}건</summary>
          <ul>{u.review.fixes.map((f, i) => <li key={i}><Ja text={f} /></li>)}</ul>
        </details>
      )}
      <div className="study-buttons">
        {(u.parts ?? [{ id: '', title: '이 단원 학습하기' }]).map(p => (
          <button key={p.id} className="btn primary" onClick={() => go(`/study/${bookId}/${cid}${p.id ? `/${p.id}` : ''}`)}>
            {u.parts ? `${p.title} 학습` : p.title}
          </button>
        ))}
      </div>
      <div className="seg">
        <button className={tab === 'cards' ? 'on' : ''} onClick={() => setTab('cards')}>문법 카드 {u.cards.length}</button>
        <button className={tab === 'vocab' ? 'on' : ''} onClick={() => setTab('vocab')}>단어 {visibleVocab.length}</button>
        <button className={tab === 'sentences' ? 'on' : ''} onClick={() => setTab('sentences')}>예문 {sentences.length}</button>
      </div>
      {body}
      <button className={`btn wide ${unit.status === 'checked' ? '' : 'primary'}`}
        onClick={() => db.units.update(id, { status: unit.status === 'checked' ? 'review' : 'checked' })}>
        {unit.status === 'checked' ? '검토 필요로 되돌리기' : '원본과 대조 완료 · 검토 완료로 표시'}
      </button>
    </>
  )
}
