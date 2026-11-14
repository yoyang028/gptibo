import { useEffect, useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { Button } from './ui/button'
import { Input } from './ui/input'

type Mode = 'login' | 'register' | 'verify' | 'forgot' | 'reset' | 'reset-link'
const titles: Record<Mode, string> = { login: '邮箱登录', register: '注册会员', verify: '验证注册邮箱', forgot: '找回密码', reset: '设置新密码', 'reset-link': '设置新密码' }
const actions: Record<Mode, string> = { login: '登录', register: '注册并发送验证码', verify: '验证并登录', forgot: '发送重置验证码', reset: '保存新密码', 'reset-link': '保存新密码' }
function authError(error: unknown) {
  const message = errorMessage(error)
  if (/too many attempts/i.test(message)) return '验证码尝试次数已用完，请重新获取验证码。'
  if (/expired/i.test(message)) return '验证码已过期，请重新获取。'
  if (/invalid otp|invalid code|otp.*not found|verification.*not found/i.test(message)) return '验证码不正确或已失效，请检查邮箱中的最新验证码。'
  if (/email.*not verified/i.test(message)) return '邮箱尚未验证，请点击“验证已有邮箱”获取验证码。'
  if (/invalid email or password/i.test(message)) return '邮箱或密码不正确。'
  if (/user already exists|email.*already/i.test(message)) return '该邮箱已注册，请登录，或验证已有邮箱。'
  return message
}

export function MemberAuthForm({ onAuthenticated }: { onAuthenticated: () => void }) {
  const token = new URLSearchParams(location.search).get('token')
  const [mode, setMode] = useState<Mode>(token ? 'reset-link' : 'login')
  const [email, setEmail] = useState(''), [password, setPassword] = useState(''), [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [message, setMessage] = useState(''), [cooldown, setCooldown] = useState(0)
  useEffect(() => {
    if (!cooldown) return
    const timer = window.setTimeout(() => setCooldown(n => Math.max(0, n - 1)), 1000)
    return () => window.clearTimeout(timer)
  }, [cooldown])
  function switchMode(next: Mode) { setMode(next); setOtp(''); setPassword(''); setError(''); setMessage('') }
  async function sendCode(reset: boolean) {
    await api(reset ? '/api/member/auth/email-otp/request-password-reset' : '/api/member/auth/email-otp/send-verification-otp', reset ? { email } : { email, type: 'email-verification' })
    setCooldown(60); setOtp(''); setMode(reset ? 'reset' : 'verify')
    setMessage(reset ? '如果该邮箱已注册，将收到 6 位验证码，10 分钟内有效。' : '验证码已发送，请输入邮件中的 6 位数字，10 分钟内有效。未收到时请检查垃圾邮件。')
  }
  async function submit() {
    if (busy) return
    setBusy(true); setError(''); setMessage('')
    try {
      if (mode === 'login') { await api('/api/member/auth/sign-in/email', { email, password, rememberMe: true }); setPassword(''); onAuthenticated() }
      else if (mode === 'register') {
        await api('/api/member/auth/sign-up/email', { email, password })
        setPassword(''); setMode('verify'); setCooldown(60)
        setMessage('请在此输入邮件中的 6 位验证码，10 分钟内有效。未收到时请检查垃圾邮件。')
      } else if (mode === 'verify') { await api('/api/member/auth/email-otp/verify-email', { email, otp }); setOtp(''); onAuthenticated() }
      else if (mode === 'forgot') await sendCode(true)
      else {
        await api(mode === 'reset' ? '/api/member/auth/email-otp/reset-password' : '/api/member/auth/reset-password', mode === 'reset' ? { email, otp, password } : { token, newPassword: password })
        switchMode('login'); history.replaceState(null, '', '/account'); setMessage('密码已重置，请用新密码登录。'); onAuthenticated()
      }
    } catch (e) { setError(authError(e)) } finally { setBusy(false) }
  }
  async function resend() {
    if (busy || cooldown) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { setError('请先填写有效邮箱。'); return }
    setBusy(true); setError(''); setMessage('')
    try { await sendCode(mode === 'reset') } catch (e) { setError(authError(e)) } finally { setBusy(false) }
  }
  const verifying = mode === 'verify' || mode === 'reset'
  return <form id="member-auth" className="member-card member-auth-form" onSubmit={e => { e.preventDefault(); void submit() }}>
    <h2>{titles[mode]}</h2>
    {error && <p className="member-error" role="alert">{error}</p>}
    {message && <p className="member-notice" role="status">{message}</p>}
    {mode !== 'reset-link' && <><label htmlFor="member-email">邮箱</label><Input id="member-email" type="email" autoComplete="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} readOnly={verifying} disabled={busy} /></>}
    {verifying && <><label htmlFor="member-otp">邮箱验证码</label><Input id="member-otp" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" minLength={6} maxLength={6} required value={otp} onChange={e => setOtp(e.target.value.replace(/\D/g, ''))} disabled={busy} placeholder="6 位数字验证码" /><small>请使用最新验证码；验证码只能使用一次。</small></>}
    {!['forgot', 'verify'].includes(mode) && <><label htmlFor="member-password">{mode.startsWith('reset') ? '新密码' : '密码'}</label><Input id="member-password" type="password" minLength={mode === 'login' ? 1 : 10} maxLength={128} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required value={password} onChange={e => setPassword(e.target.value)} disabled={busy} />{mode !== 'login' && <small>至少 10 个字符，建议混合字母、数字和符号。</small>}</>}
    <Button type="submit" disabled={busy}>{busy ? '正在处理…' : actions[mode]}</Button>
    {(verifying || mode === 'login' || mode === 'register') && <Button type="button" variant="outline" disabled={busy || cooldown > 0} onClick={() => void resend()}>{cooldown ? `${cooldown} 秒后可重发` : verifying ? '重新发送验证码' : '验证已有邮箱'}</Button>}
    <div className="member-auth-links"><Button type="button" variant="ghost" disabled={busy} onClick={() => switchMode(mode === 'register' || verifying ? 'login' : 'register')}>{mode === 'register' || verifying ? '返回登录' : '注册会员'}</Button><Button type="button" variant="ghost" disabled={busy} onClick={() => switchMode(verifying ? 'register' : 'forgot')}>{verifying ? '更换邮箱' : '忘记密码'}</Button></div>
  </form>
}
