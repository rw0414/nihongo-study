import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings } from '../db'
import { dayKey, streak } from '../study'
import { accuracy, avgResponse, bestStreak, doneDays, learnedByDay, leafChaptersDone, minutesByDay, pct, weeklyTrend } from '../stats'
import { addDays, recovery } from '../srs'
import { Ja } from '../Ja'

// 통계 (Phase 5). 그래프는 SVG로 직접 그림. 막대·점을 누르면 값이 보이고, '표로 보기'로 숫자 확인.

const WEEK = ['월', '화', '수', '목', '금', '토', '일']
const md = (d: string) => `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: 'a' | 'b' }) {
  return (
    <div className="card tile">
      <div className="muted small">{label}</div>
      <div className={`tile-v ${tone ? `series-${tone}` : ''}`}>{value}</div>
      {sub && <div className="muted small">{sub}</div>}
    </div>
  )
}

/** 최근 7일 학습 시간 막대 + 목표선 */
function MinutesChart({ days, goal }: { days: { d: string; m: number }[]; goal: number }) {
  const [sel, setSel] = useState<number>()
  const max = Math.max(goal * 1.5, ...days.map(x => x.m), 1)
  const H = 120, W = 320, bw = 28, gap = (W - bw * 7) / 6
  const y = (m: number) => H - (m / max) * H
  return (
    <figure className="chart">
      <svg viewBox={`0 0 ${W} ${H + 22}`} role="img" aria-label={`최근 7일 학습 시간. ${days.map(x => `${md(x.d)} ${Math.round(x.m)}분`).join(', ')}`}>
        <line x1="0" x2={W} y1={y(goal)} y2={y(goal)} className="goal-line" />
        <text x={W} y={y(goal) - 4} textAnchor="end" className="axis-t">목표 {goal}분</text>
        {days.map((x, i) => {
          const h = Math.max((x.m / max) * H, x.m > 0 ? 4 : 0)
          return (
            <g key={x.d} onClick={() => setSel(sel === i ? undefined : i)} onMouseEnter={() => setSel(i)} onMouseLeave={() => setSel(undefined)}>
              <rect x={i * (bw + gap) - gap / 2} y="0" width={bw + gap} height={H + 22} fill="transparent" />
              {h > 0 && <path className={x.m >= goal ? 'bar' : 'bar under'} d={`M${i * (bw + gap)},${H} v${-(h - 4)} q0,-4 4,-4 h${bw - 8} q4,0 4,4 v${h - 4} z`} />}
              <text x={i * (bw + gap) + bw / 2} y={H + 16} textAnchor="middle" className={`axis-t ${x.d === dayKey() ? 'strong' : ''}`}>{WEEK[(new Date(x.d + 'T12:00:00').getDay() + 6) % 7]}</text>
            </g>
          )
        })}
      </svg>
      <figcaption className="small tip">{sel !== undefined ? `${md(days[sel].d)} · ${Math.round(days[sel].m)}분` : '막대를 누르면 학습 시간이 보여요'}</figcaption>
    </figure>
  )
}

/** 주별 정답률 추이 (단어·예문 두 선, 범례 + 끝 값 직접 표시) */
function TrendChart({ weeks }: { weeks: { week: string; vocab: number | null; sentence: number | null }[] }) {
  const [sel, setSel] = useState<number>()
  const W = 300, H = 110, L = 28
  const x = (i: number) => L + (i / (weeks.length - 1)) * (W - L - 34)
  const y = (v: number) => 6 + (1 - v / 100) * (H - 12)
  const line = (k: 'vocab' | 'sentence') =>
    weeks.map((w, i) => (w[k] === null ? null : `${x(i)},${y(w[k]!)}`)).filter(Boolean).join(' ')
  const last = (k: 'vocab' | 'sentence') => [...weeks].reverse().find(w => w[k] !== null)?.[k]
  return (
    <figure className="chart">
      <div className="legend small"><span><i className="sw series-a-bg" />단어</span><span><i className="sw series-b-bg" />예문</span></div>
      <svg viewBox={`0 0 ${W} ${H + 18}`} role="img" aria-label={`최근 ${weeks.length}주 정답률. 단어 최근 ${last('vocab') ?? '–'}%, 예문 최근 ${last('sentence') ?? '–'}%`}>
        {[0, 50, 100].map(v => <g key={v}><line x1={L} x2={W - 34} y1={y(v)} y2={y(v)} className="grid" /><text x={L - 4} y={y(v) + 4} textAnchor="end" className="axis-t">{v}</text></g>)}
        {sel !== undefined && <line x1={x(sel)} x2={x(sel)} y1="0" y2={H} className="crosshair" />}
        <polyline points={line('vocab')} className="line series-a" />
        <polyline points={line('sentence')} className="line series-b" />
        {weeks.map((w, i) => (
          <g key={w.week}>
            {w.vocab !== null && <circle cx={x(i)} cy={y(w.vocab)} r="4" className="dot series-a-fill" />}
            {w.sentence !== null && <circle cx={x(i)} cy={y(w.sentence)} r="4" className="dot series-b-fill" />}
            <rect x={x(i) - 14} y="0" width="28" height={H + 18} fill="transparent" onClick={() => setSel(sel === i ? undefined : i)} onMouseEnter={() => setSel(i)} onMouseLeave={() => setSel(undefined)} />
          </g>
        ))}
        {last('vocab') != null && <text x={W - 30} y={y(last('vocab')!) + 4} className="axis-t">{last('vocab')}%</text>}
        {last('sentence') != null && <text x={W - 30} y={y(last('sentence')!) + 4} className="axis-t">{last('sentence')}%</text>}
        <text x={L} y={H + 16} className="axis-t">{md(weeks[0].week)}</text>
        <text x={W - 34} y={H + 16} textAnchor="end" className="axis-t">이번 주</text>
      </svg>
      <figcaption className="small tip">
        {sel !== undefined ? `${md(weeks[sel].week)} 주 · 단어 ${weeks[sel].vocab ?? '–'}% · 예문 ${weeks[sel].sentence ?? '–'}%` : '점을 누르면 그 주의 정답률이 보여요'}
      </figcaption>
    </figure>
  )
}

/** 이번 달 학습 달력 */
function Calendar({ month, done, minutes }: { month: string; done: Set<string>; minutes: Map<string, number> }) {
  const first = new Date(month + '-01T12:00:00')
  const lead = (first.getDay() + 6) % 7
  const n = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells = [...Array(lead).fill(null), ...Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)]
  return (
    <div className="cal">
      {WEEK.map(w => <div key={w} className="cal-h">{w}</div>)}
      {cells.map((d, i) => d === null ? <div key={`e${i}`} /> : (
        <div key={d} className={`cal-d ${done.has(d) ? 'on' : ''} ${d === dayKey() ? 'today' : ''}`} title={`${md(d)} · ${Math.round(minutes.get(d) ?? 0)}분${done.has(d) ? ' · 학습 완료' : ''}`}>
          {Number(d.slice(8))}
        </div>
      ))}
    </div>
  )
}

export default function Stats() {
  const [table, setTable] = useState(false)
  const data = useLiveQuery(async () => {
    const book = (await db.books.orderBy('lastOpenedAt').reverse().first()) ?? (await db.books.toCollection().first())
    if (!book) return null
    const p = `${book.id}/`
    const [sessions, reviews, sched, chapters, units, vocab, sents, settings] = await Promise.all([
      db.sessions.where('unitId').startsWith(p).toArray(),
      db.reviews.where('unitId').startsWith(p).toArray(),
      db.schedules.where('unitId').startsWith(p).toArray(),
      db.chapters.where('bookId').equals(book.id).toArray(),
      db.units.where('bookId').equals(book.id).toArray(),
      db.vocab.where('bookId').equals(book.id).toArray(),
      db.sentences.where('bookId').equals(book.id).toArray(),
      getSettings(),
    ])
    return { book, sessions, reviews, sched, chapters, units, vocab: new Map(vocab.map(v => [v.id, v])), sents: new Map(sents.map(s => [s.id, s])), settings }
  })
  if (data === undefined) return null
  if (!data) return <><h1>통계</h1><p className="muted">교재를 먼저 추가해 주세요.</p></>

  const { sessions, reviews, sched, chapters, units, vocab, sents, settings } = data
  const today = dayKey()
  const minutes = minutesByDay(sessions, reviews)
  const done = doneDays(sessions, minutes, settings)
  const week7 = Array.from({ length: 7 }, (_, i) => addDays(today, i - 6)).map(d => ({ d, m: minutes.get(d) ?? 0 }))
  const weekMin = week7.reduce((a, b) => a + b.m, 0)
  const totalMin = [...minutes.values()].reduce((a, b) => a + b, 0)
  const vNew = accuracy(reviews, 'vocab', 'new'), vRev = accuracy(reviews, 'vocab', 'review')
  const sNew = accuracy(reviews, 'sentence', 'new'), sRev = accuracy(reviews, 'sentence', 'review')
  const vAll = accuracy(reviews, 'vocab'), sAll = accuracy(reviews, 'sentence')
  const learned = learnedByDay(reviews, 'vocab')
  const learnedTotal = [...learned.values()].reduce((a, b) => a + b, 0)
  const trend = weeklyTrend(reviews, today)
  const prog = leafChaptersDone(chapters, new Set(units.map(u => u.id)))
  const dueN = sched.filter(s => s.due <= today && s.lastDate !== today).length
  const weakV = sched.filter(s => s.itemType === 'vocab' && recovery(s) === 'weak').sort((a, b) => b.wrongCount - a.wrongCount).slice(0, 3)
  // 취약 문법: 예문 오답을 문법별로
  const gm = new Map<string, number>()
  for (const s of sched.filter(x => x.itemType === 'sentence' && x.wrongCount > 0))
    for (const g of sents.get(s.itemId)?.grammar ?? []) gm.set(`${s.unitId}|${g}`, (gm.get(`${s.unitId}|${g}`) ?? 0) + s.wrongCount)
  const weakG = [...gm].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, n]) => {
    const [uid, g] = k.split('|')
    const gr = units.find(u => u.id === uid)?.data.grammar.find(x => x.id === g)
    return { name: gr?.pattern ?? g, meaning: gr?.meaning ?? '', n }
  })
  const f = (r: { ok: number; total: number }) => (pct(r) === null ? '–' : `${pct(r)}%`)
  const hm = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}시간 ${Math.round(m % 60)}분` : `${Math.round(m)}분`)

  return (
    <>
      <div className="row" style={{ alignItems: 'flex-end' }}>
        <h1 className="grow">통계</h1>
        <button className="chip" onClick={() => setTable(!table)}>{table ? '그래프로 보기' : '표로 보기'}</button>
      </div>

      <div className="tiles">
        <Tile label="연속 학습" value={`${streak(done, today)}일`} sub={`최장 ${bestStreak(done)}일`} />
        <Tile label="이번 주 학습" value={hm(weekMin)} sub={`누적 ${hm(totalMin)}`} />
        <Tile label="단어 정답률" value={f(vAll)} sub={`처음 ${f(vNew)} · 복습 ${f(vRev)}`} tone="a" />
        <Tile label="예문 정답률" value={f(sAll)} sub={`처음 ${f(sNew)} · 복습 ${f(sRev)}`} tone="b" />
        <Tile label="학습한 단어" value={`${learnedTotal}개`} sub={`오늘 ${learned.get(today) ?? 0}개`} />
        <Tile label="평균 응답 시간" value={`${avgResponse(reviews, 'vocab') ?? '–'}초`} sub={`예문 ${avgResponse(reviews, 'sentence') ?? '–'}초`} />
      </div>

      {table ? (
        <div className="card blk-table">
          <table><tbody>
            <tr><th>날짜</th><th>학습 시간</th><th>완료</th></tr>
            {week7.slice().reverse().map(x => <tr key={x.d}><td>{md(x.d)}</td><td>{Math.round(x.m)}분</td><td>{done.has(x.d) ? '✓' : ''}</td></tr>)}
            <tr><th>주</th><th>단어</th><th>예문</th></tr>
            {trend.slice().reverse().map(w => <tr key={w.week}><td>{md(w.week)}</td><td>{w.vocab ?? '–'}%</td><td>{w.sentence ?? '–'}%</td></tr>)}
          </tbody></table>
        </div>
      ) : (
        <>
          <div className="card"><div className="chart-title">일별 학습 시간 <span className="muted small">최근 7일</span></div><MinutesChart days={week7} goal={settings.goalMinutes} /></div>
          <div className="card"><div className="chart-title">정답률 추이 <span className="muted small">최근 8주</span></div><TrendChart weeks={trend} /></div>
        </>
      )}

      <div className="card">
        <div className="chart-title">학습 달력 <span className="muted small">{Number(today.slice(5, 7))}월 · {settings.streakRule === 'routine' ? '루틴 완료한 날' : `${settings.goalMinutes}분 이상 공부한 날`}</span></div>
        <Calendar month={today.slice(0, 7)} done={done} minutes={minutes} />
      </div>

      <div className="card col">
        <div className="chart-title">교재 진도</div>
        <div className="bar"><div style={{ width: `${prog.total ? (prog.done / prog.total) * 100 : 0}%` }} /></div>
        <div className="muted small">완료 {prog.done} / 학습 가능 {prog.total}단원 · 오늘 복습 예정 {dueN}개</div>
      </div>

      <div className="card col">
        <div className="chart-title">취약 항목</div>
        {weakG.length === 0 && weakV.length === 0 && <div className="muted small">아직 취약 항목이 없어요.</div>}
        {weakG.map(g => <div key={g.name} className="row small"><span className="jp grow"><Ja text={g.name} /> <span className="muted">{g.meaning}</span></span><b className="warn-text">오답 {g.n}회</b></div>)}
        {weakV.map(s => { const v = vocab.get(s.itemId); return v && <div key={s.itemId} className="row small"><span className="jp grow"><Ja text={v.ja} kana={v.reading} /> <span className="muted">{v.ko}</span></span><b className="warn-text">오답 {s.wrongCount}회</b></div> })}
      </div>
    </>
  )
}
