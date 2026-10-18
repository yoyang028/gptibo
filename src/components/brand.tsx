import { GeminiMark } from './membership-scene'
import { clearProductBrand } from '../../shared/product-brand'
import './product-brand.css'
import { officialBrand } from './official-brand'
import {
  Mail,
  Package,
  Palette,
  Music2,
  Apple,
  Clapperboard,
} from 'lucide-react'

export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M9 24V13c0-4 3-7 7-7M16 26V13c0-4 3-7 7-7M23 24V15"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
      />
    </svg>
  )
}
export function ProductMark({
  small = false,
  productId = 'chatgpt',
}: {
  small?: boolean
  productId?: string
}) {
  const brand = clearProductBrand(productId)
  const official = officialBrand(productId)
  return (
    <div
      className={`product-mark mark-${productId} ${small ? 'small' : ''}${brand ? ' product-mark-clear' : ''}${official ? ' product-mark-official' : ''}`}
      data-brand={brand}
      aria-hidden="true"
    >
      <ProductLogo productId={productId} />
    </div>
  )
}
export function XLogoPath() {
  return (
    <path
      fill="currentColor"
      d="M18.9 2H22l-6.77 7.74L23.2 22h-6.24l-4.89-7.4L5.6 22H2.47l7.15-8.17L1.2 2h6.4l4.43 6.77L18.9 2ZM17.8 20h1.73L6.65 3.9H4.8L17.8 20Z"
    />
  )
}
export function ProductLogo({ productId }: { productId: string }) {
  const brand = clearProductBrand(productId)
  const official = officialBrand(productId)
  if (official)
    return official.mono ? (
      <span
        className="product-logo"
        data-brand={productId}
        style={{ maskImage: `url(/brands/${official.file})` }}
        aria-hidden="true"
      />
    ) : (
      <img
        className="product-logo"
        data-brand={productId}
        style={{ background: 'none' }}
        src={'/brands/' + official.file}
        alt=""
        aria-hidden="true"
      />
    )
  if (brand === 'muse' || brand === 'codex' || brand === 'duolingo' || brand === 'student-verification')
    return (
      <img
        className="product-logo"
        data-brand={brand}
        style={{ background: 'none' }}
        src={'/brands/' + {
          codex: 'codex-blue.svg',
          muse: 'muse.svg',
          duolingo: 'duolingo-duo-home.svg',
          'student-verification': 'student-plus.svg',
        }[brand]}
        alt=""
        aria-hidden="true"
      />
    )
  if (brand)
    return (
      <span
        className="product-logo"
        data-brand={brand}
        style={{
          maskImage: `url(/brands/${brand === 'chatgpt' ? 'openai' : brand}.svg)`,
        }}
        aria-hidden="true"
      />
    )
  const familyIcons: Record<string, typeof Mail> = {
    'adobe-express': Palette,
    'apple-music': Music2,
    'apple-id': Apple,
    'capcut-pro': Clapperboard,
  }
  const Icon = familyIcons[productId]
  if (Icon)
    return (
      <Icon
        className="product-logo"
        style={{ background: 'none' }}
        aria-hidden="true"
      />
    )
  if (productId.startsWith('custom-'))
    return (
      <Package
        className="product-logo"
        style={{ background: 'none' }}
        aria-hidden="true"
      />
    )
  if (productId === 'x-premium')
    return (
      <svg
        className="product-logo"
        style={{ background: 'none' }}
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <XLogoPath />
      </svg>
    )
  if (productId === 'gemini') return <GeminiMark />
  const slug =
    productId === 'chatgpt'
      ? 'openai'
      : ['codex-sms', 'codex-credits'].includes(productId)
        ? 'codex'
        : productId
  return (
    <span
      className="product-logo"
      style={{ maskImage: `url(/brands/${slug}.svg)` }}
      aria-hidden="true"
    />
  )
}
export function SuccessMark() {
  return (
    <div className="result-icon success">
      <span className="t-success-check" data-state="in" aria-hidden="true">
        <svg width="40" height="40" viewBox="0 0 40 40" fill="none">
          <path
            pathLength="1"
            d="m10 20 7 7 14-14"
            stroke="currentColor"
            strokeWidth="2.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </span>
    </div>
  )
}
