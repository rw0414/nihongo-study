import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, type Review, type Sentence, type Session, type Step, type Vocab, type VocabGrade } from '../db'
import { dayContent, dayKey, grade, pickSentences, pickVocab, type Grade } from '../study'
import { CardView, OriginalPage } from './Unit'
import { go } from '../App'

// 오늘의 학습 루틴 (Phase 3)
// 1단계 단어: 새 단어 → (틀린 게 있으면) 전환 화면 → 틀린 단어 복습
// 2단계 문법 카드
// 3단계 예문: 새 예문 → (틀린 게 있으면) 전환 화면 → 틀린 예문 다시 쓰기
// 진행 상태는 매 답마다 sessions에 저장되어, 앱을 닫았다 열어도 이어서 한다.

const STAGE: Record<Step, number> = { vocab: 0, 'vocab-intro': 0, 'vocab-review': 0, grammar: 1, sentence: 2, 'sentence-intro': 2, 'sentence-review': 2, done: 3 }
const STAGE_NAME = ['1단계 · 단어 암기', '2단계 · 문법 카드', '3단계 · 예문 작성']
const MAX_TRIES = 3 // 같은 날 복습에서 한 항목을 다시 내는 최대 횟수

/** 발음 듣기: 기기 내장 음성 합성(일본어). 교재 음원 연결은 Phase 6 */
function speak(text: string) {
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

function TopBar({ step, i, total, onClose }: { step: Step; i: number; total: number; onClose: () => void }) {
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
          <b className="accent-text">{STAGE_NAME[stage]}</b>
          <span className="grow" />
          {step.endsWith('review') && <span className="tag warn">틀린 것 복습</span>}
        </div>
      )}
    </>
  )
}

// ── 1단계: 단어 카드 ──
function VocabCard({ v, example, onGrade }: { v: Vocab; example?: { ja: string; ko: string }; onGrade: (g: VocabGrade, ms: number) => void }) {
  const [back, setBack] = useState(false)
  const shown = useRef(Date.now())
  useEffect(() => { setBack(false); shown.current = Date.now() }, [v.id])
  const ai = v.origin === 'ai'
  return (
    <>
      <div className="card flash-card">
        <span className={`tag ${ai ? 'ai' : 'info'} corner`}>{ai ? 'AI 제안 단어' : '교재 단어'}</span>
        {back && v.reading !== v.ja && <div className="jp reading">{v.reading}</div>}
        <div className="jp flash-ja">{v.ja}</div>
        <button className="icon-btn round" aria-label="발음 듣기" onClick={() => speak(v.reading || v.ja)}>🔊</button>
        {back ? (
          <>
            <div className="flash-ko">{v.ko}</div>
            {example && (
              <div className="flash-ex">
                <span className="tag info">교재 예문</span>
                <div className="jp">{example.ja}</div>
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

// ── 3단계: 예문 입력·채점 ──
function DiffView({ g }: { g: Grade }) {
  return (
    <div className="jp diff">
      {g.diff.map((p, i) => <span key={i} className={`d-${p.t}`}>{p.s}</span>)}
    </div>
  )
}

function SentenceCard({ s, review, onDone }: { s: Sentence; review: boolean; onDone: (g: Grade | null, answer: string, ms: number) => void }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<{ g: Grade | null; answer: string }>()
  const shown = useRef(Date.now())
  const took = useRef(0)
  useEffect(() => { setText(''); setResult(undefined); shown.current = Date.now() }, [s.id])

  const submit = (giveUp = false) => {
    took.current = Date.now() - shown.current
    setResult({ g: giveUp ? null : grade(text, s), answer: giveUp ? '' : text })
  }

  if (!result) {
    return (
      <>
        <div className="card prompt-card">
          <div className="muted small">{review ? '아까 틀린 문장이에요. 다시 써 보세요' : s.given ? '주어진 단어로 문장을 만들어 보세요' : '다음 문장을 일본어로 써 보세요'}</div>
          {s.given && <div className="jp given">{s.given}</div>}
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
  return (
    <>
      <div className={`card result-head ${ok ? 'good' : 'bad'}`}>
        <div className="score">{g ? g.score : '–'}</div>
        <div>
          <div className="result-title">{ok ? '정답이에요!' : g ? '아쉬워요, 거의 다 왔어요' : '정답을 확인해 봐요'}</div>
          <div className="small">
            {g?.kanaOnly ? '가나로 맞게 썼어요. 한자로도 써 보면 더 좋아요!' : g?.particleHint ? '조사 한 곳만 다시 볼까요?' : ok ? '완벽해요.' : '다음엔 꼭 맞힐 수 있어요.'}
          </div>
        </div>
      </div>
      <div className="card col">
        {g && !ok && (
          <>
            <div className="muted small">내 답안 (빨간 줄 = 잘못 들어간 글자, 파란 글자 = 빠진 글자)</div>
            <DiffView g={g} />
          </>
        )}
        {ok && <div className="jp big-ja">{answer}</div>}
        <div className="muted small">{s.answerBy === 'teacher' ? '정답 (선생님 작성 · 교재 정답 없음)' : `교재 정답 · p.${s.page}`}</div>
        {s.answers.map(a => <div key={a} className="jp ans">{a}</div>)}
        {!!s.alts?.length && <div className="muted small">이렇게 써도 정답이에요</div>}
        {s.alts?.map(a => <div key={a} className="jp ans alt">{a}</div>)}
        <div className="muted small">{s.ko}</div>
      </div>
      <div className="grow" />
      {!ok && <button className="btn wide" onClick={() => { setResult(undefined); setText(''); shown.current = Date.now() }}>다시 입력</button>}
      <button className="btn primary wide big" onClick={() => onDone(g, answer, took.current)}>다음</button>
    </>
  )
}

// ── 전환 화면 ("틀린 것 복습해 봐요") ──
function Intro({ title, sub, items, onGo }: { title: string; sub: string; items: string[]; onGo: () => void }) {
  const [left, setLeft] = useState(3)
  useEffect(() => {
    if (left === 0) { onGo(); return }
    const t = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(t)
  }, [left, onGo])
  return (
    <>
      <div className="intro-check">✓</div>
      <div className="intro-title">{title}</div>
      <div className="card col">
        <div className="result-title">이제 틀린 것을 복습해 봐요</div>
        <div className="muted small">{sub}</div>
        <div className="chips">{items.slice(0, 8).map(t => <span key={t} className="tag warn jp">{t}</span>)}{items.length > 8 && <span className="muted small">외 {items.length - 8}개</span>}</div>
      </div>
      <div className="grow" />
      <button className="btn primary wide big" onClick={onGo}>복습 시작 · {left}초 후 자동</button>
      <div className="muted small center">복습까지 마치면 다음 단계로 넘어가요</div>
    </>
  )
}

export default function Study({ bookId, cid, partId }: { bookId: string; cid: string; partId?: string }) {
  const unitId = `${bookId}/${cid}`
  const key = `${unitId}#${partId ?? 'all'}`
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const unit = useLiveQuery(() => db.units.get(unitId), [unitId])
  const vocabAll = useLiveQuery(() => db.vocab.where('unitId').equals(unitId).toArray(), [unitId])
  const sentAll = useLiveQuery(() => db.sentences.where('unitId').equals(unitId).toArray(), [unitId])
  const [session, setSession] = useState<Session>()
  const [showOrig, setShowOrig] = useState(false)

  const ready = book && unit && vocabAll && sentAll
  const day = ready ? dayContent(unit.data, partId) : undefined
  const parts = unit?.data.parts
  const isLast = !parts || parts.at(-1)?.id === partId
  const V = ready && day ? pickVocab(vocabAll, day, isLast) : []
  // 예문은 교재 순서대로 (DB는 id 순이라 실력 다지기가 먼저 나옴)
  const order = new Map(unit?.data.sentences.map((s, i) => [`${unitId}/${s.id}`, i]))
  const S = ready && day ? pickSentences(sentAll, day, unitId).sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0)) : []

  const queueFor = (step: Step, st: Session['state']) =>
    step === 'vocab' ? V.map(v => v.id) :
    step === 'vocab-review' ? st.wrongV :
    step === 'grammar' ? day!.cards.map(c => c.id) :
    step === 'sentence' ? S.map(s => s.id) :
    step === 'sentence-review' ? st.wrongS : []

  // 다음 단계 (비어 있는 단계는 건너뜀)
  const after = (step: Step, st: Session['state']): Step => {
    const order: Step[] = ['vocab', 'vocab-intro', 'vocab-review', 'grammar', 'sentence', 'sentence-intro', 'sentence-review', 'done']
    for (let k = order.indexOf(step) + 1; k < order.length; k++) {
      const s = order[k]
      if (s === 'vocab-intro' || s === 'vocab-review') { if (st.wrongV.length) return s; continue }
      if (s === 'sentence-intro' || s === 'sentence-review') { if (st.wrongS.length) return s; continue }
      if (s === 'done' || queueFor(s, st).length) return s
    }
    return 'done'
  }

  // 오늘 진행 중인 루틴을 불러오거나 새로 시작
  useEffect(() => {
    if (!ready || session) return
    ;(async () => {
      const today = dayKey()
      let s = await db.sessions.where('key').equals(key).filter(x => !x.endedAt && x.date === today).last()
      if (!s) {
        const st: Session['state'] = { step: 'vocab', queue: [], i: 0, wrongV: [], wrongS: [], tries: {} }
        st.step = queueFor('vocab', st).length ? 'vocab' : after('vocab', st)
        st.queue = queueFor(st.step, st)
        s = { key, unitId, partId, date: today, startedAt: Date.now(), state: st, stats: { vocab: 0, vocabOk: 0, sentences: 0, sentencesOk: 0, cards: 0 } }
        s.id = await db.sessions.add(s)
        const ch = await db.chapters.get(unitId)
        if (ch?.status === 'new') await db.chapters.update(unitId, { status: 'reading' })
      }
      setSession(s)
    })()
  }, [ready, key]) // eslint-disable-line react-hooks/exhaustive-deps

  if (!ready || !session || !day) return null
  const st = session.state

  const save = async (next: Session) => { setSession(next); await db.sessions.put(next) }

  const goStep = async (step: Step, base: Session = session) => {
    const nst = { ...base.state, step, i: 0 }
    nst.queue = queueFor(step, nst)
    const next = { ...base, state: nst }
    if (step === 'done') {
      next.endedAt = Date.now()
      // 단원의 모든 part를 마치면 목차에 '완료' 표시
      const keys = parts ? parts.map(p => `${unitId}#${p.id}`) : [key]
      const done = new Set((await db.sessions.where('unitId').equals(unitId).filter(x => !!x.endedAt).toArray()).map(x => x.key).concat(key))
      if (keys.every(k => done.has(k))) await db.chapters.update(unitId, { status: 'done' })
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

  const record = (r: Omit<Review, 'unitId' | 'date' | 'at' | 'phase'>) =>
    db.reviews.add({ ...r, unitId, date: dayKey(), at: Date.now(), phase: st.step.endsWith('review') ? 'review' : 'new' })

  const close = () => go(`/unit/${bookId}/${cid}`)
  let body: JSX.Element

  if (st.step === 'vocab' || st.step === 'vocab-review') {
    const v = vocabAll.find(x => x.id === st.queue[st.i])!
    const ex = day.cards.flatMap(c => c.blocks).find(b => b.t === 'ex' && b.ja.includes(v.ja)) as { ja: string; ko: string } | undefined
    body = (
      <VocabCard v={v} example={ex} onGrade={async (g, ms) => {
        const ok = g === 'good' || g === 'easy'
        await record({ itemType: 'vocab', itemId: v.id, correct: ok, grade: g, responseMs: ms })
        const isNew = st.step === 'vocab' && !st.tries[v.id]
        const wrongV = !ok && !st.wrongV.includes(v.id) && st.step === 'vocab' ? [...st.wrongV, v.id] : st.wrongV
        await advance({ wrongV }, isNew ? { vocab: session.stats.vocab + 1, vocabOk: session.stats.vocabOk + (ok ? 1 : 0) } : {}, g === 'again' || (st.step === 'vocab-review' && g === 'hard'))
      }} />
    )
  } else if (st.step === 'vocab-intro') {
    body = <Intro title={`새 단어 ${V.length}개 완료!`} sub={`헷갈렸던 ${st.wrongV.length}개를 한 번 더 볼게요`}
      items={st.wrongV.map(id => vocabAll.find(v => v.id === id)?.ja ?? '')} onGo={() => goStep('vocab-review')} />
  } else if (st.step === 'grammar') {
    const c = day.cards.find(x => x.id === st.queue[st.i])!
    const sMap = new Map(sentAll.map(s => [s.id.slice(unitId.length + 1), s]))
    body = (
      <>
        <div className="grammar-scroll">
          <CardView c={c} sentences={sMap} offset={book.printedPageOffset} bookId={bookId} />
          {showOrig && <OriginalPage bookId={bookId} page={c.page} />}
        </div>
        <div className="row">
          <button className="btn" disabled={st.i === 0} onClick={() => save({ ...session, state: { ...st, i: st.i - 1 } })} aria-label="이전 카드">‹</button>
          <button className="btn grow primary big" onClick={() => { setShowOrig(false); advance({}, { cards: session.stats.cards + 1 }) }}>
            {st.i + 1 < st.queue.length ? '다음 카드' : '문법 카드 완료'}
          </button>
        </div>
      </>
    )
  } else if (st.step === 'sentence' || st.step === 'sentence-review') {
    const s = sentAll.find(x => x.id === st.queue[st.i])!
    body = (
      <SentenceCard s={s} review={st.step === 'sentence-review'} onDone={async (g, answer, ms) => {
        const ok = !!g?.ok
        await record({ itemType: 'sentence', itemId: s.id, correct: ok, score: g?.score ?? 0, answer, responseMs: ms })
        const wrongS = !ok && st.step === 'sentence' && !st.wrongS.includes(s.id) ? [...st.wrongS, s.id] : st.wrongS
        await advance({ wrongS }, st.step === 'sentence' ? { sentences: session.stats.sentences + 1, sentencesOk: session.stats.sentencesOk + (ok ? 1 : 0) } : {})
      }} />
    )
  } else if (st.step === 'sentence-intro') {
    body = <Intro title={`새 예문 ${S.length}개 완료!`} sub={`틀린 ${st.wrongS.length}개를 다시 써 볼게요`}
      items={st.wrongS.map(id => sentAll.find(s => s.id === id)?.ko ?? '')} onGo={() => goStep('sentence-review')} />
  } else {
    const { vocab, vocabOk, sentences, sentencesOk, cards } = session.stats
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–')
    body = (
      <>
        <div className="intro-check">✓</div>
        <div className="intro-title">오늘 학습 완료!</div>
        <div className="muted center">{unit.data.title}{day.title ? ` ${day.title}` : ''} · {Math.max(1, Math.round((Date.now() - session.startedAt) / 60000))}분</div>
        <div className="card list-card">
          <div className="item-row"><div className="grow"><b>1 단어 암기</b><div className="muted small">새 단어 {vocab} · 틀린 단어 복습 {st.wrongV.length}</div></div><b className="accent-text">{pct(vocabOk, vocab)}</b></div>
          <div className="item-row"><div className="grow"><b>2 문법 카드</b><div className="muted small">{cards}장</div></div><b className="accent-text">완료</b></div>
          <div className="item-row"><div className="grow"><b>3 예문 작성</b><div className="muted small">새 예문 {sentences} · 틀린 예문 복습 {st.wrongS.length}</div></div><b className="accent-text">{pct(sentencesOk, sentences)}</b></div>
        </div>
        {(st.wrongV.length > 0 || st.wrongS.length > 0) && <div className="blk-note">헷갈렸던 항목은 기록해 두었어요. 다음 복습(Phase 4)에서 다시 만나요.</div>}
        <div className="grow" />
        <button className="btn primary wide big" onClick={() => go('/')}>홈으로</button>
        <button className="btn ghost wide" onClick={close}>단원 화면으로</button>
      </>
    )
  }

  return (
    <div className="study">
      <TopBar step={st.step} i={st.i} total={st.queue.length} onClose={close} />
      {st.step === 'grammar' && (
        <button className="link small" onClick={() => setShowOrig(!showOrig)}>{showOrig ? '원본 닫기' : '원본 페이지 함께 보기'}</button>
      )}
      {body}
    </div>
  )
}
