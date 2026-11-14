import { emailTemplates } from './emails.generated.ts'
import type { Env } from './platform.ts'
import { membershipClaimUrl } from '../shared/membership-claim.ts'
import { boundedResponseText } from './bounded-response.ts'
import { shopBrand, shopMailFrom, escapeMail } from './store-branding.ts'
import { ownerStorefrontLinks } from './storefront-hosts.ts'

export type VerificationKind = Exclude<keyof typeof emailTemplates, 'partner-welcome' | 'recharge-reminder' | 'delivery-link' | 'delivery-cdk' | 'delivery-duolingo-link' | 'delivery-gmail'>

export function membershipDeliveryMessage(kind: 'link' | 'cdk', orderId: string, value: string, instructions: string, plan?: string) {
  const claimUrl = plan === 'gmail-account' ? null : membershipClaimUrl(value)
  if (plan !== 'gmail-account' && kind === 'link' && !claimUrl) throw new Error('Invalid membership claim link')
  const duo = plan === 'duolingo-12m' || kind === 'cdk'
  const template = emailTemplates[plan === 'gmail-account' ? 'delivery-gmail' : claimUrl && duo ? 'delivery-duolingo-link' : kind === 'link' ? 'delivery-link' : 'delivery-cdk']
  const values: Record<string, string> = { __RECHARGE_DELIVERY_ORDER__: orderId, __RECHARGE_DELIVERY_VALUE__: value, __RECHARGE_DELIVERY_URL__: claimUrl ?? '', __RECHARGE_DELIVERY_INSTRUCTIONS__: instructions }
  const escape = (text: string) => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)
  const pattern = /__RECHARGE_DELIVERY_(?:ORDER|VALUE|URL|INSTRUCTIONS)__/g
  return { subject: template.subject, html: template.html.replace(pattern, key => key === '__RECHARGE_DELIVERY_VALUE__' && claimUrl ? `<a href="${escape(claimUrl)}" style="color:#6256cf;word-break:break-all">${escape(value)}</a>` : escape(values[key]).replaceAll('\n', '<br />')), text: template.text.replace(pattern, key => values[key]) }
}

export type RechargeReminderDetails = { orderId: string; planName: string; contacts: string }
export function rechargeReminderMessage(details: RechargeReminderDetails) {
  const values: Record<string, string> = {
    '__RECHARGE_REMINDER_ORDER_ID__': details.orderId,
    '__RECHARGE_REMINDER_PLAN_NAME__': details.planName,
    '__RECHARGE_REMINDER_CONTACTS__': details.contacts,
  }
  const escape = (value: string) => value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]!)
  const template = emailTemplates['recharge-reminder']
  // One pass prevents customer/partner text from being interpreted as another placeholder.
  const pattern = /__RECHARGE_REMINDER_(?:ORDER_ID|PLAN_NAME|CONTACTS)__/g
  return { subject: template.subject, html: template.html.replace(pattern, key => escape(values[key]).replaceAll('\n', '<br />')), text: template.text.replace(pattern, key => values[key]) }
}

export async function sendRechargeReminderEmail(env: Env, to: string, message: ReturnType<typeof rechargeReminderMessage>, id: string, storeId = 'platform') {
  await sendEmail(env, to, message, 'recharge-reminder/' + id, storeId)
}

export async function sendMembershipPreviewEmail(env: Env, to: string, message: ReturnType<typeof membershipDeliveryMessage>, id: string, storeId = 'platform') {
  const response = await sendEmail(env, to, message, 'membership-preview/' + id, storeId)
  const result = JSON.parse(await boundedResponseText(response, 16384)) as { id?: unknown }
  if (typeof result.id !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(result.id)) throw new Error('Preview mail result not confirmed')
  return result.id
}

export function partnerInvitationMessage() {
  return emailTemplates['partner-welcome']
}

export function verificationMessage(kind: VerificationKind, code: string) {
  // Only server-generated codes enter the pre-rendered HTML; never accept arbitrary markup.
  if (!/^\d{6}$/.test(code)) throw new Error('Invalid verification code')
  const template = emailTemplates[kind]
  return {
    subject: template.subject,
    html: template.html.replaceAll('__RECHARGE_VERIFICATION_CODE__', code),
    text: template.text.replaceAll('__RECHARGE_VERIFICATION_CODE__', code),
  }
}

export async function sendVerificationEmail(env: Env, kind: VerificationKind, to: string, code: string, challenge: string, storeId = 'platform') {
  await sendEmail(env, to, verificationMessage(kind, code), kind + '/' + challenge, storeId)
}

export async function sendPartnerInvitationEmail(env: Env, to: string, invitationId: string) {
  await sendEmail(env, to, partnerInvitationMessage(), 'partner-welcome/' + invitationId)
}

export async function prepareShopEmail(env: Env, message: { subject: string; html: string; text: string }, storeId = 'platform') {
  const {ownerShop}=await import('./owner-shop.ts')
  const shop=env.INTEREST_DB?await ownerShop(env,storeId):{brandName:'',name:'GPTibo',version:0},name=shopBrand(shop)
  const from=name==='GPTibo'?env.RESEND_FROM:shopMailFrom(env.RESEND_FROM,shop)
  const escape=escapeMail
  // Match template headers/footers, preserving customer delivery text. React's
  // static text boundary distinguishes its footer from interpolated content.
  message={subject:message.subject.replace(/^GPTibo(?=\s*[·・])/,()=>name),
    html:message.html.replace('>GPTibo<','>'+escape(name)+'<').replaceAll('>GPTibo<!-- --> · ','>'+escape(name)+'<!-- --> · ').replace('alt="GPTibo"','alt="'+escape(name)+'"'),
    text:message.text.replace(/^GPTibo/,()=>name).replace(/(\n)GPTibo(?= · (?:让工具回归简单|独立服务商)(?:\n|$))/g,(_,prefix:string)=>prefix+name)}
  if(env.RECHARGE_NOTIFY_URL) {
    const fallback=new URL(env.RECHARGE_NOTIFY_URL).origin
    const base=new URL(ownerStorefrontLinks(env,fallback,storeId,'').storefront_url)
    if(base.protocol==='https:') {
      message={...message,html:message.html.replaceAll('https://shop.example.invalid/email-logo.png',escape(base.origin+'/api/catalog?brand-logo=1&v='+shop.version)).replaceAll('https://shop.example.invalid/',escape(base.origin+'/')),text:message.text.replaceAll('https://shop.example.invalid/',base.origin+'/')}
    }
  }
  return { from, ...message }
}

async function sendEmail(env: Env, to: string, message: { subject: string; html: string; text: string }, idempotencyKey: string, storeId = 'platform') {
  const prepared = await prepareShopEmail(env, message, storeId)
  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    redirect: 'manual',
    headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey },
    body: JSON.stringify({ to: [to], ...prepared }),
    signal: AbortSignal.timeout(10000),
  })
  if (!response.ok) throw new Error('delivery failed')
  return response
}
