import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { getSettings } from './db'
import { backspace, feed, type ImeState } from './ime'
import { keyBuzz, keySound, type KeyKind } from './keySound'

// 앱 자체 일본어 쿼티 키보드 (폰 키보드를 띄우지 않음). 로마자로 치면 바로 가나로 바뀐다. 누를 때마다 소리·진동.
const ROWS = ['qwertyuiop', 'asdfghjkl', 'zxcvbnm']

/** 입력 중인 글자 표시 (아직 가나가 안 된 로마자는 밑줄) */
export function ImeDisplay({ ime, placeholder }: { ime: ImeState; placeholder?: string }) {
  const empty = !ime.text && !ime.buf
  return (
    <div className={`ime-display jp ${empty ? 'empty' : ''}`} aria-live="polite">
      {empty ? <span className="muted">{placeholder}</span> : <>{ime.text}<u>{ime.buf}</u></>}
      <span className="caret" />
    </div>
  )
}

export default function Keyboard({ ime, onChange, onEnter, kata: kataInit = false, enterLabel = '확인', canEnter = true }: {
  ime: ImeState; onChange: (s: ImeState) => void; onEnter: () => void; kata?: boolean; enterLabel?: string; canEnter?: boolean
}) {
  const st = useLiveQuery(getSettings)
  const [kata, setKata] = useState(kataInit)
  const [down, setDown] = useState<string>()
  const ref = useRef({ ime, kata, canEnter, onChange, onEnter, st })
  useEffect(() => { ref.current = { ime, kata, canEnter, onChange, onEnter, st } })
  const repeat = useRef<ReturnType<typeof setInterval>>()

  const press = (k: string) => {
    const { ime: s, kata: kt, canEnter: ok, st: conf } = ref.current
    const kind: KeyKind = k === 'del' ? 'delete' : k === 'enter' ? 'enter' : k === 'kana' ? 'space' : 'key'
    if (conf?.keySound !== false) keySound(kind)
    if (conf?.keyHaptic !== false) keyBuzz(kind === 'enter' ? 14 : 8)
    // 아주 빠르게 연달아 눌러도 글자가 빠지지 않게, 화면이 다시 그려지기 전에도 마지막 상태를 이어서 쓴다
    const set = (n: ImeState) => { ref.current.ime = n; ref.current.onChange(n) }
    if (k === 'del') set(backspace(s))
    else if (k === 'enter') { if (ok) ref.current.onEnter() }
    else if (k === 'kana') { ref.current.kata = !kt; setKata(!kt) }
    else set(feed(s, k, kt))
  }

  // PC 자판으로도 같은 키보드처럼
  useEffect(() => {
    const f = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return
      const k = e.key === 'Backspace' ? 'del' : e.key === 'Enter' ? 'enter' : /^[a-zA-Z,.-]$/.test(e.key) ? e.key.toLowerCase() : null
      if (!k) return
      e.preventDefault()
      setDown(k)
      setTimeout(() => setDown(undefined), 90)
      press(k)
    }
    addEventListener('keydown', f)
    return () => { removeEventListener('keydown', f); clearInterval(repeat.current) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const stop = () => { setDown(undefined); clearInterval(repeat.current) }
  const key = (k: string, label: string, cls = '') => (
    <button key={k} type="button" className={`kb-key ${cls} ${down === k ? 'down' : ''}`}
      onPointerDown={e => {
        e.preventDefault()
        setDown(k)
        press(k)
        if (k === 'del') { // 길게 누르면 계속 지우기
          clearInterval(repeat.current)
          const start = Date.now()
          repeat.current = setInterval(() => { if (Date.now() - start > 400) press('del') }, 70)
        }
      }}
      onPointerUp={stop} onPointerLeave={stop} onPointerCancel={stop}
      onContextMenu={e => e.preventDefault()}>
      {label}
    </button>
  )

  return (
    <div className="kb" role="group" aria-label="일본어 키보드">
      <div className="kb-row">{[...ROWS[0]].map(c => key(c, c))}</div>
      <div className="kb-row r2">{[...ROWS[1]].map(c => key(c, c))}</div>
      <div className="kb-row">
        {key('kana', kata ? 'ア' : 'あ', `kb-mod ${kata ? 'on' : ''}`)}
        {[...ROWS[2]].map(c => key(c, c))}
        {key('del', '⌫', 'kb-mod')}
      </div>
      <div className="kb-row">
        {key('-', 'ー', 'kb-mod')}
        {key(',', '、', 'kb-mod')}
        {key('.', '。', 'kb-mod')}
        {key('enter', enterLabel, `kb-enter ${canEnter ? '' : 'off'}`)}
      </div>
    </div>
  )
}
