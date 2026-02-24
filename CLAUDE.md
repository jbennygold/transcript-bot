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
npm run register   # Register /pdc slash command
```

## Environment Variables

- `DISCORD_BOT_TOKEN` / `DISCORD_APP_ID` — Discord auth
- `DISCORD_GUILD_ID` — optional, for guild-scoped registration
- `DISCORD_SEARCH_BASE_URL` — backend transcript-app URL
- `ANTHROPIC_API_KEY` — Claude API for synopsis
- `DISCORD_FEEDBACK_SHEET_ID` / `DISCORD_FEEDBACK_SHEET_TAB` — Google Sheets feedback
- `GOOGLE_SERVICE_ACCOUNT_JSON` — service account credentials

## Conventions

- Scripts use `node --import tsx`
- TypeScript strict mode, ES modules
- Graceful degradation when optional services (feedback sheet, API key) are unavailable
