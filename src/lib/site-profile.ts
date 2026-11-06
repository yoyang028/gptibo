export const SITE_KIND = import.meta.env.VITE_SITE_KIND === 'wholesale' ? 'wholesale'
  : import.meta.env.VITE_SITE_KIND === 'general' ? 'general' : 'scholai'
