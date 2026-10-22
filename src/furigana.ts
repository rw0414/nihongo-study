// 후리가나 (Phase 5). 교재 안에 이미 있는 읽기만 쓴다 (지어내지 않음):
//  1) 본문에 적힌 '辞書[じしょ]' 같은 표기  2) 문장과 그 가나 읽기 쌍(예문·정답·단어)을 맞춰 얻은 한자 단어별 읽기
// 모르는 한자는 사전에서 가장 긴 단어부터 맞춰 보고, 그래도 없으면 후리가나 없이 둔다.

export type Seg = { t: string; r?: string }

const KANJI_RUN = /[一-鿿々]+/g
const isKanji = (c: string) => /[一-鿿々]/.test(c)
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 한자 섞인 문장과 그 전체 읽기를 맞춰 한자 덩어리마다 읽기를 붙인다. 맞지 않으면 통째로 반환 */
export function align(ja: string, kana: string): Seg[] {
  const parts = ja.match(/[一-鿿々]+|[^一-鿿々]+/g) ?? []
  if (!parts.some(p => isKanji(p[0]))) return [{ t: ja }]
  const re = new RegExp('^' + parts.map(p => (isKanji(p[0]) ? '(.+?)' : esc(p))).join('') + '$', 'u')
  const m = kana.match(re)
  if (!m) return [{ t: ja }]
  let g = 1
  return parts.map(p => (isKanji(p[0]) ? { t: p, r: m[g++] } : { t: p }))
}

/** '漢字[かな]' 표기를 찾아 쌍으로 */
const BRACKET = /([一-鿿々]+)\[([ぁ-ゟ゠-ヿ\s]+)\]/g
export function bracketPairs(text: string): [string, string][] {
  return [...text.matchAll(BRACKET)].map(m => [m[1], m[2].replace(/\s/g, '')])
}

/** (한자 섞인 표기, 읽기) 쌍들로 '한자 덩어리 → 읽기' 사전을 만든다. 먼저 나온 읽기 우선 */
export function buildDict(pairs: Iterable<[string, string]>): Map<string, string> {
  const dict = new Map<string, string>()
  for (const [ja, kana] of pairs)
    for (const s of align(ja, kana)) if (s.r && !dict.has(s.t)) dict.set(s.t, s.r)
  return dict
}

/** 한자 덩어리 하나를 사전으로 쪼개 읽기 붙이기 (긴 단어부터) */
function splitRun(run: string, dict: Map<string, string>): Seg[] {
  if (dict.has(run)) return [{ t: run, r: dict.get(run) }]
  const out: Seg[] = []
  let i = 0
  const a = [...run]
  while (i < a.length) {
    let hit = 0
    for (let n = a.length - i; n > 0; n--) if (dict.has(a.slice(i, i + n).join(''))) { hit = n; break }
    if (hit) { const t = a.slice(i, i + hit).join(''); out.push({ t, r: dict.get(t) }); i += hit }
    else { out.push({ t: a[i] }); i++ }
  }
  return out
}

/** 화면에 그릴 조각들. 본문의 '[읽기]' 표기는 후리가나로 바꾸고 괄호는 지운다 */
export function rubySegments(text: string, dict: Map<string, string>, kana?: string): Seg[] {
  if (kana) {
    const al = align(text, kana)
    if (al.length > 1 || al[0].r) return al
  }
  const out: Seg[] = []
  let last = 0
  const plain = (s: string) => {
    let j = 0
    for (const m of s.matchAll(KANJI_RUN)) {
      if (m.index! > j) out.push({ t: s.slice(j, m.index) })
      out.push(...splitRun(m[0], dict))
      j = m.index! + m[0].length
    }
    if (j < s.length) out.push({ t: s.slice(j) })
  }
  for (const m of text.matchAll(BRACKET)) {
    plain(text.slice(last, m.index))
    out.push({ t: m[1], r: m[2].replace(/\s/g, '') })
    last = m.index! + m[0].length
  }
  plain(text.slice(last))
  return out
}
