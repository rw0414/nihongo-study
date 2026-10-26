import { useEffect, useMemo, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, STAGES, type Cursor, type Review, type Sentence, type Session, type Stage, type Step, type Vocab, type VocabGrade } from '../db'
import { chunks, dayContent, dayKey, grade, orderSentences, pickSentences, pickVocab, shuffle, traps, type Grade } from '../study'
import { addDays, ankiAnswer, dueToday, dueVocab, newSched, recovery, relatedPicks, review, sentenceGrade, vocabState, type ErrorType } from '../srs'
import { CardView } from './Unit'
import { go } from '../App'
import { Ja } from '../Ja'
import { hanjaOf } from '../hanja'
import { toRomaji } from '../romaji'

// 오늘의 학습 루틴. 세 단계는 홈에서 골라 어느 것부터 해도 되고, 단계마다 진행 위치를 따로 기억한다.
// 1단계 단어: 새 단어(처음 보는 단어만) → 전환 화면 → 복습. 복습은 안키처럼 시간이 된 단어만 나온다 (1분·10분 학습 단계, 며칠 뒤 복습)
// 2단계 문법 카드 (맛보기 연습·실력 다지기 문제는 3단계로 옮김)
// 3단계 예문: 새 예문(맛보기 연습은 블록 배열) → 전환 화면 → 오늘 틀린 예문 + 복습할 때가 된 예문
// 오답만 학습(cid 없음): 아직 회복하지 못한 오답 단어 → 오답 예문
// 진행 상태는 매 답마다 sessions에 저장되어, 앱을 닫았다 열어도 이어서 한다.

const STEPS: Record<Stage, Step[]> = { vocab: ['vocab', 'vocab-intro', 'vocab-review'], grammar: ['grammar'], sentence: ['sentence', 'sentence-intro', 'sentence-review'] }
const LABEL: Record<Stage, string> = { vocab: '단어 암기', grammar: '문법 카드', sentence: '예문 작성' }
const stageOf = (s: Step): Stage => (s.startsWith('vocab') ? 'vocab' : s === 'grammar' ? 'grammar' : 'sentence')
const MAX_TRIES = 6 // 같은 학습에서 한 단어를 다시 내는 최대 횟수
const DUE_LIMIT = { vocab: 30, sentence: 10 } // 하루 루틴에 섞는 복습 예정 항목 최대 수
const IDLE_MS = 60000, TICK_MS = 5000 // 1분 넘게 아무 조작이 없으면 학습 시간에서 뺀다

/** 발음 듣기: 기기 내장 음성 합성(일본어). 교재 음원 연결은 Phase 6 */
function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ja-JP'
  speechSynthesis.cancel()
  speechSynthesis.speak(u)
}

/** 실제 학습 시간: 화면이 보이고 최근 1분 안에 조작이 있을 때만 5초씩 더한다 */
function useActiveTime(id: number | undefined, initial: number) {
  const ms = useRef(initial)
  const last = useRef(Date.now())
  useEffect(() => {
    if (id === undefined) return
    ms.current = initial
    const touch = () => { last.current = Date.now() }
    const evs = ['pointerdown', 'keydown', 'wheel', 'touchmove', 'scroll']
    evs.forEach(e => addEventListener(e, touch, { capture: true, passive: true }))
    const t = setInterval(() => {
      if (document.hidden || Date.now() - last.current > IDLE_MS) return
      ms.current += TICK_MS
      db.sessions.update(id, { activeMs: ms.current })
    }, TICK_MS)
    return () => { clearInterval(t); evs.forEach(e => removeEventListener(e, touch, { capture: true })) }
  }, [id]) // eslint-disable-line react-hooks/exhaustive-deps
  return ms
}

function TopBar({ stage, step, i, total, done, review, onClose }: { stage: Stage; step: Step; i: number; total: number; done: Set<Stage>; review?: boolean; onClose: () => void }) {
  const frac = total ? Math.min(i / total, 1) : 0
  return (
    <>
      <div className="study-top">
        <button className="icon-btn" aria-label="학습 닫기" onClick={onClose}>✕</button>
        <div className="stage-bars">
          {STAGES.map(n => (
            <div key={n} className="stage-bar"><div style={{ width: `${done.has(n) ? 100 : n === stage && step !== 'done' ? frac * 100 : 0}%` }} /></div>
          ))}
        </div>
        <span className="muted small counter">{total && step !== 'done' ? `${Math.min(i + 1, total)}/${total}` : ''}</span>
      </div>
      {step !== 'done' && (
        <div className="row small">
          <b className="accent-text">{review ? (stage === 'vocab' ? '오답 노트 · 단어' : '오답 노트 · 예문') : `${STAGES.indexOf(stage) + 1}단계 · ${LABEL[stage]}`}</b>
          <span className="grow" />
          {step.endsWith('review') && !review && <span className="tag warn">복습</span>}
        </div>
      )}
    </>
  )
}

// ── 단어 카드: 탭하면 뜻, 오른쪽으로 밀면 알고 있음 · 왼쪽은 모름 ──
function VocabCard({ v, example, tag, onAnswer }: { v: Vocab; example?: { ja: string; ko: string }; tag?: string; onAnswer: (know: boolean, ms: number) => void }) {
  const [back, setBack] = useState(false)
  const [forced, setForced] = useState(false) // 모름을 고르면 뜻을 먼저 보여 주고 넘긴다
  const [dx, setDx] = useState(0)
  const [drag, setDrag] = useState(false)
  const [fly, setFly] = useState(0)
  const start = useRef<{ x: number; t: number } | null>(null)
  const shown = useRef(Date.now())
  const ai = v.origin === 'ai'
  const hanja = hanjaOf(v.ja)

  const answer = (know: boolean, dir: number) => {
    if (fly) return
    if (!forced && !know && !back) { setBack(true); setForced(true); setDx(0); return }
    setFly(dir)
    setTimeout(() => onAnswer(know && !forced, Date.now() - shown.current), 220)
  }
  const up = (e: React.PointerEvent) => {
    if (!start.current) return
    const d = e.clientX - start.current.x, speed = Math.abs(d) / (Date.now() - start.current.t + 1)
    start.current = null
    setDrag(false)
    if (Math.abs(d) < 8) { if (!forced) setBack(b => !b); setDx(0) }
    else if (Math.abs(d) > 100 || speed > 0.6) answer(d > 0, d > 0 ? 1 : -1)
    else setDx(0)
  }
  const x = fly ? fly * window.innerWidth * 1.2 : dx
  const p = Math.min(Math.abs(dx) / 100, 1)

  return (
    <>
      <div className="swipe-area">
        <div className="card flash-card ghost" aria-hidden />
        <div className="card flash-card swipe" style={{ transform: `translateX(${x}px) rotate(${x / 18}deg)`, transition: drag ? 'none' : 'transform .25s ease' }}
          onPointerDown={e => {
            if ((e.target as HTMLElement).closest('button') || fly) return
            start.current = { x: e.clientX, t: Date.now() }
            setDrag(true)
            try { e.currentTarget.setPointerCapture(e.pointerId) } catch { /* 이미 끝난 포인터 */ }
          }}
          onPointerMove={e => start.current && setDx(e.clientX - start.current.x)}
          onPointerUp={up} onPointerCancel={up}>
          <span className="swipe-label know" style={{ opacity: dx > 0 && !forced ? p : 0 }}>알고 있음</span>
          <span className="swipe-label dont" style={{ opacity: dx < 0 || (forced && dx) ? p : 0 }}>{forced ? '다음' : '모름'}</span>
          <span className={`tag ${ai ? 'ai' : 'info'} corner`}>{ai ? 'AI 제안 단어' : '교재 단어'}</span>
          {tag && <span className="tag warn corner-r">{tag}</span>}
          <div className="jp flash-ja"><Ja text={v.ja} kana={v.reading} /></div>
          <button className="icon-btn round" aria-label="발음 듣기" onClick={() => speak(v.reading || v.ja)}>🔊</button>
          {back ? (
            <div className="flash-back">
              <div className="flash-ko">{v.ko}</div>
              {hanja.length > 0 && (
                <div className="hanja-row">{hanja.map(h => <span key={h.c} className="hanja"><b className="jp">{h.c}</b> {h.m}</span>)}</div>
              )}
              {example && (
                <div className="flash-ex">
                  <span className="tag info">교재 예문</span>
                  <div className="jp"><Ja text={example.ja} /></div>
                  <div className="muted small">{example.ko}</div>
                </div>
              )}
            </div>
          ) : (
            <div className="muted">탭하면 뜻을 볼 수 있어요</div>
          )}
        </div>
      </div>
      {forced ? (
        <button className="btn primary wide big" onClick={() => answer(false, -1)}>다음</button>
      ) : (
        <div className="know-row">
          <button className="btn grade-again" onClick={() => answer(false, -1)}>모름</button>
          <button className="btn grade-good" onClick={() => answer(true, 1)}>알고 있음</button>
        </div>
      )}
      <div className="muted small center">{forced ? '뜻을 확인하고 넘겨요 (어느 쪽으로 밀어도 돼요)' : '오른쪽으로 밀면 알고 있음 · 왼쪽으로 밀면 모름'}</div>
    </>
  )
}

// ── 준비마당 가나: 보이는 글자를 일본어 키보드로 직접 입력 (스와이프 대신) ──
const toHira = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))
/**
 * 입력 화면에서는 폰 키보드가 늘 올라와 있게: 입력칸은 카드가 바뀌어도 그대로 두고(키보드가 내려가지 않음) 포커스를 지킨다.
 * 화면 높이는 키보드를 뺀 '보이는 영역'(visualViewport)에 맞춘다.
 */
function useKeyboardFrame() {
  useEffect(() => {
    const vv = window.visualViewport
    const fit = () => {
      document.documentElement.style.setProperty('--vvh', `${vv ? vv.height : innerHeight}px`)
      if (vv && vv.offsetTop) window.scrollTo(0, 0) // 아이폰이 입력칸을 보이려고 화면을 밀어 올린 것 되돌리기
    }
    fit()
    vv?.addEventListener('resize', fit)
    vv?.addEventListener('scroll', fit)
    return () => { vv?.removeEventListener('resize', fit); vv?.removeEventListener('scroll', fit); document.documentElement.style.removeProperty('--vvh') }
  }, [])
}

function KanaCard({ v, n, tag, onAnswer }: { v: Vocab; n: string; tag?: string; onAnswer: (know: boolean, ms: number) => void }) {
  const [typed, setTyped] = useState('')
  const [panel, setPanel] = useState<'how' | 'setup'>()
  const [res, setRes] = useState<'ok' | 'kata' | 'bad'>()
  const shown = useRef(Date.now()), took = useRef(0)
  const inp = useRef<HTMLTextAreaElement>(null)
  const kata = /[ァ-ヶ]/.test(v.ja)
  useKeyboardFrame()
  // 다음 글자: 입력칸은 그대로, 내용만 비운다
  useEffect(() => { setTyped(''); setRes(undefined); setPanel(undefined); shown.current = Date.now(); inp.current?.focus() }, [n])
  const check = () => {
    if (!typed.trim()) return
    took.current = Date.now() - shown.current
    const a = typed.normalize('NFKC').replace(/\s/g, '')
    setRes(a === v.ja ? 'ok' : toHira(a) === toHira(v.ja) ? 'kata' : 'bad')
  }
  const next = () => res && onAnswer(res === 'ok', took.current)
  const how = (
    <div className="kana-how">
      <div className="keys">{[...toRomaji(v.ja)].map((k, i) => <kbd key={i}>{k}</kbd>)}</div>
      {kata && <div className="muted small">로마자로 친 뒤 키보드 위 후보에서 가타카나를 골라요 (PC는 F7)</div>}
      {/[ゃゅょぁぃぅぇぉャュョァィゥェォっッ]/.test(v.ja) && <div className="muted small">작은 글자는 x를 먼저 (ゃ = xya, っ = xtu). 겹치는 っ는 다음 자음 두 번 (がっこう = gakkou)</div>}
      {/[んン]/.test(v.ja) && <div className="muted small">ん은 n을 두 번 (nn)</div>}
      {/ー/.test(v.ja) && <div className="muted small">길게 늘이는 ー는 빼기(-) 키</div>}
    </div>
  )
  const m = res === 'ok' ? { cls: 'good', mark: '✓', title: '정답이에요!' } : res === 'kata' ? { cls: 'near', mark: '△', title: '가타카나로 바꿔야 해요' } : { cls: 'bad', mark: '✗', title: '틀렸어요' }
  return (
    // 버튼을 눌러도 입력칸에서 포커스가 빠지지 않게 (키보드가 내려가지 않음)
    <div className="kana-wrap" onMouseDown={e => { if (e.target !== inp.current) e.preventDefault() }}>
      <div className={`card kana-stage ${res ? `verdict ${m.cls}` : ''}`} key={n}>
        <span className="tag info corner">{kata ? '가타카나 입력' : '히라가나 입력'}</span>
        {tag && <span className="tag warn corner-r">{tag}</span>}
        {panel === 'setup' ? (
          <ol className="small kana-setup">
            <li>갤럭시: 설정 → 일반 → 삼성 키보드 설정 → 언어 및 유형 → 입력 언어 관리 → 日本語 켜기 → <b>쿼티</b></li>
            <li>Gboard·아이폰: 키보드 설정 → 키보드 추가 → 일본어 → <b>로마자(QWERTY)</b></li>
            <li>키보드의 🌐 또는 스페이스바를 옆으로 밀어 일본어로 바꿔요</li>
          </ol>
        ) : res ? (
          <>
            <div className="verdict-inline"><span className="verdict-mark" aria-hidden>{m.mark}</span>{m.title}</div>
            <div className="jp kana-big sm">{v.ja}</div>
            <div className="muted small">{v.ko}{res !== 'ok' ? ` · 내 입력: ${typed}` : ''}</div>
            {how}
          </>
        ) : (
          <>
            <div className="jp kana-big">{v.ja}</div>
            <button className="icon-btn round" aria-label="발음 듣기" onClick={() => speak(v.reading || v.ja)}>🔊</button>
            {panel === 'how' && how}
          </>
        )}
      </div>
      <div className="kana-row">
        {/* 한 줄 입력칸(input)이면 크롬이 키보드 위에 비밀번호·카드·주소 자동 완성 막대를 띄워서 여러 줄 입력칸(textarea)을 한 줄 높이로 씀 */}
        <textarea ref={inp} rows={1} className="jp answer-box kana-input" value={typed} lang="ja" autoFocus autoComplete="off" autoCorrect="off" spellCheck={false}
          enterKeyHint={res ? 'next' : 'done'} placeholder="여기에 입력"
          onChange={e => { if (!res) setTyped(e.target.value) }}
          onBlur={() => requestAnimationFrame(() => inp.current?.focus())}
          onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); if (res) next(); else check() } }} />
        {res
          ? <button className="btn primary kana-go" onClick={next}>다음</button>
          : <button className="btn primary kana-go" disabled={!typed.trim()} onClick={check}>확인</button>}
      </div>
      <div className="kana-links small">
        {res && res !== 'ok'
          ? <button className="link" onClick={() => { setRes(undefined); setTyped(''); shown.current = Date.now() }}>다시 입력</button>
          : <button className="link" onClick={() => setPanel(panel === 'how' ? undefined : 'how')}>{panel === 'how' ? '입력 방법 닫기' : '입력 방법 보기'}</button>}
        <button className="link" onClick={() => setPanel(panel === 'setup' ? undefined : 'setup')}>{panel === 'setup' ? '닫기' : '일본어 키보드 설정'}</button>
      </div>
    </div>
  )
}

// ── 예문 입력·채점 ──
function DiffView({ g }: { g: Grade }) {
  return <div className="jp diff">{g.diff.map((p, i) => <span key={i} className={`d-${p.t}`}>{p.s}</span>)}</div>
}

/** 판정 표시 (말해보카식: 정답 / 아까워요 / 오답, 점수 숫자 없음) */
function verdictOf(g: Grade | null) {
  const ok = !!g?.ok
  return ok ? { ok, cls: 'good', mark: '✓', title: g?.kanaOnly ? '정답! 한자로도 써 봐요' : '정답이에요!' }
    : g && g.score >= 80 ? { ok, cls: 'near', mark: '△', title: '아까워요!' }
    : { ok, cls: 'bad', mark: '✗', title: g ? '틀렸어요' : '정답을 확인해 봐요' }
}

/** 예문 직접 쓰기: 키보드가 늘 올라와 있는 화면. 입력칸은 아래에 고정, 문제·채점 결과는 그 위에서 */
function TypedSentence({ s, n, review: isReview, tag, readings, onDone }: { s: Sentence; n: string; review: boolean; tag?: string; readings: [string, string][]; onDone: (g: Grade | null, answer: string, ms: number) => void }) {
  const [typed, setTyped] = useState('')
  const [result, setResult] = useState<{ g: Grade | null; answer: string }>()
  const shown = useRef(Date.now()), took = useRef(0)
  const inp = useRef<HTMLTextAreaElement>(null)
  useKeyboardFrame()
  useEffect(() => { setTyped(''); setResult(undefined); shown.current = Date.now(); inp.current?.focus() }, [n])
  const ready = !!typed.trim()
  const submit = (giveUp = false) => {
    took.current = Date.now() - shown.current
    setResult({ g: giveUp ? null : grade(typed, s, readings), answer: giveUp ? '' : typed })
  }
  const next = () => result && onDone(result.g, result.answer, took.current)
  /** 내 판단으로 정답 처리: 이 답을 허용 답안으로 저장 (다시 가져와도 유지) */
  const accept = async () => {
    if (!result?.g) return
    await db.sentences.update(s.id, { userAlts: [...(s.userAlts ?? []), result.answer.trim()], edited: true })
    onDone({ ...result.g, ok: true, score: 100 }, result.answer, took.current)
  }
  const g = result?.g ?? null
  const v = verdictOf(g)
  const [first, ...rest] = g?.findings ?? []
  return (
    // 버튼을 눌러도 입력칸에서 포커스가 빠지지 않게 (키보드가 내려가지 않음)
    <div className="kana-wrap" onMouseDown={e => { if (e.target !== inp.current) e.preventDefault() }}>
      <div className={`card type-stage ${result ? `verdict ${v.cls}` : ''}`} key={n + (result ? '-r' : '')}>
        {!result ? (
          <>
            <div className="muted small">{isReview ? (tag ?? '복습할 문장이에요. 다시 써 보세요') : s.given ? '주어진 단어로 문장을 만들어 보세요' : '다음 문장을 일본어로 써 보세요'}</div>
            {s.given && <div className="jp given"><Ja text={s.given} /></div>}
            <div className="prompt-ko">{s.ko}</div>
            {s.hint && <div className="blk-note">{s.hint}</div>}
          </>
        ) : (
          <>
            <div className="verdict-inline"><span className="verdict-mark" aria-hidden>{v.mark}</span>{v.title}</div>
            {!v.ok && first && <div className="verdict-why jp">{first.text}</div>}
            {g && !v.ok && <DiffView g={g} />}
            <div className="muted small">{s.answerBy === 'teacher' ? '정답 (선생님 작성 · 교재 정답 없음)' : `정답 · p.${s.page}`}</div>
            {/* 대표 정답 하나만 (여러 개를 보여 주면 헷갈림) */}
            <div className="jp ans"><Ja text={s.answers[0]} kana={s.kana?.[0]} /></div>
            <div className="muted small">{s.ko}</div>
            {g && !v.ok && (
              <details className="more">
                <summary>자세히</summary>
                {rest.length > 0 && <ul className="findings">{rest.map((f, i) => <li key={i} className="jp">{f.text}</li>)}</ul>}
                <div className="muted small">줄 그은 글자는 잘못 쓴 글자, 파란 글자는 들어가야 할 글자예요. 띄어쓰기와 마침표는 채점에 영향이 없어요.</div>
              </details>
            )}
          </>
        )}
      </div>
      <div className="kana-row">
        <textarea ref={inp} id="answer" className="jp answer-box type-input" rows={2} value={typed} lang="ja" autoFocus autoComplete="off" autoCorrect="off" spellCheck={false}
          enterKeyHint={result ? 'next' : 'done'} placeholder="일본어로 입력 (가나만 써도 돼요)"
          onChange={e => { if (!result) setTyped(e.target.value) }}
          onBlur={() => requestAnimationFrame(() => inp.current?.focus())}
          onKeyDown={e => {
            // 키보드의 확인(엔터) = 채점, 결과에서는 다음. 일본어 변환 중의 엔터는 변환 확정이라 그대로 둔다
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            if (result) next()
            else if (ready) submit()
          }} />
        {result
          ? <button className="btn primary kana-go" onClick={next}>다음</button>
          : <button className="btn primary kana-go" disabled={!ready} onClick={() => submit()}>채점</button>}
      </div>
      <div className="kana-links small">
        {!result ? (
          <>
            <button className="link" onClick={() => submit(true)}>모르겠어요 · 정답 보기</button>
            <span className="muted">끝의 。와 공백은 무시해요</span>
          </>
        ) : !v.ok ? (
          <>
            <button className="link" onClick={() => { setResult(undefined); setTyped(''); shown.current = Date.now() }}>다시 입력</button>
            {g && <button className="link" onClick={accept}>내 답도 맞아요 · 정답 처리</button>}
          </>
        ) : <span />}
      </div>
    </div>
  )
}

function SentenceCard({ s, n = s.id, review: isReview, tag, readings, words = [], onDone }: { s: Sentence; n?: string; review: boolean; tag?: string; readings: [string, string][]; words?: string[]; onDone: (g: Grade | null, answer: string, ms: number) => void }) {
  if (s.src !== 'practice') return <TypedSentence s={s} n={n} review={isReview} tag={tag} readings={readings} onDone={onDone} />
  return <BlockSentence s={s} review={isReview} tag={tag} readings={readings} words={words} onDone={onDone} />
}

/** 맛보기 연습: 블록을 순서대로 눌러 문장 만들기 (함정 블록 섞음) */
function BlockSentence({ s, review: isReview, tag, readings, words = [], onDone }: { s: Sentence; review: boolean; tag?: string; readings: [string, string][]; words?: string[]; onDone: (g: Grade | null, answer: string, ms: number) => void }) {
  const pieces = useMemo(() => {
    const c = chunks(s.answers[0])
    return shuffle([...c, ...traps(c, words)])
  }, [s.id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [picked, setPicked] = useState<number[]>([])
  const [result, setResult] = useState<{ g: Grade | null; answer: string }>()
  const shown = useRef(Date.now())
  const took = useRef(0)
  useEffect(() => { setPicked([]); setResult(undefined); shown.current = Date.now() }, [s.id])
  // 결과 화면에서 엔터 = 다음
  useEffect(() => {
    if (!result) return
    const f = (e: KeyboardEvent) => {
      if (e.key !== 'Enter' || e.isComposing) return
      e.preventDefault()
      onDone(result.g, result.answer, took.current)
    }
    addEventListener('keydown', f)
    return () => removeEventListener('keydown', f)
  }, [result]) // eslint-disable-line react-hooks/exhaustive-deps
  const text = picked.map(k => pieces[k]).join('')
  const ready = picked.length > 0

  const submit = (giveUp = false) => {
    took.current = Date.now() - shown.current
    setResult({ g: giveUp ? null : grade(text, s, readings), answer: giveUp ? '' : text })
  }
  if (!result) {
    return (
      <>
        <div className="card prompt-card">
          <div className="muted small">{isReview ? (tag ?? '복습할 문장이에요. 다시 써 보세요') : '블록을 순서대로 눌러 문장을 만들어 보세요'}</div>
          {s.given && <div className="jp given"><Ja text={s.given} /></div>}
          <div className="prompt-ko">{s.ko}</div>
          {s.hint && <div className="blk-note">{s.hint}</div>}
        </div>
        {(
          <>
            <div className="block-line jp" aria-label="내 답안">
              {picked.length ? picked.map(k => (
                <button key={k} className="chip-block on" onClick={() => setPicked(picked.filter(x => x !== k))}><Ja text={pieces[k]} /></button>
              )) : <span className="muted small">아래 블록을 눌러 채워요. 다시 누르면 빠져요</span>}
            </div>
            <div className="block-bank jp">
              {pieces.map((t, k) => (
                <button key={k} className={`chip-block ${picked.includes(k) ? 'used' : ''}`} disabled={picked.includes(k)} onClick={() => setPicked([...picked, k])}><Ja text={t} /></button>
              ))}
            </div>
          </>
        )}
        <div className="grow" />
        <button className="btn primary wide big" disabled={!ready} onClick={() => submit()}>확인</button>
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
        {/* 대표 정답 하나만 (여러 개를 보여 주면 헷갈림) */}
        <div className="jp ans"><Ja text={s.answers[0]} kana={s.kana?.[0]} /></div>
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
            {!ok && <button className="btn wide" onClick={() => { setResult(undefined); setPicked([]); shown.current = Date.now() }}>다시 입력</button>}
      <button className="btn primary wide big" onClick={() => onDone(g, answer, took.current)}>다음</button>
    </>
  )
}

// ── 전환 화면 ("틀린 것 복습해 봐요") ──
function Intro({ title, wrong, again, due, items, onGo }: { title: string; wrong: number; again: number; due: number; items: string[]; onGo: () => void }) {
  const [left, setLeft] = useState(3)
  useEffect(() => {
    if (left === 0) { onGo(); return }
    const t = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(t)
  }, [left, onGo])
  const sub = [wrong && `헷갈린 ${wrong}개`, again && `처음 본 단어 ${again}개 한 번 더`, due && `복습할 때가 된 ${due}개`].filter(Boolean).join(' · ')
  return (
    <>
      <div className="intro-check">✓</div>
      <div className="intro-title">{title}</div>
      <div className="card col">
        <div className="result-title">{wrong ? '이제 틀린 것을 복습해 봐요' : again ? '한 번 더 확인해 봐요' : '이제 복습할 차례예요'}</div>
        <div className="muted small">{sub}</div>
        <div className="chips">{items.slice(0, 8).map((t, i) => <span key={i} className="tag warn jp"><Ja text={t} /></span>)}{items.length > 8 && <span className="muted small">외 {items.length - 8}개</span>}</div>
      </div>
      <div className="grow" />
      <button className="btn primary wide big" onClick={onGo}>복습 시작 · {left}초 후 자동</button>
      <div className="muted small center">복습까지 마치면 이 단계가 끝나요</div>
    </>
  )
}

export default function Study({ bookId, cid, partId, stage: want }: { bookId: string; cid?: string; partId?: string; stage?: Stage }) {
  const reviewOnly = !cid // 오답만 학습
  const unitId = reviewOnly ? `${bookId}/review` : `${bookId}/${cid}`
  const key = reviewOnly ? `review#${bookId}` : `${unitId}#${partId ?? 'all'}`
  const book = useLiveQuery(() => db.books.get(bookId), [bookId])
  const units = useLiveQuery(async () => new Map((await db.units.where('bookId').equals(bookId).toArray()).map(u => [u.id, u])), [bookId])
  // 복습 항목은 다른 단원에서도 오므로 교재 전체를 불러 둔다
  const vocabAll = useLiveQuery(() => db.vocab.where('bookId').equals(bookId).toArray(), [bookId])
  const sentAll = useLiveQuery(() => db.sentences.where('bookId').equals(bookId).toArray(), [bookId])
  const vSched = useLiveQuery(async () => new Map((await db.schedules.where('unitId').startsWith(`${bookId}/`).filter(x => x.itemType === 'vocab').toArray()).map(x => [x.itemId, x])), [bookId])
  const [session, setSession] = useState<Session>()
  const [nothing, setNothing] = useState(false) // 오답만 학습인데 복습할 게 없음
  const busy = useRef(false) // 연타 방지: 한 항목에 답은 한 번만 (저장이 끝나면 풀림)
  const active = useActiveTime(session?.id, session?.activeMs ?? 0)

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
  const V = ready && day ? pickVocab(unitVocab, day, isLast) : []
  // 3단계 예문: 본문 예문 + 실력 다지기 (맛보기 연습은 2단계 문법 카드 사이에서). 큰 문제 순서는 지키고 그 안에서는 섞는다
  const S = ready && day ? orderSentences(pickSentences(unitSent, day, unitId).filter(s => s.src !== 'practice'), day.cards, unitId) : []
  // 2단계: 문법 카드, 맛보기 연습 문제는 그 카드 바로 뒤에 블록 배열로 (q:예문id). 실력 다지기 카드는 3단계로
  const grammarItems = (day?.cards ?? []).filter(c => c.kind !== 'drill').flatMap(c => {
    if (c.kind !== 'practice') return [c.id]
    const qs = c.blocks.flatMap(b => (b.t === 'q' ? [`q:${unitId}/${b.ref}`] : []))
    return [...(c.blocks.some(b => b.t === 'note' || b.t === 'ex') ? [c.id] : []), ...qs]
  })
  const cards = day?.cards ?? []
  const words = unitVocab.map(v => v.ja)

  const queueFor = (step: Step, st: Session['state']) =>
    step === 'vocab' ? st.newV ?? V.map(v => v.id) :
    step === 'vocab-review' ? st.dueV ?? [] :
    step === 'grammar' ? grammarItems :
    step === 'sentence' ? S.map(s => s.id) :
    step === 'sentence-review' ? [...st.wrongS, ...(st.dueS ?? [])] : []

  /** 단계 안에서 step 다음에 할 것 (비어 있으면 건너뜀, 오답만 학습은 전환 화면 없이). 없으면 'done' */
  const after = (stage: Stage, step: Step | null, st: Session['state']): Step => {
    const list = STEPS[stage]
    for (let k = step ? list.indexOf(step) + 1 : 0; k < list.length; k++) {
      const s = list[k]
      if (s.endsWith('intro')) { if (!reviewOnly && queueFor(s === 'vocab-intro' ? 'vocab-review' : 'sentence-review', st).length) return s; continue }
      if (queueFor(s, st).length) return s
    }
    return 'done'
  }
  const cursorOf = (stage: Stage, st: Session['state']): Cursor => {
    const c = st.pos?.[stage]
    if (c) return c
    const step = after(stage, null, st)
    return { step, queue: queueFor(step, st), i: 0 }
  }
  /** 다른 단계로: 지금 위치를 저장하고 그 단계의 마지막 위치에서 이어서 */
  const enter = (stage: Stage, st: Session['state']): Session['state'] => {
    const pos = { ...st.pos, ...(st.stage ? { [st.stage]: { step: st.step, queue: st.queue, i: st.i } } : {}) }
    const c = cursorOf(stage, { ...st, pos })
    return { ...st, pos: { ...pos, [stage]: c }, stage, ...c }
  }
  const doneStages = (st: Session['state']) => new Set(STAGES.filter(x => (x === st.stage ? st.step : cursorOf(x, st).step) === 'done'))

  // 오늘 진행 중인 루틴을 불러오거나 새로 시작
  useEffect(() => {
    if (!ready || session) return
    ;(async () => {
      const today = dayKey()
      let s = await db.sessions.where('key').equals(key).filter(x => !x.endedAt && x.date === today).last()
      if (!s) {
        const sched = await db.schedules.where('unitId').startsWith(`${bookId}/`).toArray()
        const st: Session['state'] = { step: 'vocab', queue: [], i: 0, pos: {}, wrongV: [], wrongS: [], tries: {} }
        if (reviewOnly) {
          // 아직 회복하지 못한 오답: 틀린 횟수 많은 것부터. 직접 고른 연습이라 오늘 본 것도 포함
          const weak = (t: 'vocab' | 'sentence', n: number) => sched
            .filter(x => x.itemType === t && (recovery(x) === 'weak' || recovery(x) === 'recovering'))
            .sort((a, b) => b.wrongCount - a.wrongCount).slice(0, n).map(x => x.itemId)
          st.dueV = weak('vocab', 30)
          st.dueS = weak('sentence', 15)
          if (!st.dueV.length && !st.dueS.length) { setNothing(true); return } // 빈 복습은 기록하지 않음
        } else {
          // 새 단어 = 아직 한 번도 안 본 단어 (지난 단원을 다시 해도 이미 배운 단어는 시간에 맞춰 복습에서만)
          const seen = new Map(sched.map(x => [x.itemId, x]))
          st.newV = V.filter(v => vocabState(seen.get(v.id)) === 'new').map(v => v.id)
          st.dueS = dueToday(sched, today, 'sentence', new Set(S.map(x => x.id)), DUE_LIMIT.sentence)
        }
        s = { key, unitId, partId, date: today, startedAt: Date.now(), activeMs: 0, state: st, stats: { vocab: 0, vocabOk: 0, sentences: 0, sentencesOk: 0, cards: 0 } }
        s.id = await db.sessions.add(s)
        if (!reviewOnly) {
          const ch = await db.chapters.get(unitId)
          if (ch?.status === 'new') await db.chapters.update(unitId, { status: 'reading' })
        }
      }
      let st = s.state
      // 단어 복습은 지금 시각 기준으로 다시 계산 (오답만 학습은 고른 목록 그대로)
      if (!reviewOnly) {
        st = { ...st, dueV: dueVocab(await db.schedules.where('unitId').startsWith(`${bookId}/`).toArray(), Date.now()) }
        if (st.step === 'vocab-review') st = { ...st, queue: st.dueV!, i: 0 }
        if (st.pos?.vocab?.step === 'vocab-review') st = { ...st, pos: { ...st.pos, vocab: { step: 'vocab-review', queue: st.dueV!, i: 0 } } }
      }
      if (!st.pos) { // 옛 기록: 지금 단계 앞은 끝난 것으로
        const cur = stageOf(st.step), pos: Session['state']['pos'] = {}
        for (const x of STAGES.slice(0, STAGES.indexOf(cur))) pos[x] = { step: 'done', queue: [], i: 0 }
        st = { ...st, stage: cur, pos }
      }
      // 고른 단계 → 마지막으로 하던 단계 → 아직 안 끝난 첫 단계
      const done = doneStages(st)
      const target = want ?? (st.stage && !done.has(st.stage) ? st.stage : STAGES.find(x => !done.has(x)) ?? 'vocab')
      s = { ...s, state: enter(target, st) }
      await db.sessions.put(s)
      setSession(s)
    })()
  }, [ready, key]) // eslint-disable-line react-hooks/exhaustive-deps

  const st = session?.state
  // 오답만 학습: 한 단계가 끝나면 다음 단계로 바로
  useEffect(() => {
    if (!reviewOnly || !session || !st || st.step !== 'done') return
    const next = STAGES.find(x => !doneStages(st).has(x))
    if (next) save({ ...session, state: enter(next, st) })
  }, [st?.step, st?.stage]) // eslint-disable-line react-hooks/exhaustive-deps

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
  if (!ready || !session || !st) return null
  const stage = st.stage ?? stageOf(st.step)
  const close = () => go(reviewOnly ? '/notes' : '/')

  async function save(next: Session) {
    next = { ...next, activeMs: active.current, state: { ...next.state, pos: { ...next.state.pos, [next.state.stage ?? stage]: { step: next.state.step, queue: next.state.queue, i: next.state.i } } } }
    setSession(next)
    await db.sessions.put(next)
    busy.current = false
  }
  /** 처리 중이면 무시하고, 아니면 잠그고 실행 */
  const once = <A extends unknown[]>(f: (...a: A) => Promise<void>) => async (...a: A) => {
    if (busy.current) return
    busy.current = true
    try { await f(...a) } catch (e) { busy.current = false; throw e }
  }

  const goStep = async (step: Step, base: Session = session) => {
    const nst = { ...base.state, step, i: 0 }
    nst.queue = queueFor(step, nst)
    const next: Session = { ...base, state: nst }
    if (step === 'done' && doneStages(nst).size === STAGES.length) {
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
    if (nst.i >= nst.queue.length) await goStep(after(stage, st.step, nst), next)
    else await save(next)
  }

  const phase = (): Review['phase'] => (st.step.endsWith('review') ? 'review' : 'new')

  /** 예문 답 기록 + 복습 일정 갱신 (그날 첫 답만 일정에 반영) */
  const record = async (item: { id: string; unitId: string }, g: VocabGrade, r: Omit<Review, 'itemId' | 'itemType' | 'unitId' | 'date' | 'at' | 'phase'>, error?: ErrorType) => {
    const today = dayKey()
    await db.reviews.add({ ...r, itemId: item.id, itemType: 'sentence', unitId: item.unitId, date: today, at: Date.now(), phase: phase() })
    const prev = (await db.schedules.get(item.id)) ?? newSched(item.id, 'sentence', item.unitId, today)
    await db.schedules.put(review(prev, g, today, error, r.correct))
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
    const cs = v.unitId === unitId && day ? day.cards : units.get(v.unitId)?.data.cards ?? []
    return cs.flatMap(c => c.blocks).find(b => b.t === 'ex' && b.ja.includes(v.ja)) as { ja: string; ko: string } | undefined
  }
  const isDue = (id: string) => (st.dueS ?? []).includes(id)
  const dueTag = (id: string) => reviewOnly ? '오답' : isDue(id) && !st.wrongS.includes(id) ? '복습 예정' : undefined
  const done = doneStages(st)
  const skip = <><div className="card">이 항목은 콘텐츠를 다시 가져오면서 없어졌어요.</div><button className="btn primary wide big" onClick={() => advance({}, {})}>건너뛰기</button></>

  let body: JSX.Element

  let typing = false // 가나 직접 입력 화면 (키보드 유지)
  if (st.step === 'vocab' || st.step === 'vocab-review') {
    const v = vocabAll.find(x => x.id === st.queue[st.i])
    const sc = v && vSched?.get(v.id)
    const sch = !sc ? undefined : vocabState(sc) === 'learning' ? '학습 중' : '복습'
    // 준비마당(히라가나·가타카나) 가나 낱말은 직접 입력
    const kanaMode = !!v && /^c-2-/.test(v.unitId.slice(bookId.length + 1)) && /^[ぁ-ゟ゠-ヿー]+$/.test(v.ja)
    typing = kanaMode
    const onAnswer = once(async (know: boolean, ms: number) => {
      if (!v) return
        const now = Date.now(), today = dayKey(now)
        const isNew = st.step === 'vocab'
        await db.reviews.add({ itemId: v.id, itemType: 'vocab', unitId: v.unitId, date: today, at: now, phase: phase(), correct: know, grade: know ? 'good' : 'again', responseMs: ms })
        if (reviewOnly) { await advance({}, {}, !know); return } // 오답만 학습은 연습: 일정은 그대로, 모르면 뒤로 다시
        const prev = (await db.schedules.get(v.id)) ?? newSched(v.id, 'vocab', v.unitId, today)
        await db.schedules.put(ankiAnswer(prev, know, now))
        const dueV = dueVocab(await db.schedules.where('unitId').startsWith(`${bookId}/`).toArray(), now)
        const wrongV = isNew && !know && !st.wrongV.includes(v.id) ? [...st.wrongV, v.id] : st.wrongV
        const stats = isNew ? { vocab: session.stats.vocab + 1, vocabOk: session.stats.vocabOk + (know ? 1 : 0) } : {}
        if (isNew) { await advance({ dueV, wrongV }, stats); return }
        // 복습: 매번 지금 시각 기준으로 다음 단어를 고른다. 나올 단어가 없으면 단계 끝
        const next = { ...session, stats: { ...session.stats, ...stats }, state: { ...st, dueV, wrongV, queue: dueV, i: 0 } }
        if (dueV.length) await save(next)
        else await goStep('done', next)
      })
    const tag = st.step === 'vocab-review' ? sch : undefined
    // 가나 입력은 같은 KanaCard를 계속 써서 입력칸(=키보드)을 유지한다
    body = !v ? skip : kanaMode
      ? <KanaCard key="kana" n={`${st.step}-${st.i}-${v.id}`} v={v} tag={tag} onAnswer={onAnswer} />
      : <VocabCard key={v.id + st.i} v={v} example={exampleFor(v)} tag={tag} onAnswer={onAnswer} />
  } else if (st.step === 'vocab-intro') {
    body = <Intro title={`새 단어 ${queueFor('vocab', st).length}개 완료!`} wrong={st.wrongV.length} again={0} due={st.dueV?.length ?? 0}
      items={queueFor('vocab-review', st).map(id => vocabAll.find(v => v.id === id)?.ja ?? '')} onGo={() => goStep('vocab-review')} />
  } else if (st.step === 'grammar' && day && unit && st.queue[st.i]?.startsWith('q:')) {
    // 맛보기 연습 (문법 카드 사이)
    const s = sentAll.find(x => x.id === st.queue[st.i].slice(2))
    body = !s ? skip : (
      <SentenceCard s={s} review={false} readings={readings} words={words} onDone={once(async (g: Grade | null, answer: string, ms: number) => {
        const sg = sentenceGrade(g)
        await record(s, sg.grade, { correct: !!g?.ok, score: g?.score ?? 0, answer, responseMs: ms }, sg.error)
        await advance({}, {})
      })} />
    )
  } else if (st.step === 'grammar' && day && unit) {
    const c = cards.find(x => x.id === st.queue[st.i])
    const sMap = new Map(unitSent.map(s => [s.id.slice(unitId.length + 1), s]))
    body = !c ? skip : (
      <>
        <div className="grammar-scroll">
          <CardView c={c} sentences={sMap} offset={book.printedPageOffset} bookId={bookId} noQ />
        </div>
        <div className="row">
          <button className="btn" disabled={st.i === 0} onClick={() => save({ ...session, state: { ...st, i: st.i - 1 } })} aria-label="이전 카드">‹</button>
          <button className="btn grow primary big" onClick={once(async () => { await advance({}, { cards: session.stats.cards + 1 }) })}>
            {st.i + 1 < st.queue.length ? '다음 카드' : '문법 카드 완료'}
          </button>
        </div>
      </>
    )
  } else if (st.step === 'sentence' || st.step === 'sentence-review') {
    const s = sentAll.find(x => x.id === st.queue[st.i])
    const isReview = st.step === 'sentence-review'
    typing = !!s && s.src !== 'practice'
    body = !s ? skip : (
      <SentenceCard key={typing ? 'type' : s.id + st.i} n={`${st.step}-${st.i}-${s.id}`} s={s} review={isReview} readings={readings} words={words} tag={isReview ? (dueTag(s.id) === '복습 예정' ? '복습할 때가 된 문장이에요' : dueTag(s.id) === '오답' ? '예전에 틀린 문장이에요' : '아까 틀린 문장이에요. 다시 해 보세요') : undefined}
        onDone={once(async (g: Grade | null, answer: string, ms: number) => {
          const ok = !!g?.ok
          const sg = sentenceGrade(g)
          await record(s, sg.grade, { correct: ok, score: g?.score ?? 0, answer, responseMs: ms }, sg.error)
          if (!ok) await addRelated(s)
          const wrongS = !ok && st.step === 'sentence' && !st.wrongS.includes(s.id) ? [...st.wrongS, s.id] : st.wrongS
          await advance({ wrongS }, st.step === 'sentence' ? { sentences: session.stats.sentences + 1, sentencesOk: session.stats.sentencesOk + (ok ? 1 : 0) } : {})
        })} />
    )
  } else if (st.step === 'sentence-intro') {
    body = <Intro title={`새 예문 ${S.length}개 완료!`} wrong={st.wrongS.length} again={0} due={st.dueS?.length ?? 0}
      items={queueFor('sentence-review', st).map(id => sentAll.find(s => s.id === id)?.ko ?? '')} onGo={() => goStep('sentence-review')} />
  } else if (done.size < STAGES.length) {
    // 한 단계 끝: 다음 안 끝난 단계로 (오답만 학습은 위 effect가 바로 넘김)
    const next = [...STAGES.slice(STAGES.indexOf(stage) + 1), ...STAGES].find(x => !done.has(x))!
    body = (
      <>
        <div className="intro-check">✓</div>
        <div className="intro-title">{LABEL[stage]} 완료!</div>
        <div className="card list-card">
          {STAGES.map((x, n) => (
            <div key={x} className="item-row"><b className="grow">{n + 1} {LABEL[x]}</b><span className={done.has(x) ? 'accent-text' : 'muted small'}>{done.has(x) ? '✓ 완료' : '남음'}</span></div>
          ))}
        </div>
        <div className="grow" />
        <button className="btn primary wide big" onClick={() => save({ ...session, state: enter(next, st) })}>다음: {LABEL[next]}</button>
        <button className="btn ghost wide" onClick={() => go('/')}>홈으로</button>
      </>
    )
  } else {
    const { vocab, vocabOk, sentences, sentencesOk, cards: nCards } = session.stats
    const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '–')
    const rv = st.dueV?.length ?? 0, rs = (st.dueS?.length ?? 0) + st.wrongS.length
    body = (
      <>
        <div className="intro-check">✓</div>
        <div className="intro-title">{reviewOnly ? '오답 복습 완료!' : '오늘 학습 완료!'}</div>
        <div className="muted center">
          {reviewOnly ? '오답 노트' : `${unit?.data.title}${day?.title ? ` ${day.title}` : ''}`} · 실제 학습 {Math.max(1, Math.round(active.current / 60000))}분
        </div>
        <div className="card list-card">
          {!reviewOnly && <div className="item-row"><div className="grow"><b>1 단어 암기</b><div className="muted small">새 단어 {vocab}{rv ? ` · 곧 다시 나올 단어 ${rv}` : ''}</div></div><b className="accent-text">{pct(vocabOk, vocab)}</b></div>}
          {reviewOnly && <div className="item-row"><div className="grow"><b>오답 단어</b><div className="muted small">{rv}개 복습</div></div></div>}
          {!reviewOnly && <div className="item-row"><div className="grow"><b>2 문법 카드</b><div className="muted small">{nCards}장</div></div><b className="accent-text">완료</b></div>}
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
      <TopBar stage={stage} step={st.step} i={st.i} total={st.queue.length} done={done} review={reviewOnly} onClose={close} />
      <div className="step-anim" key={`${stage}-${st.step}-${typing ? 'kana' : st.i}`}>{body}</div>
    </div>
  )
}
