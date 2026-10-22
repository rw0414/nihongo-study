import { createRoot } from 'react-dom/client'
import App from './App'
import { FuriganaProvider } from './Ja'
import './styles.css'

createRoot(document.getElementById('root')!).render(<FuriganaProvider><App /></FuriganaProvider>)

if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js')
