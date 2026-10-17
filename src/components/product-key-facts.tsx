import { Check, Info } from 'lucide-react'
import './product-key-facts.css'

export function ProductKeyFacts({
  highlights = [],
  warnings = [],
}: {
  highlights?: string[]
  warnings?: string[]
}) {
  if (!highlights.length && !warnings.length) return null
  return (
    <section className="product-key-facts" aria-label="本规格购买前重点">
      {highlights.length > 0 && (
        <div>
          <h3>先了解这份商品</h3>
          <ul>
            {highlights.map((text, i) => (
              <li key={i}>
                <Check size={14} aria-hidden="true" />
                <span>{text}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="product-key-warnings">
          <h3>
            <Info size={15} aria-hidden="true" />
            购买前请确认
          </h3>
          <ul>
            {warnings.map((text, i) => (
              <li key={i}>{text}</li>
            ))}
          </ul>
        </div>
      )}
    </section>
  )
}
