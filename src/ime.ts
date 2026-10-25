// 앱 키보드용 로마자 → 가나 변환 (일본어 키보드의 로마자 입력과 같은 규칙)
const V = 'aiueo'
const ROWS: [string, string][] = [
  ['', 'あいうえお'], ['k', 'かきくけこ'], ['s', 'さしすせそ'], ['t', 'たちつてと'], ['n', 'なにぬねの'], ['h', 'はひふへほ'], ['m', 'まみむめも'],
  ['r', 'らりるれろ'], ['g', 'がぎぐげご'], ['z', 'ざじずぜぞ'], ['d', 'だぢづでど'], ['b', 'ばびぶべぼ'], ['p', 'ぱぴぷぺぽ'], ['x', 'ぁぃぅぇぉ'], ['l', 'ぁぃぅぇぉ'],
]
const TABLE: Record<string, string> = {}
for (const [c, ks] of ROWS) [...ks].forEach((k, i) => { TABLE[c + V[i]] = k })
Object.assign(TABLE, {
  ya: 'や', yu: 'ゆ', yo: 'よ', wa: 'わ', wo: 'を', nn: 'ん', "n'": 'ん', '-': 'ー', ',': '、', '.': '。', '?': '？', '!': '！',
  shi: 'し', chi: 'ち', tsu: 'つ', fu: 'ふ', ji: 'じ', vu: 'ゔ',
  xya: 'ゃ', xyu: 'ゅ', xyo: 'ょ', lya: 'ゃ', lyu: 'ゅ', lyo: 'ょ', xtu: 'っ', ltu: 'っ', xtsu: 'っ', xwa: 'ゎ',
  fa: 'ふぁ', fi: 'ふぃ', fe: 'ふぇ', fo: 'ふぉ', wi: 'うぃ', we: 'うぇ', thi: 'てぃ', dhi: 'でぃ', ye: 'いぇ',
})
// 요음: きゃ kya, しゃ sha/sya, ちゃ cha/tya/cya, じゃ ja/jya/zya
const YOON: [string[], string][] = [
  [['ky'], 'き'], [['sh', 'sy'], 'し'], [['ch', 'ty', 'cy'], 'ち'], [['ny'], 'に'], [['hy'], 'ひ'], [['my'], 'み'], [['ry'], 'り'],
  [['gy'], 'ぎ'], [['j', 'jy', 'zy'], 'じ'], [['dy'], 'ぢ'], [['by'], 'び'], [['py'], 'ぴ'],
]
for (const [heads, k] of YOON) for (const h of heads) { TABLE[h + 'a'] = k + 'ゃ'; TABLE[h + 'u'] = k + 'ゅ'; TABLE[h + 'o'] = k + 'ょ'; if (h === 'j' || h === 'sh' || h === 'ch') TABLE[h + 'e'] = k + 'ぇ' }
const KEYS = Object.keys(TABLE)

export const toKata = (s: string) => s.replace(/[ぁ-ゖ]/g, c => String.fromCharCode(c.charCodeAt(0) + 0x60))

export interface ImeState { text: string; buf: string } // buf = 아직 가나가 되지 않은 로마자

/** 키 하나 입력 */
export function feed(s: ImeState, key: string, kata = false): ImeState {
  let text = s.text, buf = s.buf + key.toLowerCase()
  const out = (k: string) => { text += kata ? toKata(k) : k }
  for (;;) {
    if (TABLE[buf]) { out(TABLE[buf]); buf = ''; break }
    // 같은 자음 두 번 = 작은 っ (kka → っか)
    if (buf.length >= 2 && ((buf[0] === buf[1] && !'aiueon'.includes(buf[0]) && /[a-z]/.test(buf[0])) || buf.startsWith('tc'))) { out('っ'); buf = buf.slice(1); continue } // matcha
    // n 뒤에 모음·y·n이 아닌 글자 = ん (kanji → かんじ)
    if (buf.length >= 2 && buf[0] === 'n' && !"aiueoyn'".includes(buf[1])) { out('ん'); buf = buf.slice(1); continue }
    if (!buf || KEYS.some(k => k.startsWith(buf))) break
    // 어떤 가나도 될 수 없는 글자는 그대로 둔다
    text += buf[0]
    buf = buf.slice(1)
  }
  return { text, buf }
}

/** 확인할 때 남은 로마자 정리 (끝의 n = ん) */
export function flush(s: ImeState, kata = false): string {
  if (s.buf === 'n') return s.text + (kata ? 'ン' : 'ん')
  return s.text + s.buf
}

/** 지우기: 덜 친 로마자부터, 없으면 마지막 글자 */
export const backspace = (s: ImeState): ImeState => (s.buf ? { ...s, buf: s.buf.slice(0, -1) } : { text: [...s.text].slice(0, -1).join(''), buf: '' })
