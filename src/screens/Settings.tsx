import { useEffect, useState } from 'react'
import { applyTheme } from '../App'

const mb = (n = 0) => `${Math.round(n / 2 ** 20)} MB`

export default function Settings() {
  const [theme, setTheme] = useState(localStorage.getItem('theme') ?? 'system')
  const [usage, setUsage] = useState<StorageEstimate>()
  const [persisted, setPersisted] = useState<boolean>()

  useEffect(() => {
    navigator.storage?.estimate?.().then(setUsage)
    navigator.storage?.persisted?.().then(setPersisted)
  }, [])

  function changeTheme(t: string) {
    setTheme(t)
    localStorage.setItem('theme', t)
    applyTheme()
  }

  return (
    <>
      <h1>설정</h1>
      <div className="card">
        <div className="book-title">테마</div>
        <div className="seg">
          {[['system', '시스템'], ['light', '밝게'], ['dark', '어둡게']].map(([v, l]) => (
            <button key={v} className={theme === v ? 'on' : ''} onClick={() => changeTheme(v)}>{l}</button>
          ))}
        </div>
      </div>
      <div className="card">
        <div className="book-title">저장 공간</div>
        <p className="muted small">
          사용 중 {mb(usage?.usage)} / 사용 가능 {mb(usage?.quota)}<br />
          {persisted ? '✓ 영구 저장: 브라우저가 데이터를 임의로 지우지 않습니다.' : '영구 저장 미설정 (교재를 추가하면 자동 요청)'}
        </p>
      </div>
      <div className="card soon">
        <p className="muted small">일일 목표 · 복습 · 글자 크기 · 음성 · 백업/복구 · AI 채점 설정은 해당 기능과 함께 추가됩니다.</p>
      </div>
    </>
  )
}
