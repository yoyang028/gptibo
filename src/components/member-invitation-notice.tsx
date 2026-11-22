import { useSyncExternalStore } from 'react'
import { cn } from 'cn'
import { CircleCheck, Gift } from 'lucide-react'
import { INVITATION_REWARD_CENTS, NEWCOMER_DISCOUNT_CENTS, type MemberStoreId } from '../../shared/member-promotions'
import { invitationSnapshot, subscribeInvitation } from '@/lib/member-invitation'
import { useStorefrontI18n } from '@/lib/storefront-i18n'
import { storefrontHref } from '@/lib/storefront-routing'
import { buttonVariants } from '@/components/ui/button'
import './member-invitation-notice.css'

export function MemberInvitationCampaign({ onOpen }: { onOpen: () => void }) {
  const { t } = useStorefrontI18n()
  return <a className="member-invitation-campaign" href={storefrontHref('account')} aria-labelledby="invitation-campaign-title invitation-campaign-action" aria-describedby="invitation-campaign-description" onClick={event => {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    onOpen()
  }}>
    <Gift size={18} aria-hidden="true" />
    <div className="invitation-campaign-copy">
      <h2 id="invitation-campaign-title">{t('邀请好友，')}<span className="invitation-campaign-benefit">{t('Plus 免费用')}</span></h2>
      <p id="invitation-campaign-description">
        <span>{t('每邀 1 位有效新客得 {reward} 元，', { reward: INVITATION_REWARD_CENTS / 100 })}</span><span>{t('攒够奖励可全额抵扣 1 个月 Plus。')}</span>
      </p>
    </div>
    <span className={cn(buttonVariants({ variant: 'outline', size: 'sm', className: 'invitation-campaign-action' }))} id="invitation-campaign-action">{t('查看邀请活动')}</span>
  </a>
}

export function MemberInvitationNotice({ store }: { store: MemberStoreId }) {
  const { t } = useStorefrontI18n()
  const snapshot = useSyncExternalStore(subscribeInvitation, () => invitationSnapshot(store), () => '')
  if (!snapshot) return null
  return <div className="member-invitation-notice" role="status" aria-label={t('好友邀请优惠')}>
    <CircleCheck size={15} aria-hidden="true" />
    <div className="member-invitation-notice-message">
      <strong>{t('已收到好友邀请')}</strong>
      <span>{t('符合新客条件，首单可选减 {discount} 元。', { discount: NEWCOMER_DISCOUNT_CENTS / 100 })}</span>
    </div>
  </div>
}
