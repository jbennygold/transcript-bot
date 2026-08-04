# Transcript Bot — Escape Hatch Pod

Discord bot for Escape Hatch Podcast Search. Provides `/pdc` slash command for searching podcast transcripts with AI-generated summaries, feedback buttons, and Google Sheets logging.

## Architecture

- **Bot**: discord.js v14, minimal intents (Guilds only), deployed on Railway
- **Search**: Calls transcript-app backend (`/api/search`, `/api/share`)
- **Synopsis**: Claude Haiku generates 1–4 sentence summaries for Discord embeds
- **Feedback**: 👍/👎 buttons; negative feedback logged to Google Sheets via service account
- **Caching**: In-memory result cache with 15-min TTL for button interactions

## Key Files

- `scripts/discord-bot.ts` — main bot (command handling, button interactions, caching)
- `scripts/discord-register.ts` — slash command registration (global or per-guild)
- `src/share-summary.ts` — Claude synopsis generation
- `src/feedback-sheet.ts` — Google Sheets feedback logging

## Commands

```bash
npm run bot        # Start the bot
npm run register   # Register slash commands (/pdc, /pdc-note, etc.)
```

## Environment Variables

- `DISCORD_BOT_TOKEN` / `DISCORD_APP_ID` — Discord auth
- `DISCORD_GUILD_ID` — optional, for guild-scoped registration
- `DISCORD_SEARCH_BASE_URL` — backend transcript-app URL
- `ANTHROPIC_API_KEY` — Claude API for synopsis
- `DISCORD_FEEDBACK_SHEET_ID` / `DISCORD_FEEDBACK_SHEET_TAB` — Google Sheets feedback
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service account credentials
- `GITHUB_DISPATCH_TOKEN` — fine-grained GitHub PAT (scope: `jbennygold/transcript-app`, **Actions: Read and write**) used to trigger the `new-episodes.yml` workflow from `/pdc-check-episodes`
- `EPISODE_TRIGGER_ROLE` — Discord role name allowed to run `/pdc-check-episodes` (defaults to `hosts`)
- `EH_BOT_KEY` — external API key (from the app's `EH_EXTERNAL_KEYS`) used by `/pdc-note` to submit Notable Moment nominations

## Conventions

- Scripts use `node --import tsx`
- TypeScript strict mode, ES modules
- Graceful degradation when optional services (feedback sheet, API key) are unavailable
