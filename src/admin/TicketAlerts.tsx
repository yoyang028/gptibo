import { useEffect, useRef, useState } from 'react'
import { Bell, Volume2, VolumeX } from 'lucide-react'
import { api, errorMessage } from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'

type Summary = { version: number; pending: number; enabled?: boolean }
export type AdminNotifications = { tickets?: number; refunds?: number }

export function TicketAlerts({ onOpen, onRefunds, onCounts }: {
  onOpen: () => void
  onRefunds: () => void
  onCounts: (counts: AdminNotifications) => void
}) {
  const [summary, setSummary] = useState<Summary>()
  const [refunds, setRefunds] = useState<Summary>()
  const [enabled, setEnabled] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [errors, setErrors] = useState({ tickets: '', refunds: '' })
  const [unseen, setUnseen] = useState(false)
  const [unseenRefund, setUnseenRefund] = useState(false)
  const [open, setOpen] = useState(false)
  const audio = useRef<AudioContext | null>(null)
  const speech = useRef<SpeechSynthesisUtterance | null>(null)
  const sound = useRef(false)
  const mounted = useRef(false)
  const versions = useRef<Partial<Record<'tickets' | 'refunds', number>>>({})
  function stopSpeech() {
    if (speech.current) {
      speech.current.onerror = null
      speech.current = null
      window.speechSynthesis.cancel()
    }
  }
  function audioFailed(message: string) {
    if (!mounted.current) return
    sound.current = false; setEnabled(false); setAudioError(message)
    stopSpeech()
  }
  function announceRefund() {
    if (!('speechSynthesis' in window) || !('SpeechSynthesisUtterance' in window)) throw new Error('speech unavailable')
    stopSpeech()
    const utterance = new SpeechSynthesisUtterance('您有一单退款待处理')
    utterance.lang = 'zh-CN'
    const voices = window.speechSynthesis.getVoices()
    const voice = voices.find(v => /^zh[-_]CN$/i.test(v.lang)) || voices.find(v => /^zh/i.test(v.lang))
    if (voice) utterance.voice = voice
    utterance.onend = () => { if (speech.current === utterance) speech.current = null }
    utterance.onerror = event => {
      if (speech.current === utterance && event.error !== 'canceled' && event.error !== 'interrupted') audioFailed('退款语音播放失败，请检查设备中文语音和浏览器声音权限后重新开启。')
    }
    speech.current = utterance
    window.speechSynthesis.resume()
    window.speechSynthesis.speak(utterance)
  }
  async function chime() {
    const context = audio.current
    if (!context) return
    await context.resume()
    if (!sound.current) return
    if (context.state !== 'running') throw new Error('audio blocked')
    for (const [offset, frequency] of [[0, 660], [0.22, 880]]) {
      const oscillator = context.createOscillator()
      const gain = context.createGain()
      const start = context.currentTime + offset
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0, start)
      gain.gain.linearRampToValueAtTime(0.16, start + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, start + 0.3)
      oscillator.connect(gain); gain.connect(context.destination)
      oscillator.start(start); oscillator.stop(start + 0.32)
      oscillator.onended = () => { oscillator.disconnect(); gain.disconnect() }
    }
  }
  useEffect(() => {
    mounted.current = true
    let stopped = false
    let ticketsDisabled = false
    const controller = new AbortController()
    const timers: ReturnType<typeof setTimeout>[] = []
    async function poll(kind: 'tickets' | 'refunds') {
      try {
        const next = await api<Summary>(`/api/admin/${kind}/notifications`, undefined, controller.signal)
        if (stopped) return
        const previous = versions.current[kind]
        const changed = previous !== undefined && next.version > previous
        versions.current[kind] = next.version
        if (kind === 'tickets') { setSummary(next); ticketsDisabled = next.enabled === false }
        else setRefunds(next)
        setErrors(current => ({ ...current, [kind]: '' }))
        if (changed) {
          if (kind === 'tickets') setUnseen(true)
          else setUnseenRefund(true)
          if (sound.current) {
            try {
              if (kind === 'refunds') announceRefund()
              else await chime()
            } catch { if (!stopped) audioFailed('声音播放失败，请检查浏览器声音权限后重新开启。') }
          }
        }
      } catch (e) { if (!stopped) setErrors(current => ({ ...current, [kind]: errorMessage(e) })) }
      finally { if (!stopped && !(kind === 'tickets' && ticketsDisabled)) timers[kind === 'tickets' ? 0 : 1] = setTimeout(() => { void poll(kind) }, 15000) }
    }
    void poll('tickets')
    void poll('refunds')
    return () => {
      stopped = true; mounted.current = false; controller.abort(); timers.forEach(clearTimeout)
      sound.current = false; stopSpeech(); void audio.current?.close(); audio.current = null
    }
  }, [])
  const tickets = summary?.enabled === false ? undefined : summary?.pending
  const refundCount = refunds?.pending
  useEffect(() => onCounts({ tickets, refunds: refundCount }), [tickets, refundCount, onCounts])
  function toggle() {
    if (sound.current) { sound.current = false; setEnabled(false); stopSpeech(); return }
    try {
      audio.current ??= new AudioContext()
      sound.current = true; setEnabled(true); setAudioError('')
      // Start speech within the click gesture so browsers can unlock playback.
      announceRefund()
      void chime().catch(() => audioFailed('无法播放提示音，请检查浏览器声音权限后重试。'))
    } catch { audioFailed('无法播放声音，请检查浏览器是否支持中文语音并允许声音后重试。') }
  }
  const ticketsSupported = summary?.enabled !== false
  const connectionError = [ticketsSupported && errors.tickets && `工单提醒连接中断：${errors.tickets}`, errors.refunds && `退款提醒连接中断：${errors.refunds}`].filter(Boolean).join('；')
  const pending = (tickets ?? 0) + (refundCount ?? 0)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger render={<Button variant="ghost" size="icon" className="admin-bell" aria-label={pending ? `后台通知，${pending} 条待处理` : '后台通知'} />}>
        <Bell size={17} />
        {(pending > 0 || unseen || unseenRefund) && <span className="admin-bell-dot" aria-hidden="true" />}
      </PopoverTrigger>
      <PopoverContent align="end" className="admin-notifications">
        <PopoverTitle>后台通知</PopoverTitle>
        {ticketsSupported && <Button variant="ghost" onClick={() => { setOpen(false); setUnseen(false); onOpen() }}>
          代理工单{tickets !== undefined && ` · ${tickets} 条待处理`}{unseen && ' · 有新消息'}
        </Button>}
        <Button variant="ghost" onClick={() => { setOpen(false); setUnseenRefund(false); onRefunds() }}>
          退款与售后{refundCount !== undefined && ` · ${refundCount} 单待处理`}{unseenRefund && ' · 有新申请'}
        </Button>
        <Button variant="outline" onClick={toggle} aria-pressed={enabled}>
          {enabled ? <VolumeX size={15} /> : <Volume2 size={15} />}
          {enabled ? '关闭声音提醒' : '开启声音提醒'}
        </Button>
        {(connectionError || audioError) && <p role="status">{connectionError || audioError}</p>}
      </PopoverContent>
    </Popover>
  )
}
