# Transcript Bot

Standalone Discord bot for Escape Hatch Podcast Search.

## Requirements
- `DISCORD_BOT_TOKEN`
- `DISCORD_APP_ID`
- `DISCORD_GUILD_ID` (optional, for fast per-guild registration)
- `DISCORD_SEARCH_BASE_URL` (base URL of the transcript app, e.g. https://transcript.yourdomain.com)
- `ANTHROPIC_API_KEY` (for synopsis generation)
- `DISCORD_FEEDBACK_SHEET_ID` (Google Sheet ID for 👎 feedback logging)
- `DISCORD_FEEDBACK_SHEET_TAB` (optional, default: `Feedback`)
- `GOOGLE_SERVICE_ACCOUNT_JSON` (service account JSON with Sheets access)

## Setup
1) Install dependencies
```
npm install
```

2) Register the slash command
```
npm run register
```

3) Start the bot
```
npm run bot
```

## Notes
- The bot calls `/api/search` and `/api/share` on `DISCORD_SEARCH_BASE_URL`.
- Results are cached in memory for 15 minutes to support button actions.
