import { createContext, useContext, type ReactNode } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, getSettings } from './db'
import { bracketPairs, buildDict, rubySegments, type Dict } from './furigana'
import { EXTRA_READINGS } from './readings'

// 앱 전체 후리가나. 교재 콘텐츠(단어 읽기·예문 읽기·본문의 [읽기] 표기)로 사전을 만들어 공유한다.
const Ctx = createContext<{ dict: Dict; on: boolean }>({ dict: new Map(), on: true })

async function load() {
  const [vocab, sents, units, st] = await Promise.all([db.vocab.toArray(), db.sentences.toArray(), db.units.toArray(), getSettings()])
  const pairs: [string, string][] = []
  for (const v of vocab) if (v.reading && v.reading !== v.ja) pairs.push([v.ja, v.reading])
  for (const s of sents) [...s.answers, ...(s.alts ?? [])].forEach((a, i) => s.kana?.[i] && pairs.push([a, s.kana[i]]))
  for (const u of units)
    for (const c of u.data.cards)
      for (const b of c.blocks) {
        if (b.t === 'ex' && b.kana) pairs.push([b.ja, b.kana])
        if ('text' in b) pairs.push(...bracketPairs(b.text))
        if (b.t === 'ex' && b.ruby) pairs.push(...bracketPairs(b.ruby))
      }
  return { dict: buildDict([...pairs, ...EXTRA_READINGS]), on: st.furigana }
}

export function FuriganaProvider({ children }: { children: ReactNode }) {
  const v = useLiveQuery(load)
  return <Ctx.Provider value={v ?? { dict: new Map(), on: true }}>{children}</Ctx.Provider>
}

/** 일본어(또는 한자가 섞인) 글자에 후리가나를 붙여 그린다. kana를 주면 그 읽기를 우선 사용, hl은 굵게 강조할 부분(마지막 것) */
export function Ja({ text, kana, force, hl }: { text: string; kana?: string; force?: boolean; hl?: string }) {
  const { dict, on } = useContext(Ctx)
  if (!on && !force) return <>{text.replace(/\[[ぁ-ヿ\s]+\]/g, '')}</>
  const from = hl ? text.lastIndexOf(hl) : -1, to = from + (hl?.length ?? 0)
  let at = 0
  return (
    <>
      {rubySegments(text, dict, kana).map((s, i) => {
        const start = at
        at += s.t.length
        const el = s.r ? <ruby key={i}>{s.t}<rt>{s.r}</rt></ruby> : <span key={i}>{s.t}</span>
        if (from < 0 || at <= from || start >= to) return el
        if (s.r || (start >= from && at <= to)) return <b key={i} className="hl">{el}</b>
        // 강조가 글자 덩어리 중간에서 시작·끝나면 그 부분만
        const a = Math.max(from, start) - start, b = Math.min(to, at) - start
        return <span key={i}>{s.t.slice(0, a)}<b className="hl">{s.t.slice(a, b)}</b>{s.t.slice(b)}</span>
      })}
    </>
  )
}
