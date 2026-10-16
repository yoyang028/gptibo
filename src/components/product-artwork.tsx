import type { ReactNode } from 'react'
import type { ProductArtworkConfig } from '../../shared/product-artwork'
import { ProductSceneFrame } from './membership-scene'
import './product-artwork.css'

export function ProductArtwork({
  config,
  name,
  caption = '',
  fallback = null,
  detail = false,
}: {
  config?: ProductArtworkConfig
  name: string
  caption?: string
  fallback?: ReactNode
  detail?: boolean
}) {
  if (!config || config.template === 'original' || !config.image)
    return fallback
  const membership = config.template === 'membership'
  return (
    <ProductSceneFrame
      className={`product-artwork artwork-${config.template}${detail ? ' artwork-detail' : ''}`}
      template={config.template}
      label={name + '商品展示图'}
    >
      <div className="membership-visual artwork-visual" aria-hidden="true">
        {membership ? (
          <>
            <span className="artwork-card-back artwork-back-one" />
            <span className="artwork-card-back artwork-back-two" />
            <div className="store-tier-face artwork-member-card">
              <div className="artwork-member-brand">
                <img src={config.image} alt="" draggable={false} />
                <strong>{name}</strong>
              </div>
              {caption && (
                <span className="artwork-member-caption">{caption}</span>
              )}
              <span className="artwork-card-chip" />
            </div>
          </>
        ) : (
          <div className="artwork-image-wrap">
            <img
              className="artwork-image"
              src={config.image}
              alt=""
              draggable={false}
            />
          </div>
        )}
        {config.template === 'shine' && <span className="artwork-sheen" />}
      </div>
    </ProductSceneFrame>
  )
}
