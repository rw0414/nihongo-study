import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { dayKey } from '../study'
import { addDays, recovery, type Sched } from '../srs'
import { go } from '../App'
import { Ja } from '../Ja'

// 오답 노트 (Phase 4): 틀린 적 있는 단어·예문과 취약 문법. 회복 이력, 다시 학습 지정, 오답만 학습.
type Filter = 'all' | 'vocab' | 'sentence' | 'grammar'
type Sort = 'count' | 'recent' | 'cause'

const STATUS = { weak: ['약함', 'warn'], recovering: ['회복 중', 'info'], recovered: ['회복', 'done'], none: ['', ''] } as const
const SHOW = 100 // 한 번에 그리는 최대 줄 수

function dueText(due: string, today: string) {
  if (due <= today) return '오늘 복습'
  const n = Math.round((new Date(due + 'T12:00:00').getTime() - new Date(today + 'T12:00:00').getTime()) / 86400000)
  return n === 1 ? '내일 복습' : `${n}일 후 복습`
}

export default function Notes() {
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('count')
  const today = dayKey()
  const data = useLiveQuery(async () => {
    const book = (await db.books.orderBy('lastOpenedAt').reverse().first()) ?? (await db.books.toCollection().first())
    if (!book) return null
    const p = `${book.id}/`
    const [sched, vocab, sents, units, reviews] = await Promise.all([
      db.schedules.where('unitId').startsWith(p).toArray(),
      db.vocab.where('bookId').equals(book.id).toArray(),
      db.sentences.where('bookId').equals(book.id).toArray(),
      db.units.where('bookId').equals(book.id).toArray(),
      db.reviews.where('unitId').startsWith(p).toArray(), // ponytail: 기록 전체를 읽음. 수만 개가 되면 itemId별 최근 5개만 저장하도록
    ])
    const hist = new Map<string, { ok: boolean[]; lastWrong: number }>()
    for (const r of reviews) {
      const h = hist.get(r.itemId) ?? { ok: [], lastWrong: 0 }
      h.ok.push(r.correct)
      if (!r.correct) h.lastWrong = Math.max(h.lastWrong, r.at)
      hist.set(r.itemId, h)
    }
    return { book, sched, vocab: new Map(vocab.map(v => [v.id, v])), sents: new Map(sents.map(s => [s.id, s])), units: new Map(units.map(u => [u.id, u])), hist }
  })

  if (data === undefined) return null
  if (!data) return <><h1>오답 노트</h1><p className="muted">교재를 먼저 추가해 주세요.</p></>

  const { book, sched, vocab, sents, units, hist } = data
  const wrong = sched.filter(s => s.wrongCount > 0)
  const recoveringN = wrong.filter(s => recovery(s) === 'recovering').length
  const dueN = sched.filter(s => s.due <= today && s.lastDate !== today).length
  const weakN = wrong.filter(s => recovery(s) === 'weak' || recovery(s) === 'recovering').length

  /** 사용자가 다시 학습 대상으로 지정: 오늘 복습에 나오게 */
  const relearn = (ids: string[]) =>
    db.transaction('rw', db.schedules, async () => {
      for (const id of ids) await db.schedules.update(id, { due: today, lastDate: addDays(today, -1), dueAt: undefined })
    })

  const mainCause = (s: Sched) => {
    if (s.itemType === 'vocab') return '단어'
    const e = Object.entries(s.errors).sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))[0]
    return e ? e[0] : '기타'
  }

  let body: JSX.Element
  if (filter === 'grammar') {
    // 취약 문법: 단원·문법별로 예문 오답을 모음
    const groups = new Map<string, { unitId: string; g: string; wrong: number; items: number; ids: string[] }>()
    for (const s of sched.filter(x => x.itemType === 'sentence')) {
      const sent = sents.get(s.itemId)
      for (const g of sent?.grammar ?? []) {
        const k = `${s.unitId}|${g}`
        const e = groups.get(k) ?? { unitId: s.unitId, g, wrong: 0, items: 0, ids: [] }
        e.items++
        e.wrong += s.wrongCount
        if (s.wrongCount > 0) e.ids.push(s.itemId)
        groups.set(k, e)
      }
    }
    const list = [...groups.values()].filter(e => e.wrong > 0).sort((a, b) => b.wrong - a.wrong)
    body = (
      <section className="card list-card">
        {list.length === 0 && <div className="item-col muted">아직 틀린 문법이 없어요.</div>}
        {list.map(e => {
          const u = units.get(e.unitId)?.data
          const gm = u?.grammar.find(x => x.id === e.g)
          const all = [...sents.values()].filter(s => s.unitId === e.unitId && s.grammar.includes(e.g)).map(s => s.id)
          return (
            <div key={`${e.unitId}|${e.g}`} className="item-row">
              <div className="grow">
                <div className="jp item-ja"><Ja text={gm?.pattern ?? e.g} /></div>
                <div className="muted small">{gm?.meaning} · {u?.title}</div>
                <div className="small"><b className="warn-text">오답 {e.wrong}회</b> <span className="muted">· 틀린 예문 {e.ids.length}개 / 연습한 예문 {e.items}개</span></div>
              </div>
              <button className="btn mini" onClick={() => relearn(all.filter(id => sched.some(s => s.itemId === id)))}>다시 연습</button>
            </div>
          )
        })}
      </section>
    )
  } else {
    let list = wrong.filter(s => filter === 'all' || s.itemType === filter)
    if (sort === 'count') list.sort((a, b) => b.wrongCount - a.wrongCount)
    if (sort === 'recent') list.sort((a, b) => (hist.get(b.itemId)?.lastWrong ?? 0) - (hist.get(a.itemId)?.lastWrong ?? 0))
    if (sort === 'cause') list.sort((a, b) => mainCause(a).localeCompare(mainCause(b)) || b.wrongCount - a.wrongCount)
    list = list.slice(0, SHOW)
    body = (
      <section className="card list-card">
        {list.length === 0 && <div className="item-col muted">아직 틀린 항목이 없어요. 오늘의 학습을 해 보세요!</div>}
        {list.map(s => {
          const v = s.itemType === 'vocab' ? vocab.get(s.itemId) : undefined
          const st = s.itemType === 'sentence' ? sents.get(s.itemId) : undefined
          const rec = recovery(s)
          const last5 = (hist.get(s.itemId)?.ok ?? []).slice(-5)
          return (
            <div key={s.itemId} className="item-row">
              <div className="grow">
                <div className="row small">
                  <span className={`tag ${s.itemType === 'vocab' ? 'info' : 'warn'}`}>{mainCause(s)}</span>
                  <span className="muted">{s.wrongCount}회 틀림</span>
                  {rec !== 'none' && <span className={`tag ${STATUS[rec][1]}`}>{STATUS[rec][0]}</span>}
                </div>
                {v && <div className="jp item-ja"><Ja text={v.ja} kana={v.reading} /> <span className="muted small">{v.reading !== v.ja ? v.reading : ''} · {v.ko}</span></div>}
                {st && <div style={{ fontWeight: 500, marginTop: 2 }}>{st.ko}<div className="jp muted small"><Ja text={st.answers[0]} kana={st.kana?.[0]} /></div></div>}
                {!v && !st && <div className="muted small">(콘텐츠에서 사라진 항목)</div>}
                <div className="row small muted">
                  <span className="dots" aria-label={`최근 ${last5.length}회: 정답 ${last5.filter(Boolean).length}회`}>{last5.map((ok, i) => <span key={i} className={`dot ${ok ? 'ok' : 'ng'}`} />)}</span>
                  <span>{dueText(s.due, today)}</span>
                </div>
              </div>
              <button className="btn mini" onClick={() => relearn([s.itemId])} disabled={s.due <= today && s.lastDate !== today}>다시 학습</button>
            </div>
          )
        })}
      </section>
    )
  }

  return (
    <>
      <h1>오답 노트</h1>
      <div className="sub">오답 {wrong.length}개 · 회복 중 {recoveringN}개 · 오늘 복습 예정 {dueN}개</div>
      <div className="seg">
        {([['all', '전체'], ['vocab', '단어'], ['sentence', '예문'], ['grammar', '문법']] as const).map(([k, l]) => (
          <button key={k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>{l}</button>
        ))}
      </div>
      {filter !== 'grammar' && (
        <div className="chips">
          {([['count', '틀린 횟수순'], ['recent', '최근 오답순'], ['cause', '원인별']] as const).map(([k, l]) => (
            <button key={k} className={`chip ${sort === k ? 'on' : ''}`} onClick={() => setSort(k)}>{l}</button>
          ))}
        </div>
      )}
      {body}
      <button className="btn primary wide big" disabled={weakN === 0} onClick={() => go(`/review/${book.id}`)}>
        오답만 학습하기 ({weakN})
      </button>
      <div className="muted small">약함·회복 중인 항목을 모아 복습해요. 3번 연속 맞히면 '회복'이 되고 복습 간격이 점점 길어져요.</div>
    </>
  )
}
