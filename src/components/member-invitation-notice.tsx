import { useSyncExternalStore } from 'react'
import { CircleCheck } from 'lucide-react'
import { invitationSnapshot, subscribeInvitation } from '@/lib/member-invitation'
import { CopyButton } from './copy-button'
import './member-invitation-notice.css'

export function MemberInvitationNotice() {
  const snapshot = useSyncExternalStore(subscribeInvitation, invitationSnapshot, () => '')
  if (!snapshot) return null
  const [code, alias] = snapshot.split('|')
  const inviteUrl = new URL(alias ? '/ref/' + alias : '/?invite=' + code, location.origin).href
  return <aside className="member-invitation-notice page-width" aria-label="好友邀请来源">
    <div className="member-invitation-notice-message" role="status"><CircleCheck size={20} aria-hidden="true"/><div><strong>已记录好友邀请</strong><p>本店 ChatGPT 四个规格，符合新客条件首单可选减5元。</p></div></div>
    <CopyButton variant="outline" value={inviteUrl} label="复制此邀请链接"/>
  </aside>
}
