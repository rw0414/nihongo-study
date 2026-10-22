import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings } from '../db'
import { doneDays, minutesByDay } from '../stats'
import { dayKey, nextDay, streak } from '../study'
import { go } from '../App'
import InstallCard from '../InstallCard'

const today = new Date().toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })
const STEPS = ['단어 암기', '문법 카드', '예문 작성']

export default function Home() {
  const book = useLiveQuery(() => db.books.orderBy('lastOpenedAt').reverse().first().then(b => b ?? db.books.toCollection().first()).then(b => b ?? null))
  const data = useLiveQuery(async () => {
    if (!book) return null
    const [chapters, units, sessions, sched, reviews, settings] = await Promise.all([
      db.chapters.where('bookId').equals(book.id).toArray(),
      db.units.where('bookId').equals(book.id).toArray(),
      db.sessions.where('unitId').startsWith(`${book.id}/`).toArray(),
      db.schedules.where('unitId').startsWith(`${book.id}/`).toArray(),
      db.reviews.where('date').equals(dayKey()).toArray(), // 오늘 기록만 (진행 중 세션 시간 계산용)
      getSettings(),
    ])
    const t = dayKey()
    const due = sched.filter(x => x.due <= t && x.lastDate !== t)
    const minutes = minutesByDay(sessions, reviews)
    return { chapters, units: new Map(units.map(u => [u.id, u])), sessions, minutes, goal: settings.goalMinutes, doneSet: doneDays(sessions, minutes, settings), dueV: due.filter(x => x.itemType === 'vocab').length, dueS: due.filter(x => x.itemType === 'sentence').length }
  }, [book?.id])

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

  const done = data.sessions.filter(s => s.endedAt)
  const days = streak(data.doneSet)
  const todayMin = Math.round(data.minutes.get(dayKey()) ?? 0)
  const doneToday = done.filter(s => s.date === dayKey())
  const open = data.sessions.find(s => !s.endedAt && s.date === dayKey() && !s.key.startsWith('review#'))
  const next = open
    ? { unitId: open.unitId, partId: open.partId, title: data.chapters.find(c => c.id === open.unitId)?.title ?? '', partTitle: data.units.get(open.unitId)?.data.parts?.find(p => p.id === open.partId)?.title }
    : nextDay(data.chapters, data.units, new Set(done.map(s => s.key)))
  const stage = !open ? -1 : ({ vocab: 0, 'vocab-intro': 0, 'vocab-review': 0, grammar: 1, sentence: 2, 'sentence-intro': 2, 'sentence-review': 2, done: 3 } as const)[open.state.step]
  const start = () => next && go(`/study/${book.id}/${next.unitId.slice(book.id.length + 1)}${next.partId ? `/${next.partId}` : ''}`)

  // 이번 주 (월~일) 학습한 날
  const week = (() => {
    const d = new Date(); d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    const set = data.doneSet
    return ['월', '화', '수', '목', '금', '토', '일'].map((label, i) => {
      const k = dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + i))
      return { label, done: set.has(k), today: k === dayKey() }
    })
  })()

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <div className="grow">
          <div className="sub">{today}</div>
          <h1>오늘의 학습</h1>
        </div>
        <span className="streak">🔥 {days}일 연속</span>
      </div>

      <InstallCard />
      <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        {next ? (
          <>
            <div>
              <div className="sub">{book.title}</div>
              <div style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>{next.title}{next.partTitle ? ` ${next.partTitle}` : ''}</div>
              {doneToday.length > 0 && !open && <div className="sub">오늘 {doneToday.length}회 완료했어요. 한 번 더 해도 좋아요!</div>}
              <div className="bar" style={{ marginTop: 8 }}><div style={{ width: `${Math.min(100, (todayMin / data.goal) * 100)}%` }} /></div>
              <div className="muted small" style={{ marginTop: 4 }}>오늘 {todayMin}분 / 목표 {data.goal}분</div>
            </div>
            {(data.dueV > 0 || data.dueS > 0) && !open && (
              <div className="blk-note">오늘 복습할 때가 된 단어 {data.dueV}개 · 예문 {data.dueS}개가 학습 중에 함께 나와요.</div>
            )}
            <div className="steps">
              {STEPS.map((s, i) => (
                <div className={`step ${i === stage ? 'now' : ''}`} key={s}>
                  <div className={`num ${i < stage ? 'done' : ''}`}>{i < stage ? '✓' : i + 1}</div>
                  <div className="grow" style={{ fontWeight: 500 }}>{s}</div>
                  {i === stage && <span className="accent-text small"><b>진행 중</b></span>}
                </div>
              ))}
            </div>
            <button className="btn primary wide big" onClick={start}>{open ? '이어서 학습하기' : doneToday.length ? '다음 학습 시작' : '오늘의 학습 시작'}</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: 18, fontWeight: 700 }}>변환된 단원을 모두 마쳤어요! 🎉</div>
            <div className="sub">다음 단원 콘텐츠가 준비되면 이어서 학습할 수 있어요.</div>
          </>
        )}
      </div>

      <div className="card">
        <div className="sub" style={{ marginBottom: 10 }}>이번 주</div>
        <div className="week">
          {week.map(d => (
            <div key={d.label}><div className={d.today ? 'today' : ''}>{d.label}</div><div className={`dot ${d.done ? 'on' : ''} ${d.today ? 'ring' : ''}`} /></div>
          ))}
        </div>
      </div>

      <button className="btn wide" onClick={() => go(`/read/${book.id}/${book.lastPage}`)}>원본 이어서 보기</button>
    </>
  )
}
