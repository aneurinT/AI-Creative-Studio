import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '@/contexts/AuthContext'

export default function Login() {
  const { user, login, register } = useAuth()
  const navigate = useNavigate()

  // 已登录用户直接跳转主页
  if (user) {
    navigate('/', { replace: true })
    return null
  }
  const [isRegister, setIsRegister] = useState(false)
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError('')
    setLoading(true)

    const result = isRegister
      ? await register(username, password, displayName || undefined)
      : await login(username, password)

    setLoading(false)
    if (!result.success) {
      setError(result.error || '操作失败')
    } else {
      // 登录/注册成功，跳转到主页
      navigate('/', { replace: true })
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-gray-900 via-purple-900 to-gray-900">
      <div className="w-full max-w-md px-8">
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-white mb-2">AI Creative Studio</h1>
          <p className="text-gray-400">多人协作 AI 创意平台</p>
        </div>

        <div className="bg-gray-800/60 backdrop-blur-xl rounded-2xl shadow-2xl border border-gray-700/50 p-8">
          {/* 切换标签 */}
          <div className="flex mb-6 bg-gray-700/50 rounded-lg p-1">
            <button
              onClick={() => { setIsRegister(false); setError('') }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${!isRegister ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              登录
            </button>
            <button
              onClick={() => { setIsRegister(true); setError('') }}
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-all ${isRegister ? 'bg-purple-600 text-white' : 'text-gray-400 hover:text-white'}`}
            >
              注册
            </button>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-400 mb-1">用户名</label>
              <input
                type="text"
                value={username}
                onChange={e => setUsername(e.target.value)}
                placeholder="请输入用户名"
                className="w-full px-4 py-2.5 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                required
                minLength={2}
                maxLength={20}
              />
            </div>

            {isRegister && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">显示名称（可选）</label>
                <input
                  type="text"
                  value={displayName}
                  onChange={e => setDisplayName(e.target.value)}
                  placeholder="你的昵称"
                  className="w-full px-4 py-2.5 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                  maxLength={20}
                />
              </div>
            )}

            <div>
              <label className="block text-sm text-gray-400 mb-1">密码</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="请输入密码"
                className="w-full px-4 py-2.5 bg-gray-700/50 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition-all"
                required
                minLength={4}
              />
            </div>

            {error && (
              <div className="bg-red-500/10 border border-red-500/30 rounded-lg px-4 py-2.5 text-red-400 text-sm">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 text-white font-medium rounded-lg transition-all transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {loading ? '处理中...' : isRegister ? '注册并登录' : '登录'}
            </button>
          </form>

          {!isRegister && (
            <p className="mt-4 text-xs text-gray-500 text-center">
              首次使用请点击「注册」创建账号
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
