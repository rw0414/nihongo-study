import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Review, type Sentence, type Session, type Step, type Vocab, type VocabGrade } from '../db'
import { dayContent, dayKey, grade, pickSentences, pickVocab, type Grade } from '../study'
import { addDays, dueToday, newSched, recovery, relatedPicks, review, sentenceGrade, type ErrorType } from '../srs'
import { CardView, OriginalPage } from './Unit'
import { go } from '../App'
import { Ja } from '../Ja'

// 오늘의 학습 루틴 (Phase 3·4)
// 1단계 단어: 새 단어 → 전환 화면 → 오늘 틀린 단어 + 복습할 때가 된 단어
// 2단계 문법 카드
// 3단계 예문: 새 예문 → 전환 화면 → 오늘 틀린 예문 + 복습할 때가 된 예문
// 오답만 학습(cid 없음): 아직 회복하지 못한 오답 단어 → 오답 예문
// 진행 상태는 매 답마다 sessions에 저장되어, 앱을 닫았다 열어도 이어서 한다.

const STAGE: Record<Step, number> = { vocab: 0, 'vocab-intro': 0, 'vocab-review': 0, grammar: 1, sentence: 2, 'sentence-intro': 2, 'sentence-review': 2, done: 3 }
const STAGE_NAME = ['1단계 · 단어 암기', '2단계 · 문법 카드', '3단계 · 예문 작성']
const MAX_TRIES = 3 // 같은 날 복습에서 한 항목을 다시 내는 최대 횟수
const DUE_LIMIT = { vocab: 30, sentence: 10 } // 하루 루틴에 섞는 복습 예정 항목 최대 수
const ORDER: Step[] = ['vocab', 'vocab-intro', 'vocab-review', 'grammar', 'sentence', 'sentence-intro', 'sentence-review', 'done']

/** 발음 듣기: 기기 내장 음성 합성(일본어). 교재 음원 연결은 Phase 6 */
function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

function TopBar({ step, i, total, review, onClose }: { step: Step; i: number; total: number; review?: boolean; onClose: () => void }) {
  const stage = STAGE[step]
  const frac = total ? Math.min(i / total, 1) : 0
  return (
    <>
      <div className="study-top">
        <button className="icon-btn" aria-label="학습 닫기" onClick={onClose}>✕</button>
        <div className="stage-bars">
          {[0, 1, 2].map(n => (
            <div key={n} className="stage-bar"><div style={{ width: `${n < stage ? 100 : n === stage ? frac * 100 : 0}%` }} /></div>
          ))}
        </div>
        <span className="muted small counter">{total ? `${Math.min(i + 1, total)}/${total}` : ''}</span>
      </div>
      {stage < 3 && (
        <div className="row small">
          <b className="accent-text">{review ? (stage === 0 ? '오답 노트 · 단어' : '오답 노트 · 예문') : STAGE_NAME[stage]}</b>
          <span className="grow" />
          {step.endsWith('review') && !review && <span className="tag warn">복습</span>}
        </div>
      )}
    </>
  )
}

// ── 단어 카드 ──
function VocabCard({ v, example, tag, onGrade }: { v: Vocab; example?: { ja: string; ko: string }; tag?: string; onGrade: (g: VocabGrade, ms: number) => void }) {
  const [back, setBack] = useState(false)
  const shown = useRef(Date.now())
  useEffect(() => { setBack(false); shown.current = Date.now() }, [v.id])
  const ai = v.origin === 'ai'
  return (
    <>
      <div className="card flash-card">
        <span className={`tag ${ai ? 'ai' : 'info'} corner`}>{ai ? 'AI 제안 단어' : '교재 단어'}</span>
        {tag && <span className="tag warn corner-r">{tag}</span>}
        {back && v.reading !== v.ja && <div className="jp reading">{v.reading}</div>}
        <div className="jp flash-ja"><Ja text={v.ja} kana={v.reading} /></div>
        <button className="icon-btn round" aria-label="발음 듣기" onClick={() => speak(v.reading || v.ja)}>🔊</button>
        {back ? (
          <>
            <div className="flash-ko">{v.ko}</div>
            {example && (
              <div className="flash-ex">
                <span className="tag info">교재 예문</span>
                <div className="jp"><Ja text={example.ja} /></div>
                <div className="muted small">{example.ko}</div>
              </div>
            )}
          </>
        ) : (
          <div className="muted">뜻과 읽기를 먼저 떠올려 보세요</div>
        )}
      </div>
      {back ? (
        <>
          <div className="muted small center">얼마나 잘 기억했나요?</div>
          <div className="grade-row">
            {([['again', '다시'], ['hard', '어려움'], ['good', '알맞음'], ['easy', '쉬움']] as const).map(([g, label]) => (
              <button key={g} className={`btn grade-${g}`} onClick={() => onGrade(g, Date.now() - shown.current)}>{label}</button>
            ))}
          </div>
        </>
      ) : (
        <button className="btn primary wide big" onClick={() => setBack(true)}>정답 확인</button>
      )}
    </>
  )
}

// ── 예문 입력·채점 ──
function DiffView({ g }: { g: Grade }) {
  return <div className="jp diff">{g.diff.map((p, i) => <span key={i} className={`d-${p.t}`}>{p.s}</span>)}</div>
}

function SentenceCard({ s, review: isReview, tag, readings, onDone }: { s: Sentence; review: boolean; tag?: string; readings: [string, string][]; onDone: (g: Grade | null, answer: string, ms: number) => void }) {
  const [asked, setAsked] = useState(false)
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ g: Grade | null; answer: string }>()
  const shown = useRef(Date.now())
  const took = useRef(0)
  useEffect(() => { setText(''); setResult(undefined); setAsked(false); shown.current = Date.now() }, [s.id])

  const submit = (giveUp = false) => {
    took.current = Date.now() - shown.current
    setResult({ g: giveUp ? null : grade(text, s, readings), answer: giveUp ? '' : text })
  }
  /** 내 판단으로 정답 처리: 이 답을 허용 답안으로 저장 (다시 가져와도 유지) */
  const accept = async () => {
    if (!result) return
    await db.sentences.update(s.id, { userAlts: [...(s.userAlts ?? []), result.answer.trim()], edited: true })
    onDone({ ...result.g!, ok: true, score: 100 }, result.answer, took.current)
  }
  /** 확실하지 않은 답은 표시해 두었다가 Claude Code에서 선생님이 검토 */
  const ask = async () => {
    if (!result) return
    await db.sentences.update(s.id, { teacherAsk: [...new Set([...(s.teacherAsk ?? []), result.answer.trim()])], edited: true })
    setAsked(true)
  }

  if (!result) {
    return (
      <>
        <div className="card prompt-card">
          <div className="row">
            <div className="muted small grow">{isReview ? (tag ?? '복습할 문장이에요. 다시 써 보세요') : s.given ? '주어진 단어로 문장을 만들어 보세요' : '다음 문장을 일본어로 써 보세요'}</div>
          </div>
          {s.given && <div className="jp given"><Ja text={s.given} /></div>}
          <div className="prompt-ko">{s.ko}</div>
          {s.hint && <div className="blk-note">{s.hint}</div>}
        </div>
        <label className="muted small" htmlFor="answer">내 답안</label>
        <textarea id="answer" className="jp answer-box" rows={3} value={text} lang="ja"
          onChange={e => setText(e.target.value)} placeholder="일본어로 입력 (가나만 써도 돼요)" />
        <div className="muted small">끝의 。와 공백은 채점에서 무시해요</div>
        <div className="grow" />
        <button className="btn primary wide big" disabled={!text.trim()} onClick={() => submit()}>채점하기</button>
        <button className="btn ghost wide" onClick={() => submit(true)}>모르겠어요 · 정답 보기</button>
      </>
    )
  }

  const { g, answer } = result
  const ok = !!g?.ok
  // 말해보카식 판정: 정답 / 아까워요(거의 맞음) / 오답. 점수 숫자는 보여 주지 않는다
  const v = ok ? { cls: 'good', mark: '✓', title: g?.kanaOnly ? '정답! 한자로도 써 봐요' : '정답이에요!' }
    : g && g.score >= 80 ? { cls: 'near', mark: '△', title: '아까워요!' }
    : { cls: 'bad', mark: '✗', title: g ? '틀렸어요' : '정답을 확인해 봐요' }
  const [first, ...rest] = g?.findings ?? []
  return (
    <>
      <div className={`card verdict ${v.cls}`}>
        <div className="verdict-mark" aria-hidden>{v.mark}</div>
        <div className="result-title">{v.title}</div>
        {!ok && first && <div className="verdict-why"><span className="jp">{first.text}</span></div>}
      </div>
      <div className="card col">
        {g && !ok && (
          <>
            <div className="muted small">내 답안</div>
            <DiffView g={g} />
          </>
        )}
        {ok && <div className="jp big-ja"><Ja text={answer} /></div>}
        <div className="muted small">{s.answerBy === 'teacher' ? '정답 (선생님 작성 · 교재 정답 없음)' : `정답 · p.${s.page}`}</div>
        {s.answers.map((a, i) => <div key={a} className="jp ans"><Ja text={a} kana={s.kana?.[i]} /></div>)}
        {!!s.alts?.length && <div className="muted small">이렇게 써도 정답이에요</div>}
        {s.alts?.map(a => <div key={a} className="jp ans alt"><Ja text={a} /></div>)}
        <div className="muted small">{s.ko}</div>
        {g && !ok && (
          <details className="more">
            <summary>자세히</summary>
            {rest.length > 0 && <ul className="findings">{rest.map((f, i) => <li key={i} className="jp">{f.text}</li>)}</ul>}
            <div className="muted small">줄 그은 글자는 잘못 쓴 글자, 파란 글자는 들어가야 할 글자예요. 띄어쓰기와 마침표는 채점에 영향이 없어요.</div>
          </details>
        )}
      </div>
      <div className="grow" />
      {!ok && g && (
        <div className="row">
          <button className="btn grow small-btn" onClick={accept}>내 답도 맞아요 · 정답 처리</button>
          <button className="btn grow small-btn" disabled={asked} onClick={ask}>{asked ? '확인 요청함 ✓' : '선생님 확인 요청'}</button>
        </div>
      )}
      {!ok && <button className="btn wide" onClick={() => { setResult(undefined); setText(''); shown.current = Date.now() }}>다시 입력</button>}
      <button className="btn primary wide big" onClick={() => onDone(g, answer, took.current)}>다음</button>
    </>
  )
}

// ── 전환 화면 ("틀린 것 복습해 봐요") ──
function Intro({ title, wrong, due, items, onGo }: { title: string; wrong: number; due: number; items: string[]; onGo: () => void }) {
  const [left, setLeft] = useState(3)
  useEffect(() => {
    if (left === 0) { onGo(); return }
    const t = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(t)
  }, [left, onGo])
  const sub = [wrong && `오늘 헷갈린 ${wrong}개를 먼저`, due && `복습할 때가 된 ${due}개`].filter(Boolean).join(', 이어서 ')
  return (
    <>
      <div className="intro-check">✓</div>
      <div className="intro-title">{title}</div>
      <div className="card col">
        <div className="result-title">{wrong ? '이제 틀린 것을 복습해 봐요' : '이제 복습할 차례예요'}</div>
        <div className="muted small">{sub}</div>
        <div className="chips">{items.slice(0, 8).map((t, i) => <span key={i} className="tag warn jp"><Ja text={t} /></span>)}{items.length > 8 && <span className="muted small">외 {items.length - 8}개</span>}</div>
      </div>
      <div className="grow" />
      <button className="btn primary wide big" onClick={onGo}>복습 시작 · {left}초 후 자동</button>
      <div className="muted small center">복습까지 마치면 다음 단계로 넘어가요</div>
    </>
  )
}

export default function Study({ bookId, cid, partId }: { bookId: string; cid?: string; partId?: string }) {
  const reviewOnly = !cid // 오답만 학습
  const unitId = reviewOnly ? `${bookId}/review` : `${bookId}/${cid}`
  const key = reviewOnly ? `review#${bookId}` : `${unitId}#${partId ?? 'all'}`
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const units = useLiveQuery(async () => new Map((await db.units.where('bookId').equals(bookId).toArray()).map(u => [u.id, u])), [bookId])
  // 복습 항목은 다른 단원에서도 오므로 교재 전체를 불러 둔다
  const vocabAll = useLiveQuery(() => db.vocab.where('bookId').equals(bookId).toArray(), [bookId])
  const sentAll = useLiveQuery(() => db.sentences.where('bookId').equals(bookId).toArray(), [bookId])
  const [session, setSession] = useState<Session>()
  const [nothing, setNothing] = useState(false) // 오답만 학습인데 복습할 게 없음
  const [showOrig, setShowOrig] = useState(false)
  const busy = useRef(false) // 연타 방지: 한 항목에 답은 한 번만 (저장이 끝나면 풀림)

  // 교재 단어의 한자→읽기 (긴 단어부터): 한자·가나 섞어 쓴 답 채점용
  const readings = useMemo<[string, string][]>(() => {
    const m = new Map<string, string>()
    for (const v of vocabAll ?? []) if (/[一-鿿]/.test(v.ja) && v.reading && v.reading !== v.ja) m.set(v.ja, v.reading)
    return [...m].sort((a, b) => b[0].length - a[0].length)
  }, [vocabAll])

  const unit = units?.get(unitId)
  const ready = book && units && vocabAll && sentAll && (reviewOnly || unit)
  const day = unit ? dayContent(unit.data, partId) : undefined
  const parts = unit?.data.parts
  const isLast = !parts || parts.at(-1)?.id === partId
  const unitVocab = vocabAll?.filter(v => v.unitId === unitId) ?? []
  const unitSent = sentAll?.filter(s => s.unitId === unitId) ?? []
  const order = new Map(unit?.data.sentences.map((s, i) => [`${unitId}/${s.id}`, i]))
  const V = ready && day ? pickVocab(unitVocab, day, isLast) : []
  // 예문은 교재 순서대로 (DB는 id 순이라 실력 다지기가 먼저 나옴)
  const S = ready && day ? pickSentences(unitSent, day, unitId).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : []

  const queueFor = (step: Step, st: Session['state']) =>
    step === 'vocab' ? V.map(v => v.id) :
    step === 'vocab-review' ? [...st.wrongV, ...(st.dueV ?? [])] :
    step === 'grammar' ? day?.cards.map(c => c.id) ?? [] :
    step === 'sentence' ? S.map(s => s.id) :
    step === 'sentence-review' ? [...st.wrongS, ...(st.dueS ?? [])] : []

  // 다음 단계 (비어 있는 단계는 건너뜀, 오답만 학습은 전환 화면 없이 바로)
  const after = (step: Step, st: Session['state']): Step => {
    for (let k = ORDER.indexOf(step) + 1; k < ORDER.length; k++) {
      const s = ORDER[k]
      if (s === 'vocab-intro' && reviewOnly) continue
      if (s === 'sentence-intro' && reviewOnly) continue
      if (s === 'vocab-intro' || s === 'sentence-intro') { if (queueFor(s === 'vocab-intro' ? 'vocab-review' : 'sentence-review', st).length) return s; continue }
      if (s === 'done' || queueFor(s, st).length) return s
    }
    return 'done'
  }

  // 오늘 진행 중인 루틴을 불러오거나 새로 시작
  useEffect(() => {
    if (!ready || session) return
    ;(async () => {
      const today = dayKey()
      let s = await db.sessions.where('key').equals(key).filter(x => !x.endedAt && x.date === today && x.state.step !== 'done').last()
      if (!s) {
        const sched = await db.schedules.where('unitId').startsWith(`${bookId}/`).toArray()
        const st: Session['state'] = { step: 'vocab', queue: [], i: 0, wrongV: [], wrongS: [], tries: {} }
        if (reviewOnly) {
          // 아직 회복하지 못한 오답: 틀린 횟수 많은 것부터. 직접 고른 연습이라 오늘 본 것도 포함 (일정은 그날 첫 답 기준이라 그대로)
          const weak = (t: 'vocab' | 'sentence', n: number) => sched
            .filter(x => x.itemType === t && (recovery(x) === 'weak' || recovery(x) === 'recovering'))
            .sort((a, b) => b.wrongCount - a.wrongCount).slice(0, n).map(x => x.itemId)
          st.dueV = weak('vocab', 30)
          st.dueS = weak('sentence', 15)
        } else {
          st.dueV = dueToday(sched, today, 'vocab', new Set(V.map(v => v.id)), DUE_LIMIT.vocab)
          st.dueS = dueToday(sched, today, 'sentence', new Set(S.map(x => x.id)), DUE_LIMIT.sentence)
        }
        st.step = reviewOnly ? (st.dueV.length ? 'vocab-review' : st.dueS.length ? 'sentence-review' : 'done') : queueFor('vocab', st).length ? 'vocab' : after('vocab', st)
        st.queue = queueFor(st.step, st)
        if (reviewOnly && st.step === 'done') { setNothing(true); return } // 빈 복습은 기록하지 않음 (연속 학습일에도 안 셈)
        s = { key, unitId, partId, date: today, startedAt: Date.now(), state: st, stats: { vocab: 0, vocabOk: 0, sentences: 0, sentencesOk: 0, cards: 0 } }
        s.id = await db.sessions.add(s)
        if (!reviewOnly) {
          const ch = await db.chapters.get(unitId)
          if (ch?.status === 'new') await db.chapters.update(unitId, { status: 'reading' })
        }
      }
      setSession(s)
    })()
  }, [ready, key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (nothing) {
    return (
      <div className="study">
        <div className="intro-check">✓</div>
        <div className="intro-title">복습할 오답이 없어요</div>
        <div className="muted center">틀린 것을 모두 회복했어요. 정말 잘하고 있어요!</div>
        <div className="grow" />
        <button className="btn primary wide big" onClick={() => go('/notes')}>오답 노트로</button>
      </div>
    )
  }
  if (!ready || !session) return null
  const st = session.state
  const close = () => go(reviewOnly ? '/notes' : `/unit/${bookId}/${cid}`)

  const save = async (next: Session) => { setSession(next); await db.sessions.put(next); busy.current = false }
  /** 처리 중이면 무시하고, 아니면 잠그고 실행 */
  const once = <A extends unknown[]>(f: (...a: A) => Promise<void>) => async (...a: A) => {
    if (busy.current) return
    busy.current = true
    try { await f(...a) } catch (e) { busy.current = false; throw e }
  }

  const goStep = async (step: Step, base: Session = session) => {
    const nst = { ...base.state, step, i: 0 }
    nst.queue = queueFor(step, nst)
    const next = { ...base, state: nst }
    if (step === 'done') {
      next.endedAt = Date.now()
      if (!reviewOnly) {
        // 단원의 모든 part를 마치면 목차에 '완료' 표시
        const keys = parts ? parts.map(p => `${unitId}#${p.id}`) : [key]
        const done = new Set((await db.sessions.where('unitId').equals(unitId).filter(x => !!x.endedAt).toArray()).map(x => x.key).concat(key))
        if (keys.every(k => done.has(k))) await db.chapters.update(unitId, { status: 'done' })
      }
    }
    await save(next)
  }

  /** 현재 항목을 끝내고 다음으로. requeue면 같은 단계 끝에 다시 넣음 (같은 날 재노출) */
  const advance = async (patch: Partial<Session['state']>, stats: Partial<Session['stats']>, requeue = false) => {
    const cur = st.queue[st.i]
    const nst = { ...st, ...patch, queue: [...st.queue] }
    if (requeue && (nst.tries[cur] ?? 0) < MAX_TRIES) {
      nst.tries = { ...nst.tries, [cur]: (nst.tries[cur] ?? 0) + 1 }
      nst.queue.push(cur)
    }
    nst.i = st.i + 1
    const next = { ...session, state: nst, stats: { ...session.stats, ...stats } }
    if (nst.i >= nst.queue.length) await goStep(after(st.step, nst), next)
    else await save(next)
  }

  /** 답 기록 + 복습 일정 갱신 (그날 첫 답만 일정에 반영) */
  const record = async (item: { id: string; unitId: string }, type: 'vocab' | 'sentence', g: VocabGrade, r: Omit<Review, 'itemId' | 'itemType' | 'unitId' | 'date' | 'at' | 'phase'>, error?: ErrorType) => {
    const today = dayKey()
    await db.reviews.add({ ...r, itemId: item.id, itemType: type, unitId: item.unitId, date: today, at: Date.now(), phase: st.step.endsWith('review') ? 'review' : 'new' })
    const prev = (await db.schedules.get(item.id)) ?? newSched(item.id, type, item.unitId, today)
    await db.schedules.put(review(prev, g, today, error, type === 'vocab' ? g !== 'again' : r.correct))
  }

  /** 같은 문법을 자주 틀리면 그 문법의 다른 예문을 내일 복습에 추가 */
  const addRelated = async (s: Sentence) => {
    const sched = new Map((await db.schedules.where('unitId').equals(s.unitId).toArray()).map(x => [x.itemId, x]))
    const same = sentAll.filter(x => x.unitId === s.unitId)
    const picks = [...new Set(s.grammar.flatMap(g => relatedPicks(g, same, sched)))]
    const tomorrow = addDays(dayKey(), 1)
    await db.schedules.bulkPut(picks.map(id => ({ ...newSched(id, 'sentence', s.unitId, tomorrow), related: true })))
  }

  const exampleFor = (v: Vocab) => {
    const cards = v.unitId === unitId && day ? day.cards : units.get(v.unitId)?.data.cards ?? []
    return cards.flatMap(c => c.blocks).find(b => b.t === 'ex' && b.ja.includes(v.ja)) as { ja: string; ko: string } | undefined
  }
  const isDue = (id: string) => (st.dueV ?? []).includes(id) || (st.dueS ?? []).includes(id)
  const dueTag = (id: string) => reviewOnly ? '오답' : isDue(id) && !st.wrongV.includes(id) && !st.wrongS.includes(id) ? '복습 예정' : undefined

  let body: JSX.Element

  if (st.step === 'vocab' || st.step === 'vocab-review') {
    const v = vocabAll.find(x => x.id === st.queue[st.i])
    body = !v ? <><div className="card">이 항목은 콘텐츠를 다시 가져오면서 없어졌어요.</div><button className="btn primary wide big" onClick={() => advance({}, {})}>건너뛰기</button></> : ( // 콘텐츠를 다시 가져오며 사라진 항목
      <VocabCard v={v} example={exampleFor(v)} tag={st.step === 'vocab-review' ? dueTag(v.id) : undefined} onGrade={once(async (g: VocabGrade, ms: number) => {
        const ok = g === 'good' || g === 'easy'
        await record(v, 'vocab', g, { correct: ok, grade: g, responseMs: ms })
        const isNew = st.step === 'vocab' && !st.tries[v.id]
        const wrongV = !ok && !st.wrongV.includes(v.id) && st.step === 'vocab' ? [...st.wrongV, v.id] : st.wrongV
        await advance({ wrongV }, isNew ? { vocab: session.stats.vocab + 1, vocabOk: session.stats.vocabOk + (ok ? 1 : 0) } : {}, g === 'again' || (st.step === 'vocab-review' && g === 'hard'))
      })} />
    )
  } else if (st.step === 'vocab-intro') {
    body = <Intro title={`새 단어 ${V.length}개 완료!`} wrong={st.wrongV.length} due={st.dueV?.length ?? 0}
      items={queueFor('vocab-review', st).map(id => vocabAll.find(v => v.id === id)?.ja ?? '')} onGo={() => goStep('vocab-review')} />
  } else if (st.step === 'grammar' && day && unit) {
    const c = day.cards.find(x => x.id === st.queue[st.i])!
    const sMap = new Map(unitSent.map(s => [s.id.slice(unitId.length + 1), s]))
    body = (
      <>
        <div className="grammar-scroll">
          <CardView c={c} sentences={sMap} offset={book.printedPageOffset} bookId={bookId} />
          {showOrig && <OriginalPage bookId={bookId} page={c.page} />}
        </div>
        <div className="row">
          <button className="btn" disabled={st.i === 0} onClick={() => save({ ...session, state: { ...st, i: st.i - 1 } })} aria-label="이전 카드">‹</button>
          <button className="btn grow primary big" onClick={once(async () => { setShowOrig(false); await advance({}, { cards: session.stats.cards + 1 }) })}>
            {st.i + 1 < st.queue.length ? '다음 카드' : '문법 카드 완료'}
          </button>
        </div>
      </>
    )
  } else if (st.step === 'sentence' || st.step === 'sentence-review') {
    const s = sentAll.find(x => x.id === st.queue[st.i])
    const isReview = st.step === 'sentence-review'
    body = !s ? <><div className="card">이 항목은 콘텐츠를 다시 가져오면서 없어졌어요.</div><button className="btn primary wide big" onClick={() => advance({}, {})}>건너뛰기</button></> : (
      <SentenceCard s={s} review={isReview} readings={readings} tag={isReview ? (dueTag(s.id) === '복습 예정' ? '복습할 때가 된 문장이에요' : dueTag(s.id) === '오답' ? '예전에 틀린 문장이에요' : '아까 틀린 문장이에요. 다시 써 보세요') : undefined}
        onDone={once(async (g: Grade | null, answer: string, ms: number) => {
          const ok = !!g?.ok
          const sg = sentenceGrade(g)
          await record(s, 'sentence', sg.grade, { correct: ok, score: g?.score ?? 0, answer, responseMs: ms }, sg.error)
          if (!ok) await addRelated(s)
          const wrongS = !ok && st.step === 'sentence' && !st.wrongS.includes(s.id) ? [...st.wrongS, s.id] : st.wrongS
          await advance({ wrongS }, st.step === 'sentence' ? { sentences: session.stats.sentences + 1, sentencesOk: session.stats.sentencesOk + (ok ? 1 : 0) } : {})
        })} />
    )
  } else if (st.step === 'sentence-intro') {
    body = <Intro title={`새 예문 ${S.length}개 완료!`} wrong={st.wrongS.length} due={st.dueS?.length ?? 0}
      items={queueFor('sentence-review', st).map(id => sentAll.find(s => s.id === id)?.ko ?? '')} onGo={() => goStep('sentence-review')} />
  } else {
    const { vocab, vocabOk, sentences, sentencesOk, cards } = session.stats
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–')
    const rv = (st.dueV?.length ?? 0) + st.wrongV.length, rs = (st.dueS?.length ?? 0) + st.wrongS.length
    body = (
      <>
        <div className="intro-check">✓</div>
        <div className="intro-title">{reviewOnly ? '오답 복습 완료!' : '오늘 학습 완료!'}</div>
        <div className="muted center">
          {reviewOnly ? '오답 노트' : `${unit?.data.title}${day?.title ? ` ${day.title}` : ''}`} · {Math.max(1, Math.round((Date.now() - session.startedAt) / 60000))}분
        </div>
        <div className="card list-card">
          {!reviewOnly && <div className="item-row"><div className="grow"><b>1 단어 암기</b><div className="muted small">새 단어 {vocab} · 복습 {rv}</div></div><b className="accent-text">{pct(vocabOk, vocab)}</b></div>}
          {reviewOnly && <div className="item-row"><div className="grow"><b>오답 단어</b><div className="muted small">{rv}개 복습</div></div></div>}
          {!reviewOnly && <div className="item-row"><div className="grow"><b>2 문법 카드</b><div className="muted small">{cards}장</div></div><b className="accent-text">완료</b></div>}
          {!reviewOnly && <div className="item-row"><div className="grow"><b>3 예문 작성</b><div className="muted small">새 예문 {sentences} · 복습 {rs}</div></div><b className="accent-text">{pct(sentencesOk, sentences)}</b></div>}
          {reviewOnly && <div className="item-row"><div className="grow"><b>오답 예문</b><div className="muted small">{rs}개 복습</div></div></div>}
        </div>
        <div className="blk-note">기억이 약한 것은 내일, 잘 기억한 것은 며칠 뒤에 다시 만나요. 오답 노트에서 언제든 확인할 수 있어요.</div>
        <div className="grow" />
        <button className="btn primary wide big" onClick={() => go('/')}>홈으로</button>
        <button className="btn ghost wide" onClick={() => go('/notes')}>오답 노트 보기</button>
      </>
    )
  }

  return (
    <div className="study">
      <TopBar step={st.step} i={st.i} total={st.queue.length} review={reviewOnly} onClose={close} />
      {st.step === 'grammar' && (
        <button className="link small" onClick={() => setShowOrig(!showOrig)}>{showOrig ? '원본 닫기' : '원본 페이지 함께 보기'}</button>
      )}
      {body}
    </div>
  )
}
