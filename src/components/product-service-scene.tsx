import { Check, GraduationCap, MessageSquareText, Sparkles } from 'lucide-react'
import { ProductMark } from './brand'
import './product-service-scene.css'

export function ProductServiceScene({ productId, name, duration }: { productId: string; name: string; duration: string }) {
  if (productId === 'student-verification') return <div className="service-scene student-scene" aria-hidden="true">
    <div className="student-pass"><span className="scene-eyebrow"><GraduationCap size={15} /> STUDENT PASS</span><strong>为学习加一程</strong><div className="student-pass-period"><b>4</b><span>个月<br />活动资格认证</span></div><span className="student-pass-rule" /></div>
    <span className="scene-floating-label"><Check size={13} />学生资格认证</span>
  </div>
  if (productId === 'muse') return <div className="service-scene muse-scene" aria-hidden="true">
    <span className="muse-orbit muse-orbit-one" /><span className="muse-orbit muse-orbit-two" />
    <div className="muse-token"><Sparkles size={34} strokeWidth={1.3} /><strong>Muse</strong><span>CREATE YOUR NEXT</span></div>
    <span className="scene-floating-label"><Check size={13} />成品账号</span>
  </div>
  if (productId === 'codex-sms') return <div className="service-scene sms-scene" aria-hidden="true">
    <div className="sms-terminal"><span className="scene-eyebrow"><i /><i /><i /><span>SMS / CODEX</span></span><strong>+1 ··· ··· ····</strong><span className="sms-code"><b>✱</b><b>✱</b><b>✱</b><b>✱</b><b>✱</b><b>✱</b></span><span className="sms-terminal-footer"><MessageSquareText size={12} />单次短信接码</span></div>
  </div>
  return <div className="service-scene generic-service-scene" aria-hidden="true"><div className="service-pass"><ProductMark productId={productId} /><strong>{name}</strong><span>{duration}</span></div></div>
}
