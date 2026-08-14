import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// 监听 Vite HMR 错误并输出到控制台（从 index.html 内联脚本迁移至此，避免 html-proxy 报错）
if (import.meta.hot?.on) {
  import.meta.hot.on('vite:error', (error: any) => {
    if (error.err) {
      console.error(
        [error.err.message, error.err.frame].filter(Boolean).join('\n'),
      )
    }
  })
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
