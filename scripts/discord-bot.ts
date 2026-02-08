import * as dotenv from 'dotenv';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Interaction,
} from 'discord.js';
import { summarizeShareAnswer } from '../src/share-summary.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const rawBaseUrl = process.env.DISCORD_SEARCH_BASE_URL
  || process.env.NEXT_PUBLIC_BASE_URL
  || 'http://localhost:3000';
const baseUrl = rawBaseUrl.replace(/\/+$/, '');

if (!token) {
  console.error('Missing DISCORD_BOT_TOKEN in env.');
  process.exit(1);
}

type TranscriptSource = {
  episodeTitle: string;
  episodeNumber?: number;
  speakers: string;
  startTimestamp: string;
  endTimestamp: string;
  text: string;
  score: number;
};

type MetadataSource = {
  film: string;
  season: number;
  episode: number;
  releaseDate: string;
  guest: string | null;
  reviewer: string;
  relevantFields: Record<string, string>;
};

type SearchResponse = {
  answer: string;
  queryType: 'factual' | 'interpretive' | 'hybrid';
  sources: {
    transcripts?: TranscriptSource[];
    metadata?: MetadataSource[];
  };
};

type CachedResult = {
  shareId: string;
  shareUrl: string;
  answer: string;
  summary: string | null;
  sources: SearchResponse['sources'];
  createdAt: number;
};

const CACHE_TTL_MS = 15 * 60 * 1000;
const resultCache = new Map<string, CachedResult>();

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 3).trim()}...`;
}

async function postJson<T>(url: string, payload: unknown): Promise<T> {
  const body = Buffer.from(JSON.stringify(payload), 'utf-8');
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': body.length.toString(),
    },
    body,
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Search failed' }));
    throw new Error(error.error || 'Search failed');
  }
  return response.json();
}

async function fetchSearch(query: string): Promise<SearchResponse> {
  return postJson<SearchResponse>(`${baseUrl}/api/search`, { query });
}

async function createShare(query: string, result: SearchResponse): Promise<{ shareUrl: string; shareId: string }> {
  const data = await postJson<{ url: string; id: string }>(`${baseUrl}/api/share`, { query, result });
  return { shareUrl: `${baseUrl}${data.url}`, shareId: data.id };
}

async function buildEmbed(query: string, result: SearchResponse, shareUrl: string, shareId: string) {
  const summary = await summarizeShareAnswer({
    query,
    answer: result.answer,
    maxChars: 300,
  });

  const embed = new EmbedBuilder()
    .setTitle(query)
    .setDescription(summary || trimText(result.answer, 300))
    .setColor(0x5865f2)
    .setFooter({ text: 'Escape Hatch Podcast Search' });

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Open full answer')
      .setStyle(ButtonStyle.Link)
      .setURL(shareUrl)
  );

  return { embed, buttons, summary };
}

function cacheResult(shareId: string, shareUrl: string, result: SearchResponse, summary: string | null) {
  resultCache.set(shareId, {
    shareId,
    shareUrl,
    answer: result.answer,
    summary,
    sources: result.sources,
    createdAt: Date.now(),
  });
}

function getCached(shareId: string): CachedResult | null {
  const cached = resultCache.get(shareId);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    resultCache.delete(shareId);
    return null;
  }
  return cached;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once('ready', () => {
  console.log(`Discord bot logged in as ${client.user?.tag}`);
  console.log(`DISCORD_SEARCH_BASE_URL: ${baseUrl}`);
  if (baseUrl.includes('localhost')) {
    console.warn('Warning: Bot is configured to use localhost. Set DISCORD_SEARCH_BASE_URL to your public transcript-app URL.');
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand() && interaction.commandName === 'pdc') {
      const query = interaction.options.getString('query', true);

      await interaction.deferReply();

      const result = await fetchSearch(query);
      const { shareUrl, shareId } = await createShare(query, result);
      const { embed, buttons, summary } = await buildEmbed(query, result, shareUrl, shareId);

      cacheResult(shareId, shareUrl, result, summary || null);

      await interaction.editReply({ embeds: [embed], components: [buttons] });
      return;
    }

    if (interaction.isButton()) {
      await interaction.reply({
        content: 'This action is no longer available.',
        ephemeral: true,
      });
    }
  } catch (error) {
    console.error('Discord interaction failed:', error);
    if (interaction.isRepliable()) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message });
      } else {
        await interaction.reply({ content: message, ephemeral: true });
      }
    }
  }
});

client.login(token);
