# Brand marks

The Muse blue mark uses the original path and color stops shown in the hero at https://muse.gptibo.com/muse-logo.svg (checked 2026-10-17). The catalog reuses this local vector with a seven-second float inspired by that hero. It contains no inner label, frame or orbit, and pauses offscreen or with reduced motion enabled.

OpenAI, Codex, Claude and Grok SVG marks are sourced from [Lobe Icons](https://github.com/lobehub/lobe-icons), package `@lobehub/icons-static-svg`, retrieved 2026-09-26. The original SVG paths are retained. Monochrome variants use CSS masks for light/dark themes; the colored Codex treatment is described below. The upstream MIT license is included in this directory. Brand names and marks belong to their respective owners.

`codex-blue.svg` retains the original Codex silhouette and terminal-symbol vector paths above, rendered separately with a blue gradient and a white terminal symbol to follow the user's supplied app-icon reference (2026-10-18). It has no app-tile background, border, raster image or filter. Use the same colored asset in both themes, including Codex credits, SMS platform selection, summaries and catalog illustrations. The catalog tier colors and specification borders share the `--codex-blue` palette.

Claude uses its original `claude.svg` vector path as an orange CSS mask in both themes. All shared Claude marks, including product headings, catalog/editor previews, summaries and SMS project selection, have transparent wrappers with no tile, border or shadow (2026-10-18).

## Single official marks (2026-10-17)

Six catalog families use one first-party SVG each, with distinct slow transform loops and small independent scene accents: Grok stars, Gemini sparkles, Express creative marks, Music notes and rhythm, Apple Account colored dots, and CapCut editing guides. Logo geometry and colors stay intact, without a surrounding deck or tile. All motion pauses offscreen and when the document is hidden; reduced-motion disables both the logo and accent animations. The previously established ChatGPT, Claude, SMS, Codex credits, Plus student, Muse and remote-deployment card compositions are retained. Gmail reuses its original envelope scene; Duolingo uses the original official Duo animation below.

| Local asset | Verified first-party source | Preparation |
| --- | --- | --- |
| grok-official.svg | https://grok.com/images/favicon.svg | Original two filled symbol paths, with the complete bounds (48 48 416 416), including both diagonal tips. Remove the favicon backdrop/foreignObject and its redundant contour; render as a theme-aware mask. Corrected 2026-10-18. |
| gmail-official.svg | https://www.gstatic.com/images/branding/productlogos/gmail_2026/v2/web/192px.svg | Unchanged current official Gmail SVG, verified on https://workspace.google.com/products/gmail/ on 2026-10-18. Retain the full-color original and transparent background in both themes, including headings, summaries, envelope illustrations and SMS platform icons. |
| gemini-official.svg | https://www.gstatic.com/lamda/images/gemini_sparkle_aurora_33f86dc0c0257da337c63.svg | Official Gemini page asset; retain original geometry and self-contained gradient image. |
| adobe-express-official.svg | https://www.adobe.com/express/code/icons/adobe-express-logo.svg | Asset selected by the official Express homepage icon utility. Keep the original colored A symbol, remove the app-tile backdrop and crop to the symbol; retain its original color image and vectors. |
| apple-account-official.svg | https://appleid.cdn-apple.com/static/bin/cb2291598332/images/accountIcons/icon.svg | Apple Account page's official multicolor account icon, unchanged. |
| apple-music-official.svg | https://music.apple.com/ | Official inline 83×20 Apple Music wordmark; use as a single pink mask. |
| capcut-official.svg | https://www.capcut.com/ | Official inline 106×20 header mark; crop to its first 26×20 symbol. |

Assets contain no executable content or remote references. Gemini and Adobe's official SVGs include embedded color images clipped by their original vector artwork. No source artwork is fetched at runtime. Trademarks remain the property of their respective owners; use identifies the service offered by this independent shop.


## Duolingo Duo home animation

- Official page: https://www.duolingo.cn/ (retrieved 2026-10-03).
- Original Lottie: https://d35aaqx5ub95lt.cloudfront.net/lottie/splash/50bda50231c0bce1584e982cebfe8f33.json
- Local animation: duolingo-duo-home.json. Retain only the original Duo layers (comp_6) and their root parent; retain the original paths, masks, colors and keyframes. Use the official homepage loop, frames 130–290 at 30 fps. Crop the original composition to x=470, y=300, width=560, height=480 by translating its root parent.
- Local poster: duolingo-duo-home.svg, rendered from the same animation at frame 130 with the same crop. Used for small brand marks, loading/error fallback and reduced-motion preference.
- Runtime: lottie-web light SVG renderer, loaded separately; pause when offscreen or the document is hidden. No remote asset requests at runtime.
- Duolingo retains its trademark/artwork rights; the storefront identifies itself as an independent service provider.
