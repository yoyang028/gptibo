import type { CSSProperties, ReactNode } from 'react'
import {
  defaultLayout,
  type ProductArtworkConfig,
} from '../../shared/product-artwork'
import { ProductSceneFrame } from './membership-scene'
import './product-artwork.css'

export function ArtworkImage({ config }: { config: ProductArtworkConfig }) {
  return config.vector ? (
    <svg
      className="artwork-image"
      viewBox={`0 0 ${config.vector.width} ${config.vector.height}`}
      aria-hidden="true"
      data-artwork-format="vector"
    >
      {config.vector.paths.map((p, i) => (
        <path key={i} fill={p.fill} d={p.d} fillRule="evenodd" />
      ))}
    </svg>
  ) : (
    <img
      className="artwork-image"
      src={config.image}
      alt=""
      draggable={false}
      data-artwork-format="raster"
    />
  )
}

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
  const layout = { ...defaultLayout(), ...config.layout }
  const style = {
    '--artwork-scale': layout.scale / 100,
    '--artwork-x': layout.x + '%',
    '--artwork-y': layout.y + '%',
    '--artwork-background': layout.backgroundColor,
    '--artwork-pedestal': layout.pedestalColor,
  } as CSSProperties
  return (
    <ProductSceneFrame
      className={`product-artwork artwork-${config.template}${config.layout ? ' artwork-custom-layout' : ''}${detail ? ' artwork-detail' : ''}`}
      template={config.template}
      label={name + '商品展示图'}
    >
      <div
        className={`membership-visual artwork-visual artwork-bg-${layout.background}`}
        style={style}
        aria-hidden="true"
      >
        {layout.pedestal !== 'none' && (
          <span className={`artwork-pedestal pedestal-${layout.pedestal}`} />
        )}
        <div className="artwork-placement">
          {membership ? (
            <>
              <span className="artwork-card-back artwork-back-one" />
              <span className="artwork-card-back artwork-back-two" />
              <div className="store-tier-face artwork-member-card">
                <div className="artwork-member-brand">
                  <ArtworkImage config={config} />
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
              <ArtworkImage config={config} />
            </div>
          )}
        </div>
        {config.template === 'shine' && <span className="artwork-sheen" />}
      </div>
    </ProductSceneFrame>
  )
}
