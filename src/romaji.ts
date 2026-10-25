// 가나 → 쿼티 자판 입력 방법 (일본어 키보드의 로마자 입력). 준비마당 가나 입력 연습에서 정답과 함께 보여 준다.
const BASE: Record<string, string> = {
  あ: 'a', い: 'i', う: 'u', え: 'e', お: 'o', か: 'ka', き: 'ki', く: 'ku', け: 'ke', こ: 'ko', さ: 'sa', し: 'shi', す: 'su', せ: 'se', そ: 'so',
  た: 'ta', ち: 'chi', つ: 'tsu', て: 'te', と: 'to', な: 'na', に: 'ni', ぬ: 'nu', ね: 'ne', の: 'no', は: 'ha', ひ: 'hi', ふ: 'fu', へ: 'he', ほ: 'ho',
  ま: 'ma', み: 'mi', む: 'mu', め: 'me', も: 'mo', や: 'ya', ゆ: 'yu', よ: 'yo', ら: 'ra', り: 'ri', る: 'ru', れ: 're', ろ: 'ro', わ: 'wa', を: 'wo', ん: 'nn',
  が: 'ga', ぎ: 'gi', ぐ: 'gu', げ: 'ge', ご: 'go', ざ: 'za', じ: 'ji', ず: 'zu', ぜ: 'ze', ぞ: 'zo', だ: 'da', ぢ: 'di', づ: 'du', で: 'de', ど: 'do',
  ば: 'ba', び: 'bi', ぶ: 'bu', べ: 'be', ぼ: 'bo', ぱ: 'pa', ぴ: 'pi', ぷ: 'pu', ぺ: 'pe', ぽ: 'po',
  ぁ: 'xa', ぃ: 'xi', ぅ: 'xu', ぇ: 'xe', ぉ: 'xo', ゃ: 'xya', ゅ: 'xyu', ょ: 'xyo', っ: 'xtu', ゎ: 'xwa', ー: '-', ゔ: 'vu',
}
// 요음: 앞 글자의 자음 + y (きゃ kya, しゃ sha, ちゃ cha, じゃ ja)
const YOON: Record<string, string> = { し: 'sh', ち: 'ch', じ: 'j' }
const SMALL_Y: Record<string, string> = { ゃ: 'a', ゅ: 'u', ょ: 'o' }
const SMALL_V: Record<string, string> = { ぁ: 'a', ぃ: 'i', ぅ: 'u', ぇ: 'e', ぉ: 'o' }
const hira = (s: string) => s.replace(/[ァ-ヶ]/g, c => String.fromCharCode(c.charCodeAt(0) - 0x60))

/** 가나 낱말을 치는 순서 (예: がっこう → gakkou, きゃ → kya, ファ → fa) */
export function toRomaji(kana: string): string {
  const a = [...hira(kana)]
  let out = ''
  for (let i = 0; i < a.length; i++) {
    const c = a[i], n = a[i + 1]
    if (c === 'っ' && n) { // 작은 っ: 다음 자음을 두 번 (っち → tchi)
      const next = toRomaji(a.slice(i + 1).join(''))
      out += /^[a-z]/.test(next) && !/^[aiueon]/.test(next) ? (next.startsWith('ch') ? 't' : next[0]) : 'xtu'
      continue
    }
    if (n && SMALL_Y[n] && BASE[c] && c !== 'い') { // 요음
      out += (YOON[c] ?? BASE[c].slice(0, -1) + 'y') + SMALL_Y[n]
      i++
      continue
    }
    if (n && SMALL_V[n] && /[ふう゛ゔてで]/.test(c)) { // ファ fa, ウィ wi, ティ thi, ディ dhi
      out += (c === 'ふ' ? 'f' : c === 'う' ? 'w' : c === 'て' ? 'th' : c === 'で' ? 'dh' : 'v') + SMALL_V[n]
      i++
      continue
    }
    // ん 뒤에 모음·や행·な행이 오지 않으면 n 한 번으로도 되지만, 헷갈리지 않게 늘 nn
    out += BASE[c] ?? c
  }
  return out
}

/** 입력 방법 설명 한 줄 (자판 그대로 + 가타카나 변환 안내) */
export function typingHint(kana: string): string {
  const keys = toRomaji(kana)
  const kata = /[ァ-ヶ]/.test(kana)
  return `${keys.split('').join(' ')}${kata ? ' → 가타카나로 변환' : ''}`
}
