import { Button } from '@/components/ui/button'
import type { AdminAudience } from '../../shared/admin-store-scope'

export function AdminAudienceSwitch({ label, ownerLabel, agentLabel, audience, onChange }: {
  label: string
  ownerLabel: string
  agentLabel: string
  audience: AdminAudience
  onChange: (audience: AdminAudience) => void
}) {
  return <div className="admin-audience-switch" role="group" aria-label={label}>
    <Button type="button" size="sm" variant={audience === 'owner' ? 'default' : 'outline'} aria-pressed={audience === 'owner'} onClick={() => onChange('owner')}>{ownerLabel}</Button>
    <Button type="button" size="sm" variant={audience === 'agent' ? 'default' : 'outline'} aria-pressed={audience === 'agent'} onClick={() => onChange('agent')}>{agentLabel}</Button>
  </div>
}
