import '@/styles/sms.css'
import {
  ArrowRight,
  Check,
  KeyRound,
  MessageSquareText,
  Phone,
} from 'lucide-react'

// A labelled process illustration, with no simulated orders, numbers or stock.
export function SmsFlowPreview({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`sms-flow-preview${compact ? ' compact' : ''}`}
      aria-label="手机号到短信验证码的流程示意"
    >
      <div className="sms-flow-caption">
        <span>SMS / UNITED STATES</span>
        <span>流程示意</span>
      </div>
      <div className="sms-flow-track" aria-hidden="true">
        <div className="sms-flow-step sms-flow-phone">
          <span className="sms-flow-icon">
            <Phone size={22} />
          </span>
          <strong>获取手机号</strong>
          <span>美国号码 · 单次使用</span>
          <small>+1 ••• ••• ••••</small>
        </div>
        <ArrowRight className="sms-flow-arrow" size={16} />
        <div className="sms-flow-step sms-flow-message">
          <span className="sms-flow-icon">
            <MessageSquareText size={22} />
          </span>
          <strong>收到短信</strong>
          <span>在原订单等待</span>
          <small>
            <Check size={12} /> 短信验证
          </small>
        </div>
        <ArrowRight className="sms-flow-arrow" size={16} />
        <div className="sms-flow-step sms-flow-code">
          <span className="sms-flow-icon">
            <KeyRound size={22} />
          </span>
          <strong>复制验证码</strong>
          <span>完成本次验证</span>
          <small>• • • • • •</small>
        </div>
      </div>
      <div className="sms-flow-footer">
        <span>一个订单，一次短信。</span>
        <span>手机号 → 短信 → 验证码</span>
      </div>
    </div>
  )
}
