import { useSyncExternalStore } from 'react'
import { cn } from 'cn'
import { ArrowRight, CircleCheck } from 'lucide-react'
import { NEWCOMER_DISCOUNT_CENTS } from '../../shared/member-promotions'
import { invitationSnapshot, subscribeInvitation } from '@/lib/member-invitation'
import { useStorefrontI18n } from '@/lib/storefront-i18n'
import { storefrontHref } from '@/lib/storefront-routing'
import { buttonVariants } from '@/components/ui/button'
import './member-invitation-notice.css'

export function MemberInvitationCampaign({ onOpen }: { onOpen: () => void }) {
  const { t } = useStorefrontI18n()
  return <a className="member-invitation-campaign" href={storefrontHref('account')} aria-labelledby="invitation-campaign-title invitation-campaign-action" onClick={event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen()
  }}>
    <h2 className="invitation-campaign-title" id="invitation-campaign-title">{t('邀请好友，')}<strong>{t('Plus免费用')}</strong></h2>
    <span className={cn(buttonVariants({ variant: 'outline', size: 'sm', className: 'invitation-campaign-action' }))} id="invitation-campaign-action">{t('查看活动')}<ArrowRight data-icon="inline-end" aria-hidden="true" /></span>
  </a>
}

export function MemberInvitationNotice() {
  const { t } = useStorefrontI18n()
  const snapshot = useSyncExternalStore(subscribeInvitation, invitationSnapshot, () => '')
  if (!snapshot) return null
  return <div className="member-invitation-notice" role="status" aria-label={t('好友邀请优惠')}>
    <CircleCheck size={15} aria-hidden="true" />
    <div className="member-invitation-notice-message">
      <strong>{t('已收到好友邀请')}</strong>
      <span>{t('符合新客条件，首单可选减 {discount} 元。', { discount: NEWCOMER_DISCOUNT_CENTS / 100 })}</span>
    </div>
  </div>
}
