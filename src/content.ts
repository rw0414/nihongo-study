// 단원 콘텐츠(Phase 2) 형식과 검증. Claude Code가 원문을 읽어 만든 JSON을 앱이 가져온다.
// 형식 예: books/<bookId>/content/<chapterId>.json

export type Block =
  | { t: 'p' | 'h' | 'note' | 'ja' | 'ko' | 'words' | 'box'; text: string; page?: number }
  | { t: 'formula'; left: string; right: string; rightSub?: string; crossed?: boolean }
  | { t: 'ex'; ja: string; ko: string; hl?: string; ruby?: string; kana?: string } // kana: AI가 붙인 읽기
  | { t: 'teacher'; text: string } // AI 선생님 노트 (교재 원문 아님)
  | { t: 'key'; text: string } // AI 핵심 한 줄 (원문 설명은 그대로 두고 위에 덧붙임)
  | { t: 'table'; rows: string[][] }
  | { t: 'q'; ref: string }

export interface Card {
  id: string
  kind: 'intro' | 'grammar' | 'practice' | 'summary' | 'drill' | 'reading' | 'tip' | 'teacher' // teacher = AI가 만든 카드
  page: number
  title: string
  sub?: string
  grammar?: string
  audio?: string
  blocks: Block[]
}

export interface Grammar { id: string; no: number; pattern: string; meaning: string; page: number }

export interface UnitContent {
  format: 1
  bookId: string
  chapterId: string // 패키지 목차 id (예: c-3-1-1)
  title: string
  pages: [number, number]
  audio?: { name: string; label: string; page: number }[]
  grammar: Grammar[]
  cards: Card[]
  sentences: RawSentence[]
  vocab: RawVocab[]
  // 긴 단원을 하루 분량으로 나눈 것. 없으면 단원 전체가 하루 분량. 모든 카드는 정확히 한 part에 속한다.
  parts?: { id: string; title: string; cards: string[] }[]
  // AI 선생님 검토 기록: 원문 대조·일본어 검토를 마치면 채운다
  review?: { by: 'ai-teacher'; at: string; fixes: string[] }
}

export interface RawSentence {
  id: string
  src: 'example' | 'practice' | 'drill'
  grammar: string[]
  page: number
  ko: string
  given?: string
  hint?: string
  answers: string[] // 교재 정답 (answerBy가 'teacher'면 선생님이 작성한 정답)
  answerBy?: 'teacher' // 교재 정답 페이지가 스캔에 없어서 선생님이 작성한 경우
  alts?: string[] // AI가 추가한 허용 답안 (교재 원문 아님)
  kana?: string[] // AI가 붙인 가나 읽기. 한자 대신 가나로 입력해도 정답 처리
}

export interface RawVocab {
  id: string
  ja: string
  reading: string
  ko: string
  page?: number
  origin: 'list' | 'text' | 'ai' // 교재 단어 목록 / 교재 본문·해설 / AI 제안
  why?: string
}

const ORIGINS = ['list', 'text', 'ai']
// 히라가나·가타카나·장음·문장부호·공백만 허용
const KANA = /^[぀-ヿ　-〿！-／\s.,!?~]+$/

/** 가져오기 전 전체 검증. 하나라도 틀리면 아무것도 저장하지 않는다. */
export function parseUnit(json: unknown): UnitContent {
  const u = json as UnitContent
  const fail = (msg: string): never => { throw new Error(`콘텐츠 파일 오류 (${u?.chapterId ?? '?'}): ${msg}`) }
  if (!u || u.format !== 1) fail('형식(format)이 1이 아닙니다')
  if (!u.bookId || !u.chapterId) fail('교재/단원 ID가 없습니다')
  for (const k of ['grammar', 'cards', 'sentences', 'vocab'] as const) if (!Array.isArray(u[k])) fail(`${k} 목록이 없습니다`)

  const unique = (ids: string[], what: string) => {
    const seen = new Set<string>()
    for (const id of ids) { if (seen.has(id)) fail(`${what} id 중복: ${id}`); seen.add(id) }
    return seen
  }
  const g = unique(u.grammar.map(x => x.id), '문법')
  const s = unique(u.sentences.map(x => x.id), '예문')
  unique(u.vocab.map(x => x.id), '단어')
  unique(u.cards.map(x => x.id), '카드')

  for (const c of u.cards)
    for (const b of c.blocks) if (b.t === 'q' && !s.has(b.ref)) fail(`카드 ${c.id}가 없는 예문 ${b.ref}를 가리킵니다`)
  if (u.parts) {
    const inParts = u.parts.flatMap(p => p.cards)
    const cardIds = u.cards.map(c => c.id)
    if (inParts.length !== cardIds.length || cardIds.some(id => !inParts.includes(id)))
      fail('parts에 모든 카드가 정확히 한 번씩 들어가야 합니다')
  }
  for (const x of u.sentences) {
    if (!x.ko || !x.answers?.length) fail(`예문 ${x.id}에 문제나 정답이 없습니다`)
    for (const k of x.kana ?? []) if (!KANA.test(k)) fail(`예문 ${x.id}의 가나 읽기에 한자나 다른 문자가 섞여 있습니다: ${k}`)
    for (const id of x.grammar) if (!g.has(id)) fail(`예문 ${x.id}가 없는 문법 ${id}를 가리킵니다`)
  }
  for (const v of u.vocab) {
    if (!v.ja || !v.ko) fail(`단어 ${v.id}에 표기나 뜻이 없습니다`)
    if (!ORIGINS.includes(v.origin)) fail(`단어 ${v.id}의 출처(origin)가 올바르지 않습니다`)
  }
  return u
}
