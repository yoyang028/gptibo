import { useState } from 'react'
import { api, errorMessage } from '@/lib/api'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from './ui/dialog'
import { CopyButton } from './copy-button'

export function MemberInviteCard({ member, onSaved }: { member: { frozen: boolean; inviteUrl: string; inviteAlias: string; inviteCustomized: boolean }; onSaved: () => void }) {
  const [open, setOpen] = useState(false), [alias, setAlias] = useState(''), [busy, setBusy] = useState(false), [error, setError] = useState('')
  const prefix = new URL('/i/', member.inviteUrl).href
  async function save() {
    if (busy) return
    setBusy(true); setError('')
    try { await api('/api/member/invitation', { alias }); setOpen(false); onSaved() } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  return <section className="member-card"><h2>我的邀请链接</h2><p>好友无需注册即可通过此链接购买。</p>
    <div className="member-invite"><Input aria-label="我的邀请链接" readOnly value={member.inviteUrl} /><CopyButton value={member.inviteUrl} label="复制邀请链接" /></div>
    <p>{member.inviteCustomized ? '自定义地址已确定，不能再次修改。原来的邀请链接仍然有效。' : '可自定义一次邀请地址，保存成功后不能再改。'}</p>
    {!member.inviteCustomized && <Button variant="outline" disabled={member.frozen} onClick={() => { setAlias(''); setError(''); setOpen(true) }}>自定义邀请链接</Button>}
    <Dialog open={open} onOpenChange={value => { if (!busy) setOpen(value) }}><DialogContent className="member-alias-dialog"><DialogHeader><DialogTitle>自定义邀请地址</DialogTitle><DialogDescription>仅有一次自定义机会，保存成功后永久确定。填写错误或地址被占用不会消耗机会。</DialogDescription></DialogHeader>
      <form className="member-alias-form" onSubmit={e => { e.preventDefault(); void save() }}>
        <label htmlFor="member-invite-alias">专属地址</label><div className="member-alias-input"><span>{prefix}</span><Input id="member-invite-alias" autoComplete="off" required minLength={3} maxLength={20} pattern="[a-zA-Z0-9][a-zA-Z0-9-]{1,18}[a-zA-Z0-9]" placeholder="例如 yangyang" value={alias} disabled={busy} onChange={e => setAlias(e.target.value.toLowerCase())} /></div>
        <small>3～20 位字母、数字或短横线，首尾为字母或数字；不区分大小写。{alias.length}/20</small>
        {error && <p className="member-error" role="alert">{error}</p>}
        <DialogFooter><Button type="button" variant="outline" disabled={busy} onClick={() => setOpen(false)}>取消</Button><Button type="submit" disabled={busy}>{busy ? '正在保存…' : '确认并永久保存'}</Button></DialogFooter>
      </form>
    </DialogContent></Dialog>
  </section>
}
