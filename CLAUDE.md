# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Firefly is a feature-rich static blog theme built on **Astro 7** with **Svelte 5** for interactive components. It's a fork of [Fuwari](https://github.com/saicaca/fuwari) extended with extensive features. Primary language is Chinese (Simplified) with i18n for en, zh_TW, ja, ru.

## Commands

| Command | Purpose |
|---|---|
| `pnpm dev` | Dev server at `localhost:4321` |
| `pnpm build` | Production build (icons → LQIPs → Astro build → Pagefind indexing) |
| `pnpm preview` | Preview production build |
| `pnpm check` | `astro check` for type/error checking |
| `pnpm type-check` | `tsc --noEmit --isolatedDeclarations` |
| `pnpm lint` | Biome lint + auto-fix |
| `pnpm format` | Biome format |
| `pnpm ai-summary` | Generate AI summaries for posts (auto-runs before build) |
| `pnpm new-post <filename>` | Scaffold a new blog post |

Package manager is **pnpm** (enforced). Node.js >= 22 required.

## Architecture

### Astro + Svelte Hybrid

- `.astro` components for static content and layouts
- `.svelte` components for interactive UI (search, settings, pagination, archive) — mounted with `client:load` or `client:visible`
- Svelte 5 runes syntax (`$state`, `$derived`, `$effect`, `$props`) — do not use legacy `export let` or `$:` reactive declarations
- Swup.js handles SPA-like page transitions with multiple container targets (defined in `astro.config.mjs` under `swup({ containers: [...] })`)
- Tailwind CSS 4 via `@tailwindcss/vite` plugin; global styles in `src/styles/`

### Configuration-Driven

All features are toggled/configured via TypeScript files in `src/config/`, exported through the barrel at `src/config/index.ts`. Key configs:

- `siteConfig.ts` — core site settings, theme, pagination
- `sidebarConfig.ts` — sidebar layout (left/right/both, widget ordering)
- `commentConfig.ts`, `analyticsConfig.ts`, `fontConfig.ts`, etc.

### Layout System

- `Layout.astro` — base HTML shell (head, body, theme init, analytics, Swup hooks)
- `MainGridLayout.astro` — full page grid with sidebar(s), navbar, wallpaper, footer

### Content Collections

Defined in `src/content.config.ts`:
- `posts` — blog posts (`.md`/`.mdx`) with frontmatter: title, published, tags, category, draft, pinned, password, comment, ai (AI summary), etc.
- `spec` — special pages (about, guestbook)

### Key Directories

- `src/components/` — organized by domain: `analytics/`, `comment/`, `common/`, `controls/`, `features/`, `layout/`, `misc/`, `pages/`, `widget/`
- `src/plugins/` — 15 custom remark/rehype plugins (Mermaid, PlantUML, KaTeX, GitHub cards, reading time, etc.)
- `src/i18n/` — translation keys in `i18nKey.ts`, language files in `languages/*.ts`, lookup via `translation.ts`
- `src/utils/` — content sorting, crypto (encrypted posts), date formatting, image processing/LQIP, TOC generation
- `src/pages/` — Astro file-based routing
- `scripts/` — build-time utilities (`generate-icons.js`, `generate-lqips.ts`, `generate-ai-summary.js`, `new-post.js`)

### Path Aliases (tsconfig.json)

`@components/*`, `@assets/*`, `@constants/*`, `@utils/*`, `@i18n/*`, `@layouts/*` → `./src/<dir>/*`; `@/*` → `./src/*`

## Code Style

- **Biome** enforces: tab indentation, double quotes, recommended lint rules
- Relaxed rules for `.svelte`/`.astro` files (useConst off, noUnusedVariables off)
- Commit convention: **Conventional Commits** (`feat:`, `fix:`, `chore:`, etc.)

## Build Pipeline

Multi-step: `scripts/generate-ai-summary.js` → `scripts/generate-icons.js` → `scripts/generate-lqips.ts` → `astro build` → `scripts/subset-fonts.ts` → `pagefind --site dist`

Icons/LQIP data are generated into `src/constants/` and committed. Regenerate with `pnpm icons` or `pnpm lqips`. Font subsetting (`scripts/subset-fonts.ts`) trims unused glyphs from local fonts post-build.

## AI Summary

The build pipeline includes an AI article summary step (`scripts/generate-ai-summary.js`) that runs automatically before `astro build`. It scans all `.md`/`.mdx` files in `src/content/posts/`, checks for a non-empty `ai` field in frontmatter, and calls an OpenAI-compatible API to generate summaries for posts missing one.

- Frontend component: `src/components/features/AiSummary.astro` — renders below the cover image, above the article body
- Schema field: `ai: z.string().optional().default("")` in `src/content.config.ts`
- Env vars: `OPENAI_API_KEY` (required), `OPENAI_BASE_URL`, `AI_MODEL`, `AI_MAX_CONTENT_LENGTH`, `AI_SUMMARY_MAX_TOKENS`, `AI_CONCURRENCY`
- Supports `.env` file for local dev; CI/CD platforms should set env vars directly (system env vars take priority over `.env`)
- Without `OPENAI_API_KEY`, the script skips gracefully — build continues normally without summaries
- Flags: `--force` (regenerate all), `--dry-run` (preview only)

## Notes

- URLs use `trailingSlash: "always"` — all routes end with `/`
- The `siteConfig.pages` object controls which special pages (friends, sponsor, guestbook, bangumi, gallery, anime) are enabled; disabled pages return 404 and hide their nav items

## Deployment

- **Vercel** (default, `vercel.json`)
- **Cloudflare Workers** (`wrangler.jsonc`, set `CF_WORKERS` env var)
- Static output to `dist/`

