// 후리가나 (Phase 5). 교재 안에 이미 있는 읽기만 쓴다 (지어내지 않음):
//  1) 본문에 적힌 '辞書[じしょ]' 같은 표기  2) 문장과 그 가나 읽기 쌍(예문·정답·단어)을 맞춰 얻은 한자 단어별 읽기
// 같은 한자라도 읽기가 여러 개면(時 とき/じ, 何 なに/なん) 앞뒤 글자가 같은 쓰임의 읽기를 고른다.
// 숫자+조수사(4時, 3人)는 규칙으로 읽는다. 확실하지 않으면 틀린 읽기를 다느니 후리가나를 달지 않는다.

export type Seg = { t: string; r?: string }

const RUN = /(?:[0-9０-９]{1,3}(?:[,，][0-9０-９]{3})+|[一-鿿々ヶヵ0-9０-９])+/g // 한자 덩어리 (숫자·ヶ 포함: 4時, 2ヶ月, 5,000万円)
const isKanji = (c: string) => /[一-鿿々]/.test(c)
const hasKanji = (s: string) => /[一-鿿々]/.test(s)
const isRunChar = (c: string) => /[一-鿿々ヶヵ0-9０-９]/.test(c)
const PUNCT = /[\s、。，．,.!！?？「」『』・〜~（）()]/g
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 한자 섞인 문장과 그 전체 읽기를 맞춰 한자 덩어리마다 읽기를 붙인다. 맞지 않으면 통째로 반환 */
export function align(ja: string, kana: string): Seg[] {
  const parts = ja.match(new RegExp(`${RUN.source}|[^一-鿿々ヶヵ0-9０-９]+`, 'g')) ?? []
  if (!parts.some(hasKanji)) return [{ t: ja }]
  // 문장부호·띄어쓰기는 읽기와 다를 수 있어 빼고 맞춘다. 단, 빼고 나서 한자 덩어리끼리 붙으면 경계를 알 수 없음
  const lit = parts.map(p => (isRunChar(p[0]) ? null : p.replace(PUNCT, '')))
  if (lit.some((l, i) => l === '' && lit[i - 1] === null && lit[i + 1] === null)) return [{ t: ja }]
  const body = (g: string) => '^' + lit.map(l => (l === null ? g : esc(l))).join('') + '$'
  const k = kana.replace(PUNCT, '')
  const m = k.match(new RegExp(body('(.+?)'), 'u')), m2 = k.match(new RegExp(body('(.+)'), 'u'))
  // 짧게 잡든 길게 잡든 같아야 확실 (母は ははは 처럼 경계가 둘 이상이면 맞추지 않음)
  if (!m || !m2 || m.some((x, i) => x !== m2[i])) return [{ t: ja }]
  let g = 1
  return parts.map(p => {
    if (!isRunChar(p[0])) return { t: p }
    const r = m[g++]
    return hasKanji(p) ? { t: p, r } : { t: p } // 숫자만이면 후리가나 없음
  })
}

/** '漢字[かな]' 표기. 읽기는 괄호 앞 낱말 전체의 읽기일 수 있다 (お店[おみせ], 有名な人[ゆうめいなひと], 1本[いっぽん]) */
const BRACKET = /([ぁ-ゟ゠-ヿ一-鿿々0-9０-９]*[一-鿿々][ぁ-ゟ]*)\[([ぁ-ゟ゠-ヿ\s]+)\]/g // お孫さん[おまごさん]처럼 끝이 가나여도
/** 괄호 앞 글자들 중 읽기와 맞는 가장 긴 끝부분 (それは有名な人[ゆうめいなひと] → 有名な人) */
function bracketWord(word: string, r: string): { skip: string; segs: Seg[] } {
  for (let i = 0; i < word.length; i++) {
    const w = word.slice(i)
    if (!hasKanji(w)) break
    // 시작은 한자·숫자, 또는 한자 앞의 お·ご (渋い色[いろ]를 い色=いろ로 잘못 맞추지 않게)
    if (!isRunChar(w[0]) && !(/^[おご]/.test(w) && isRunChar(w[1] ?? ''))) continue
    // 건너뛴 앞부분이 가나이고 읽기도 그걸로 시작하면 읽기에서도 뺀다 (ながら歩き[ながらあるき] → 歩き/あるき)
    const skip = word.slice(0, i)
    const al = align(w, skip && r.startsWith(skip) ? r.slice(skip.length) : r)
    if (al.some(x => x.r)) return { skip, segs: al }
  }
  return { skip: '', segs: [{ t: word }] }
}
export function bracketPairs(text: string): [string, string][] {
  return [...text.matchAll(BRACKET)].flatMap(m => {
    const r0 = m[2].replace(/\s/g, ''), { skip } = bracketWord(m[1], r0), w = m[1].slice(skip.length)
    const r = skip && r0.startsWith(skip) ? r0.slice(skip.length) : r0
    // 괄호 뒤 오쿠리가나도 붙여 둔다 (上手[うま]い → 上手い/うまい: 上手 じょうず와 구별)
    const after = text[m.index! + m[0].length] ?? ''
    const ok = /[ぁ-ゟ]/.test(after) ? after : ''
    return hasKanji(w) ? [[w + ok, r + ok] as [string, string]] : []
  })
}

/** 사전 항목: 읽기와 그 읽기가 나온 자리의 앞뒤 글자 */
interface Use { r: string; prev: string; next: string }
export type Dict = Map<string, Use[]>

/** (한자 섞인 표기, 읽기) 쌍들로 '한자 덩어리 → 쓰임별 읽기' 사전 */
export function buildDict(pairs: Iterable<[string, string]>): Dict {
  const dict: Dict = new Map()
  for (const [ja, kana] of pairs) {
    const segs = align(ja, kana)
    segs.forEach((s, i) => {
      if (!s.r) return
      const prev = segs[i - 1]?.t.slice(-1) ?? '', next = segs[i + 1]?.t[0] ?? ''
      const list = dict.get(s.t) ?? []
      if (!list.some(u => u.r === s.r && u.prev === prev && u.next === next)) list.push({ r: s.r, prev, next })
      dict.set(s.t, list)
    })
  }
  return dict
}

const HIRA = /[ぁ-ゟ]/
const PARTICLE = /^[はがをにでとへものやかねなだ]$/ // 명사 뒤에 오는 글자 (急な話, 大事だ)
// 훈독이 둘 이상이라 뒤 글자(오쿠리가나)가 같아야만 믿는 한자 (生きる/生まれる, 入る/入れる …)
const MANY = new Set([...'生上下入出行来開空明降着通落消足冷細苦辛重汚止留治直表現頼怒抜外分解割交混覚後'])
const kata = (c: string) => /[ァ-ヺー]/.test(c) // 가운뎃점(・)은 빼고
// 같은 오쿠리가나로 두 가지로 읽는 말 (開く あく/ひらく, 入る いる/はいる, 行く いく/ゆく) → 문장 읽기가 없으면 달지 않음
const AMBI = new Set(['開く', '開き', '空く', '空き', '入り', '降り', '上る', '下る', '止む', '生む'])

/**
 * 한자 덩어리 t의 쓰임에 맞는 읽기. 뒤 글자(오쿠리가나·조사)가 같은 쓰임 → 앞 글자가 같은(또는 같은 종류) 쓰임 순으로 좁히고,
 * 그래도 읽기가 갈리면 모름. 한 글자 한자 뒤에 활용 어미가 오면 그 한자가 활용형으로 쓰인 적이 있어야 하고,
 * 훈독이 여럿인 한자(MANY)는 같은 어미로 쓰인 적이 있어야 한다.
 */
export function pick(t: string, uses: Use[] | undefined, prev: string, next: string): string | undefined {
  if (!uses?.length) return
  if (AMBI.has(t + next)) { // 앞뒤 글자까지 똑같은 쓰임이 교재에 있을 때만
    const same = [...new Set(uses.filter(u => u.prev === prev && u.next === next).map(u => u.r))]
    return same.length === 1 ? same[0] : undefined
  }
  const single = [...t].length === 1
  const verbish = (u: Use) => HIRA.test(u.next) && !PARTICLE.test(u.next)
  // 조사가 아닌 히라가나 = 활용 어미일 수 있음. な・だ는 명사로 쓰인 적이 있는 한자에서만 조사로 본다 (見ない ↔ 急な話)
  // 조사가 아닌 히라가나 = 활용 어미일 수 있음. 조사 글자(か・な・と…)도 명사로 쓰인 적이 없는 한자 뒤에서는 활용 어미 (寒かった, 見ない ↔ 急な話)
  const noun = uses.some(u => !HIRA.test(u.next) || PARTICLE.test(u.next))
  const okuri = HIRA.test(next) && (!PARTICLE.test(next) || !noun)
  let pool = uses.filter(u => u.next === next)
  if (!pool.length) pool = okuri ? (single && MANY.has(t) ? [] : uses.filter(verbish)) : uses.filter(u => !verbish(u))
  if (!pool.length && !single) pool = uses
  // 한 글자이고 읽기가 여럿인 한자는 가타카나 뒤인지 아닌지가 같은 쓰임만 (アメリカ人たち じん / 人たち ひと)
  if (single && new Set(uses.map(u => u.r)).size > 1) pool = pool.filter(u => kata(u.prev) === kata(prev))
  if (new Set(pool.map(u => u.r)).size === 1) return pool[0].r
  // 앞 글자가 같은 쓰임, 없으면 가타카나 뒤인지(アメリカ人 じん / その人 ひと)로 좁힌다. 맞는 쓰임이 없으면 모름
  // 앞이 띄어쓰기·문장부호·처음이면 같은 자리에 홀로 쓰인 쓰임 (空, 口 → そら, くち)
  const alone = (c: string) => !/[ぁ-ゟ゠-ヿ一-鿿々]/.test(c)
  const byPrev = pool.filter(u => u.prev === prev), byAlone = alone(prev) ? pool.filter(u => alone(u.prev)) : []
  const byKata = pool.filter(u => kata(u.prev) === kata(prev))
  const best = byPrev.length ? byPrev : byAlone.length ? byAlone : byKata
  if (!best.length) return
  const rs = [...new Set(best.map(u => u.r))]
  if (rs.length === 1) return rs[0]
  // 같은 활용 어미로 쓰인 것끼리는 대부분(4분의 3 이상)이 같은 읽기면 그것
  if (okuri && best.every(u => u.next === next)) {
    const top = rs.map(r => [r, best.filter(u => u.r === r).length] as const).sort((a, b) => b[1] - a[1])[0]
    if (top[1] >= best.length * 0.75) return top[0]
  }
}

// ── 숫자 + 조수사 ──
const DIGIT = (s: string) => Number(s.normalize('NFKC'))
const N1 = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう']
function num(n: number): string {
  if (n >= 10000) return ''
  const th = Math.floor(n / 1000), h = Math.floor((n % 1000) / 100), t = Math.floor((n % 100) / 10), o = n % 10
  const TH = ['', 'せん', 'にせん', 'さんぜん', 'よんせん', 'ごせん', 'ろくせん', 'ななせん', 'はっせん', 'きゅうせん']
  const H = ['', 'ひゃく', 'にひゃく', 'さんびゃく', 'よんひゃく', 'ごひゃく', 'ろっぴゃく', 'ななひゃく', 'はっぴゃく', 'きゅうひゃく']
  return TH[th] + H[h] + (t ? (t === 1 ? '' : N1[t]) + 'じゅう' : '') + N1[o]
}
/** 마지막 자리에 따라 소리가 바뀌는 조수사 (1本 いっぽん, 3本 さんぼん) */
function sound(n: number, base: string, alt: Record<number, string>): string {
  const last = n % 10, head = num(n - last)
  const t = Math.floor((n % 100) / 10)
  if (t && last === 0 && alt[10]) return num(n - n % 100) + (t > 1 ? N1[t] : '') + alt[10] // 10, 30 …: じゅっぷん, さんじゅっぷん
  return last && alt[last] ? head + alt[last] : num(n) + base
}
/** 끝자리가 4·7·9일 때 읽기가 따로 있는 조수사 (4時 よじ, 14時 じゅうよじ) */
function last(n: number, base: string, alt: Record<number, string>): string {
  const d = n % 10
  return d && alt[d] ? num(n - d) + alt[d] : num(n) + base
}
const COUNTERS: Record<string, (n: number) => string> = {
  時: n => last(n, 'じ', { 4: 'よじ', 7: 'しちじ', 9: 'くじ' }),
  時半: n => last(n, 'じはん', { 4: 'よじはん', 7: 'しちじはん', 9: 'くじはん' }),
  時間: n => last(n, 'じかん', { 4: 'よじかん', 9: 'くじかん' }),
  分: n => sound(n, 'ふん', { 1: 'いっぷん', 3: 'さんぷん', 4: 'よんぷん', 6: 'ろっぷん', 8: 'はっぷん', 10: 'じゅっぷん' }),
  人: n => (n === 1 ? 'ひとり' : n === 2 ? 'ふたり' : last(n, 'にん', { 4: 'よにん' })),
  月: n => last(n, 'がつ', { 4: 'しがつ', 7: 'しちがつ', 9: 'くがつ' }),
  年: n => last(n, 'ねん', { 4: 'よねん' }),
  歳: n => sound(n, 'さい', { 1: 'いっさい', 8: 'はっさい', 10: 'じゅっさい' }),
  回: n => sound(n, 'かい', { 1: 'いっかい', 6: 'ろっかい', 8: 'はっかい', 10: 'じゅっかい' }),
  階: n => sound(n, 'かい', { 1: 'いっかい', 3: 'さんがい', 6: 'ろっかい', 8: 'はっかい', 10: 'じゅっかい' }),
  本: n => sound(n, 'ほん', { 1: 'いっぽん', 3: 'さんぼん', 6: 'ろっぽん', 8: 'はっぽん', 10: 'じゅっぽん' }),
  杯: n => sound(n, 'はい', { 1: 'いっぱい', 3: 'さんばい', 6: 'ろっぱい', 8: 'はっぱい', 10: 'じゅっぱい' }),
  匹: n => sound(n, 'ひき', { 1: 'いっぴき', 3: 'さんびき', 6: 'ろっぴき', 8: 'はっぴき', 10: 'じゅっぴき' }),
  冊: n => sound(n, 'さつ', { 1: 'いっさつ', 8: 'はっさつ', 10: 'じゅっさつ' }),
  個: n => sound(n, 'こ', { 1: 'いっこ', 6: 'ろっこ', 8: 'はっこ', 10: 'じゅっこ' }),
  枚: n => num(n) + 'まい',
  台: n => num(n) + 'だい',
  円: n => last(n, 'えん', { 4: 'よえん' }),
  度: n => num(n) + 'ど',
  番: n => num(n) + 'ばん',
  週間: n => sound(n, 'しゅうかん', { 1: 'いっしゅうかん', 8: 'はっしゅうかん', 10: 'じゅっしゅうかん' }),
  日: n => (['', '', 'ふつか', 'みっか', 'よっか', 'いつか', 'むいか', 'なのか', 'ようか', 'ここのか', 'とおか'][n] ?? (n === 14 ? 'じゅうよっか' : n === 20 ? 'はつか' : n === 24 ? 'にじゅうよっか' : num(n) + 'にち')),
  日間: n => (['', 'いちにちかん', 'ふつかかん', 'みっかかん', 'よっかかん', 'いつかかん', 'むいかかん', 'なのかかん', 'ようかかん', 'ここのかかん', 'とおかかん'][n] ?? num(n) + 'にちかん'),
  ヶ月: n => sound(n, 'かげつ', { 1: 'いっかげつ', 6: 'ろっかげつ', 8: 'はっかげつ', 10: 'じゅっかげつ' }),
  か月: n => sound(n, 'かげつ', { 1: 'いっかげつ', 6: 'ろっかげつ', 8: 'はっかげつ', 10: 'じゅっかげつ' }),
}
/** '4時', '10分' 처럼 숫자로 시작하는 덩어리의 읽기 */
function counter(run: string): string | undefined {
  const m = run.match(/^([0-9０-９,，]+)(.+)$/)
  if (!m) return
  const n = DIGIT(m[1].replace(/[,，]/g, ''))
  if (!(n > 0 && n < 10000)) return
  if (m[2] === '万' || m[2] === '万円') return num(n) + 'まん' + (m[2] === '万円' ? 'えん' : '') // 5,000万円 ごせんまんえん
  const f = COUNTERS[m[2]] as ((n: number) => string) | undefined
  return f ? f(n) || undefined : undefined
}

/** 한자 덩어리 하나를 사전으로 쪼개 읽기 붙이기 (긴 단어부터). prev/next = 덩어리 앞뒤 글자 */
function splitRun(run: string, dict: Dict, prev: string, next: string): Seg[] {
  const whole = pick(run, dict.get(run), prev, next) ?? counter(run) // 교재에 같은 쓰임이 있으면 그 읽기(4番バッター よばん), 없으면 규칙
  if (whole) return [{ t: run, r: whole }]
  const out: Seg[] = []
  const a = [...run]
  let i = 0
  while (i < a.length) {
    let hit = 0, r: string | undefined
    for (let n = a.length - i; n > 0; n--) {
      const t = a.slice(i, i + n).join('')
      // 모르는 복합어를 쪼갤 때 한 글자짜리는 따로 쓰일 때의 읽기와 다르기 쉬워서(日本人의 人) 쓰지 않는다.
      // 단, 맨 끝 글자 뒤에 활용 어미가 오면 동사·형용사 어간이라 같은 규칙으로 읽는다 (今度払う)
      const end = i + n === a.length
      const ok = n > 1 || (end && /[ぁ-ゟ]/.test(next) && !PARTICLE.test(next))
      r = (ok ? pick(t, dict.get(t), i ? a[i - 1] : prev, end ? next : a[i + n]) : undefined) ?? counter(t)
      if (r) { hit = n; break }
    }
    if (hit) { out.push({ t: a.slice(i, i + hit).join(''), r }); i += hit }
    else { out.push({ t: a[i] }); i++ }
  }
  return out
}

/** 화면에 그릴 조각들. 본문의 '[읽기]' 표기는 후리가나로 바꾸고 괄호는 지운다 */
export function rubySegments(text: string, dict: Dict, kana?: string): Seg[] {
  if (kana) {
    const al = align(text, kana)
    if (al.some(s => s.r)) return al
  }
  const out: Seg[] = []
  let last = 0
  const plain = (s: string, before: string, after: string) => {
    let j = 0
    for (const m of s.matchAll(RUN)) {
      if (m.index! > j) out.push({ t: s.slice(j, m.index) })
      const prev = m.index ? s[m.index - 1] : before, next = s[m.index! + m[0].length] ?? after
      if (hasKanji(m[0])) out.push(...splitRun(m[0], dict, prev, next))
      else out.push({ t: m[0] })
      j = m.index! + m[0].length
    }
    if (j < s.length) out.push({ t: s.slice(j) })
  }
  for (const m of text.matchAll(BRACKET)) {
    const { skip, segs } = bracketWord(m[1], m[2].replace(/\s/g, ''))
    plain(text.slice(last, m.index) + skip, text[last - 1] ?? '', m[1][skip.length])
    out.push(...segs)
    last = m.index! + m[0].length
  }
  plain(text.slice(last), text[last - 1] ?? '', '')
  return out.filter(s => s.t)
}
