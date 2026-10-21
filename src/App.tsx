import { useEffect, useState } from 'react'
import Home from './screens/Home'
import Library from './screens/Library'
import BookDetail from './screens/BookDetail'
import Reader from './screens/Reader'
import Settings from './screens/Settings'
import UnitScreen from './screens/Unit'

// 주소 뒤 #/... 로 화면을 구분하는 간단한 라우터 (뒤로가기 버튼이 그대로 동작)
export const go = (path: string) => { location.hash = path }

function useRoute() {
  const [hash, setHash] = useState(location.hash)
  useEffect(() => {
    const f = () => setHash(location.hash)
    addEventListener('hashchange', f)
    return () => removeEventListener('hashchange', f)
  }, [])
  return (hash.slice(1) || '/').split('/').filter(Boolean)
}

export function applyTheme() {
  const t = localStorage.getItem('theme')
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t
  else delete document.documentElement.dataset.theme
}
applyTheme()

// 학습·통계 탭은 해당 기능(Phase 3~5)과 함께 추가
const TABS = [
  { path: '/', label: '홈', icon: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z' },
  { path: '/library', label: '라이브러리', icon: 'M4 4h4v16H4zM10 4h4v16h-4zM16 5.5l3.5-1 3 15-3.5 1z' },
  { path: '/settings', label: '설정', icon: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9 7 7M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1' },
]

export default function App() {
  const [screen, a, b] = useRoute()

  // 읽기 화면은 탭 바 없이 전체 화면
  if (screen === 'read' && a) return <Reader bookId={a} page={Number(b) || 1} />

  const page =
    screen === 'library' ? <Library /> :
    screen === 'book' && a ? <BookDetail bookId={a} /> :
    screen === 'unit' && a && b ? <UnitScreen bookId={a} cid={b} /> :
    screen === 'settings' ? <Settings /> :
    <Home />
  const active = screen === 'book' || screen === 'unit' ? '/library' : `/${screen ?? ''}`

  return (
    <div className="app">
      <main className="content">{page}</main>
      <nav className="tabbar">
        {TABS.map(t => (
          <a key={t.path} href={`#${t.path}`} className={active === t.path ? 'on' : ''}>
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={t.icon} /></svg>
            {t.label}
          </a>
        ))}
      </nav>
    </div>
  )
}
