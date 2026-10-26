import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings, STAGES, type Chapter, type Session, type Stage } from '../db'
import { doneDays, minutesByDay } from '../stats'
import { dayKey, stagePercent, streak } from '../study'
import { leafChapters } from '../book'
import { dueAt, vocabState } from '../srs'
import { go } from '../App'
import InstallCard from '../InstallCard'

// 홈 = 게임 같은 로드맵. 하루 분량(단원 또는 그 part) 하나가 스테이지 하나.
// 지난 스테이지는 다시, 앞 스테이지도 미리 할 수 있다. 변환 전 단원은 잠김(준비 중).

const LABEL: Record<Stage, string> = { vocab: '단어 암기', grammar: '문법 카드', sentence: '예문 작성' }
const ICON: Record<Stage, string> = { vocab: '🃏', grammar: '📖', sentence: '✏️' }
const ZIG = [0, 56, 84, 56, 0, -56, -84, -56] // 지그재그 길

interface Node {
  key: string // `${unitId}#${partId ?? 'all'}`
  unitId: string
  partId?: string
  title: string
  partTitle?: string
  section: string
  locked: boolean
  done: boolean
  stars: number
  open?: Session
}

/** 단계별 진행률 (진행 중 세션 기준, 끝난 스테이지는 100) */
function percents(n: Node): Record<Stage, number> {
  const st = n.open?.state
  const cur = st?.stage ?? (st ? (st.step.startsWith('vocab') ? 'vocab' : st.step === 'grammar' ? 'grammar' : 'sentence') : undefined)
  return Object.fromEntries(STAGES.map(x => {
    if (!st) return [x, n.done ? 100 : 0]
    const c = x === cur ? st : st.pos?.[x] ?? (!st.pos && STAGES.indexOf(x) < STAGES.indexOf(cur!) ? { step: 'done', queue: [], i: 0 } : undefined)
    return [x, stagePercent(x, c)]
  })) as Record<Stage, number>
}

function Gauge({ stage, pct, onClick, now }: { stage: Stage; pct: number; onClick: () => void; now?: boolean }) {
  return (
    <button className={`gauge ${now ? 'now' : ''} ${pct >= 100 ? 'full' : ''}`} onClick={onClick}>
      <span className="g-icon" aria-hidden>{pct >= 100 ? '✓' : ICON[stage]}</span>
      <span className="g-body">
        <span className="g-top"><b>{LABEL[stage]}</b><span className="small">{pct}%</span></span>
        <span className="g-bar"><span style={{ width: `${pct}%` }} /></span>
      </span>
    </button>
  )
}

export default function Home() {
  const book = useLiveQuery(() => db.books.orderBy('lastOpenedAt').reverse().first().then(b => b ?? db.books.toCollection().first()).then(b => b ?? null))
  const data = useLiveQuery(async () => {
    if (!book) return null
    const [chapters, units, sessions, reviews, sched, settings] = await Promise.all([
      db.chapters.where('[bookId+order]').between([book.id, 0], [book.id, Infinity]).toArray(),
      db.units.where('bookId').equals(book.id).toArray(),
      db.sessions.where('unitId').startsWith(`${book.id}/`).toArray(),
      db.reviews.where('date').equals(dayKey()).toArray(),
      db.schedules.where('unitId').startsWith(`${book.id}/`).toArray(),
      getSettings(),
    ])
    const minutes = minutesByDay(sessions, reviews)
    // 남은 복습: 지금 때가 된 단어 + 오늘 복습할 예문
    const now = Date.now(), t = dayKey()
    const dueV = sched.filter(x => x.itemType === 'vocab' && vocabState(x) !== 'new' && dueAt(x) <= now).length
    const dueS = sched.filter(x => x.itemType === 'sentence' && x.due <= t && x.lastDate !== t).length
    return { chapters, units: new Map(units.map(u => [u.id, u])), sessions, minutes, goal: settings.goalMinutes, doneSet: doneDays(sessions, minutes, settings), dueV, dueS }
  }, [book?.id])
  const [sel, setSel] = useState<string>()
  const [sheetH, setSheetH] = useState(0)
  const curRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  useEffect(() => { curRef.current?.scrollIntoView({ block: 'center' }) }, [data === undefined]) // eslint-disable-line react-hooks/exhaustive-deps
  // 스테이지를 누르면: 아래에서 시트가 올라오고, 그 스테이지가 시트를 뺀 남은 화면의 가운데로 오게 부드럽게 스크롤
  useEffect(() => {
    if (!sel) { setSheetH(0); return }
    const h = sheetRef.current?.offsetHeight ?? 0
    setSheetH(h) // 맨 아래 스테이지도 가운데로 올 수 있게 그만큼 여백
    setTimeout(() => { // 시트가 그려진 다음에
      const el = document.querySelector(`[data-stage="${CSS.escape(sel)}"] .stage`) // 동그란 스테이지 버튼 기준
      if (!el) return
      const r = el.getBoundingClientRect()
      window.scrollBy({ top: r.top + r.height / 2 - (innerHeight - h) / 2, behavior: 'smooth' })
    })
  }, [sel])

  if (book === undefined || (book && !data)) return null
  if (!book || !data) {
    return (
      <>
        <h1>오늘의 학습</h1>
        <InstallCard />
        <div className="card">
          <p style={{ marginTop: 0 }}>아직 등록된 교재가 없습니다.</p>
          <button className="btn primary" onClick={() => go('/library')}>라이브러리로 가기</button>
        </div>
      </>
    )
  }

  // 스테이지 목록
  const byId = new Map(data.chapters.map(c => [c.id, c]))
  const top = (c: Chapter): Chapter => (c.parentId && byId.get(c.parentId) ? top(byId.get(c.parentId)!) : c)
  const t = dayKey()
  // 아직 변환 안 된 단원은 '준비 중'으로 보여 주되, 번호가 붙은 과(01, 34 …)만 (부록 제외)
  const nodes: Node[] = leafChapters(data.chapters).filter(c => data.units.has(c.id) || (/^\d+/.test(c.title) && !top(c).title.includes('부록'))).flatMap(c => {
    const u = data.units.get(c.id)
    const parts = u?.data.parts ?? [undefined]
    return parts.map(p => {
      const key = `${c.id}#${p?.id ?? 'all'}`
      const ended = data.sessions.filter(s => s.key === key && s.endedAt)
      const node: Node = {
        key, unitId: c.id, partId: p?.id, title: c.title, partTitle: p?.title, section: top(c).title, locked: !u,
        done: ended.length > 0, stars: 0, open: data.sessions.filter(s => s.key === key && !s.endedAt && !s.carried).at(-1),
      }
      // 별 = 끝낸 단계 수 (단어·문법·예문 하나당 1개, 클리어하면 3개)
      node.stars = Object.values(percents(node)).filter(x => x >= 100).length
      return node
    })
  })
  // 진행 중 = 가장 최근에 공부한 스테이지. 그 스테이지를 클리어했으면 진행 중 표시 없음
  const last = data.sessions.filter(s => !s.carried && s.key.includes('#') && !/^(review|due)#/.test(s.key))
    .sort((a, b) => (a.updatedAt ?? a.endedAt ?? a.startedAt) - (b.updatedAt ?? b.endedAt ?? b.startedAt)).at(-1)
  const current = last && !last.endedAt ? nodes.find(n => n.key === last.key) : undefined
  const selected = nodes.find(n => n.key === sel)
  const start = (n: Node, s?: Stage) => go(`/study/${book.id}/${n.unitId.slice(book.id.length + 1)}${n.partId ? `/${n.partId}` : ''}${s ? `/${s}` : ''}`)

  const days = streak(data.doneSet)
  const todayMin = Math.round(data.minutes.get(t) ?? 0)
  const clear = nodes.filter(n => n.done).length, total = nodes.filter(n => !n.locked).length
  const starRow = (n: Node) => <div className="stars">{'★'.repeat(n.stars)}<span className="off">{'★'.repeat(3 - n.stars)}</span></div>

  let lastSection = ''
  let k = 0
  return (
    <>
      {/* 홈 = 로드맵. 위에는 한 줄 요약만 */}
      <div className="home-top">
        <span className="streak">🔥 {days}일</span>
        <span className="muted small">오늘 {todayMin}분 / {data.goal}분</span>
        <span className="grow" />
        <span className="muted small">{clear} / {total} 클리어</span>
      </div>
      <InstallCard />
      {data.dueV + data.dueS > 0 && (
        <button className="card due-card" onClick={() => go(`/due/${book.id}`)}>
          <span className="due-icon" aria-hidden>🔁</span>
          <span className="grow">
            <b>남은 복습</b>
            <span className="muted small"> 단어 {data.dueV} · 예문 {data.dueS}</span>
          </span>
          <span className="accent-text small"><b>복습만 하기 ›</b></span>
        </button>
      )}

      {/* 로드맵 */}
      <div className="legend small muted"><span><i className="dot done" />클리어</span><span><i className="dot now" />진행 중</span><span><i className="dot" />앞으로</span><span>🔒 준비 중</span><span className="stars">★</span><span>= 끝낸 단계</span></div>
      <div className="road">
        {nodes.map(n => {
          const head = n.section !== lastSection ? (lastSection = n.section) : null
          const x = ZIG[k++ % ZIG.length]
          const isNow = n === current
          return (
            <div key={n.key}>
              {head && <div className="road-section">{head}</div>}
              <div className={`road-node ${isNow ? "has-start" : ""}`} style={{ transform: `translateX(${x}px)` }} ref={isNow ? curRef : undefined} data-stage={n.key}>
                {isNow && <div className="start-bubble">진행 중</div>}
                <button className={`stage ${n.done ? 'done' : ''} ${isNow ? 'now' : ''} ${n.locked ? 'locked' : ''} ${n.key === sel ? 'sel' : ''}`} disabled={n.locked}
                  aria-label={`${n.title}${n.partTitle ?? ''}${n.done ? ' 클리어' : ''}`} onClick={() => setSel(n.key)}>
                  {n.locked ? '🔒' : n.done ? '✓' : nodes.indexOf(n) + 1}
                </button>
                {(n.done || isNow || n.stars > 0) && starRow(n)}
                <div className="road-label">{n.title.replace(/^\d+\s*/, '')}{n.partTitle ? ` ${n.partTitle}` : ''}</div>
              </div>
            </div>
          )
        })}
      </div>
      {sheetH > 0 && <div style={{ height: sheetH }} aria-hidden />}

      {/* 스테이지 시트 */}
      {/* body에 바로 붙인다: 화면 전환 애니메이션(transform) 안에 있으면 fixed가 화면이 아니라 긴 페이지 기준이 되어 시트가 화면 밖으로 나감 */}
      {selected && createPortal(
        <div className="sheet-back" onClick={() => setSel(undefined)}>
          <div className="sheet" ref={sheetRef} onClick={e => e.stopPropagation()}>
            <div className="sheet-handle" />
            <div className="row">
              <span className="tag info">스테이지 {nodes.indexOf(selected) + 1}</span>
              {starRow(selected)}
              <span className="grow" />
              <button className="icon-btn" aria-label="닫기" onClick={() => setSel(undefined)}>✕</button>
            </div>
            <div className="now-title">{selected.title}{selected.partTitle ? ` ${selected.partTitle}` : ''}</div>
            <div className="muted small">{selected.done ? '클리어한 스테이지예요. 다시 하면 복습이 돼요.' : selected === current ? '오늘 할 스테이지예요.' : '앞 스테이지를 미리 해도 괜찮아요.'}</div>
            {STAGES.map(s => <Gauge key={s} stage={s} pct={percents(selected)[s]} onClick={() => start(selected, s)} />)}
            <button className="btn primary wide big" onClick={() => start(selected)}>{selected.open ? '이어서 하기' : selected.done ? '다시 하기' : '▶ 시작하기'}</button>
          </div>
        </div>
      , document.body)}
    </>
  )
}
