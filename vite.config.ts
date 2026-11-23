import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'

// Content-Security-Policy como etiqueta <meta>: el plan Free de CloudFront
// no permite cabeceras propias. Solo se inyecta al hacer el build, para no
// romper la recarga en caliente de "npm run dev".
function cspMeta(apiUrl: string | undefined): Plugin {
  const csp = [
    "default-src 'self'",
    "script-src 'self' https://challenges.cloudflare.com",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https://image.tmdb.org",
    `connect-src 'self'${apiUrl ? ` ${apiUrl}` : ''}`,
    'frame-src https://challenges.cloudflare.com',
    "font-src 'self' data:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')

  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml(html) {
      if (!html.includes('<head>')) {
        throw new Error('csp-meta: no se encontro <head> en index.html')
      }
      return html.replace(
        '<head>',
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
      )
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return {
    plugins: [react(), cspMeta(env.VITE_COMMENTS_API_URL)],
  }
})
