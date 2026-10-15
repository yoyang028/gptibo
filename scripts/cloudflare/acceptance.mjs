// Reuse the same original storefront user journey against the independent
// workerd/D1 stack. No real supplier credentials are loaded by this process.
process.argv.push('--cloudflare')
await import('../local/quefa-browser-test.mjs')
