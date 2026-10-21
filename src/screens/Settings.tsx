import { useEffect, useRef, useState } from 'react'
import { applyTheme } from '../App'
import { makeBackup, readBackup, restoreBackup } from '../backup'

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
      <BackupCard />
      <div className="card soon">
        <p className="muted small">일일 목표 · 복습 · 글자 크기 · 음성 · AI 채점 설정은 해당 기능과 함께 추가됩니다.</p>
      </div>
    </>
  )
}

// 백업/복구. 마지막 백업 날짜는 이 기기 브라우저에만 기억한다 (알림용)
function BackupCard() {
  const [last, setLast] = useState(() => { try { return localStorage.getItem('lastBackup') } catch { return null } })
  const [pending, setPending] = useState<Awaited<ReturnType<typeof readBackup>>>()
  const [msg, setMsg] = useState<{ ok: boolean; text: string }>()
  const [busy, setBusy] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const daysAgo = last ? Math.floor((Date.now() - new Date(last).getTime()) / 86400000) : undefined

  async function save() {
    const { blob, name } = await makeBackup()
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 10000)
    const now = new Date().toISOString()
    try { localStorage.setItem('lastBackup', now) } catch { /* 저장 못 해도 백업 파일은 이미 만들어짐 */ }
    setLast(now)
    setMsg({ ok: true, text: `백업 파일(${Math.round(blob.size / 1024)}KB)을 저장했어요. 구글 드라이브나 원드라이브에도 올려 두면 더 안전해요.` })
  }

  async function pick(f?: File) {
    if (!f) return
    setMsg(undefined)
    try { setPending(await readBackup(f)) } catch (e) { setMsg({ ok: false, text: (e as Error).message }) }
    if (input.current) input.current.value = ''
  }

  async function restore() {
    if (!pending) return
    setBusy(true)
    try { await restoreBackup(pending.tables) } catch (e) { setBusy(false); setMsg({ ok: false, text: `복구 실패 (기존 데이터는 그대로예요): ${(e as Error).message}` }); return }
    setBusy(false)
    setPending(undefined)
    setMsg({ ok: true, text: '복구했어요. 원본 페이지가 안 보이면 라이브러리에서 같은 교재 파일(.zip)을 다시 추가해 주세요.' })
  }

  return (
    <div className="card col">
      <div className="book-title">백업 / 복구</div>
      <p className="muted small" style={{ margin: 0 }}>
        학습 기록·진도·단원 콘텐츠·직접 고친 내용을 파일 하나로 저장해요. 교재 이미지는 들어가지 않아요(교재 파일로 다시 추가).
        <br />마지막 백업: {daysAgo === undefined ? '없음' : daysAgo === 0 ? '오늘' : `${daysAgo}일 전`}
        {(daysAgo === undefined || daysAgo >= 7) && <b className="warn-text"> · 백업을 권장해요</b>}
      </p>
      <button className="btn primary" onClick={save}>백업 파일 만들기</button>
      <button className="btn" onClick={() => input.current?.click()}>백업 파일로 복구</button>
      <input ref={input} type="file" accept=".json,application/json" hidden onChange={e => pick(e.target.files?.[0])} />
      {pending && (
        <div className="blk-note">
          {pending.info.at.slice(0, 10)} 백업 · 교재 {pending.info.counts.books}권 · 단원 {pending.info.counts.units}개 · 학습 기록 {pending.info.counts.reviews}개
          <br />지금 이 기기의 기록은 이 백업 내용으로 <b>바뀝니다</b>.
          <div className="row" style={{ marginTop: 8 }}>
            <button className="btn grow" disabled={busy} onClick={() => setPending(undefined)}>취소</button>
            <button className="btn danger grow" disabled={busy} onClick={restore}>{busy ? '복구 중… 잠시만요' : '복구하기'}</button>
          </div>
        </div>
      )}
      {msg && <p className={msg.ok ? 'ok' : 'error'}>{msg.text}</p>}
    </div>
  )
}
