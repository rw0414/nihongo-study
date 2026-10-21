import { useEffect, useState } from 'react'

// 홈 화면 설치 안내. 이미 설치된 앱으로 열었으면 아무것도 안 보인다.
// 크롬은 설치 가능할 때 beforeinstallprompt를 보내 주므로 그걸 받아 두었다가 버튼으로 띄운다.
type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> }

let deferred: InstallEvent | undefined
addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e as InstallEvent })

const ua = navigator.userAgent
const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone
const inApp = /KAKAOTALK|NAVER|Instagram|FBAN|FBAV|Line\//i.test(ua) // 앱 안 브라우저는 설치 불가
const ios = /iPhone|iPad/i.test(ua)

export default function InstallCard() {
  const [canPrompt, setCanPrompt] = useState(!!deferred)
  const [installed, setInstalled] = useState(false)
  useEffect(() => {
    const on = (e: Event) => { e.preventDefault(); deferred = e as InstallEvent; setCanPrompt(true) }
    const done = () => setInstalled(true)
    addEventListener('beforeinstallprompt', on)
    addEventListener('appinstalled', done)
    return () => { removeEventListener('beforeinstallprompt', on); removeEventListener('appinstalled', done) }
  }, [])

  if (standalone || installed) return null

  return (
    <div className="card col install-card">
      <div className="book-title">📲 폰에 앱으로 설치하기</div>
      {inApp ? (
        <p className="small" style={{ margin: 0 }}>
          지금은 <b>카카오톡 등 앱 안의 브라우저</b>라서 설치가 안 돼요. 오른쪽 아래(또는 위) <b>⋮ → 다른 브라우저로 열기 → Chrome</b>으로 열어 주세요.
        </p>
      ) : canPrompt ? (
        <button className="btn primary" onClick={async () => { await deferred?.prompt(); deferred = undefined; setCanPrompt(false) }}>홈 화면에 설치</button>
      ) : ios ? (
        <p className="small" style={{ margin: 0 }}>Safari 아래쪽 <b>공유 버튼 → 홈 화면에 추가</b>를 눌러 주세요.</p>
      ) : (
        <p className="small" style={{ margin: 0 }}>
          크롬 오른쪽 위 <b>⋮ → 홈 화면에 추가</b>(또는 <b>앱 설치</b>)를 눌러 주세요. 삼성 인터넷은 <b>≡ → 현재 페이지 추가 → 홈 화면</b>이에요.
        </p>
      )}
      <p className="muted small" style={{ margin: 0 }}>설치하면 주소창 없이 앱처럼 열리고, 인터넷이 없어도 공부할 수 있어요.</p>
    </div>
  )
}
