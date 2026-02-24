import * as dotenv from 'dotenv';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  Interaction,
  MessageFlags,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';
import { summarizeShareAnswer } from '../src/share-summary.js';
import { appendFeedbackToSheet } from '../src/feedback-sheet.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const feedbackSheetId = process.env.DISCORD_FEEDBACK_SHEET_ID;
const rawBaseUrl = process.env.DISCORD_SEARCH_BASE_URL
  || process.env.NEXT_PUBLIC_BASE_URL
  || 'http://localhost:3000';
const baseUrl = rawBaseUrl.replace(/\/+$/, '');
const clippyBlobBaseUrl = process.env.CLIPPY_BLOB_BASE_URL || process.env.BLOB_BASE_URL || '';

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

type ClipIndex = {
  generatedAt: string;
  totalEpisodes: number;
  totalClips: number;
  episodes: {
    episodeNumber: number;
    episodeName: string;
    film: string;
    clipCount: number;
    analyzedAt: string;
  }[];
};

type PublishedClip = {
  id: string;
  episodeNumber: number;
  episodeName: string;
  title: string;
  description: string;
  category: string;
  speakers: string[];
  startTimestamp: string;
  endTimestamp: string;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
  rank: number;
  confidence: number;
  transcriptExcerpt: string;
  clipBlobUrl: string;
};

type PublishedAnalysis = {
  episodeNumber: number;
  episodeName: string;
  film: string;
  analyzedAt: string;
  modelUsed: string;
  clips: PublishedClip[];
};

type CachedResult = {
  shareId: string;
  shareUrl: string;
  query: string;
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

function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

function buildContextualQuery(userQuery: string, cached: CachedResult): string {
  const contextAnswer = cached.summary || cached.answer;
  const trimmedAnswer = trimText(contextAnswer, 600);
  const trimmedQuestion = trimText(cached.query, 200);

  return `${userQuery}\n\nContext:\nQ: ${trimmedQuestion}\nA: ${trimmedAnswer}`;
}

function buildClippyUrl(path: string): string | null {
  if (!clippyBlobBaseUrl) {
    return null;
  }
  const base = clippyBlobBaseUrl.replace(/\/+$/, '');
  return `${base}/clippy/${path}`;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function pickRandomEpisode(index: ClipIndex) {
  let target = Math.floor(Math.random() * index.totalClips);
  for (const episode of index.episodes) {
    if (target < episode.clipCount) {
      return episode;
    }
    target -= episode.clipCount;
  }
  return index.episodes[index.episodes.length - 1];
}

function pickRandomClip(clips: PublishedClip[]): PublishedClip {
  const preferred = clips.filter((clip) => clip.confidence >= 0.7);
  const pool = preferred.length > 0 ? preferred : clips;
  return pool[Math.floor(Math.random() * pool.length)];
}

async function getRandomClip(): Promise<{ clip: PublishedClip; analysis: PublishedAnalysis }> {
  const indexUrl = buildClippyUrl('index.json');
  if (!indexUrl) {
    throw new Error('Clippy blob base URL not configured');
  }

  const index = await fetchJson<ClipIndex>(indexUrl);
  if (!index.episodes.length || index.totalClips === 0) {
    throw new Error('No clips available');
  }

  const episode = pickRandomEpisode(index);
  const analysisUrl = buildClippyUrl(`analyses/episode_${episode.episodeNumber}.json`);
  if (!analysisUrl) {
    throw new Error('Clippy blob base URL not configured');
  }

  const analysis = await fetchJson<PublishedAnalysis>(analysisUrl);
  if (!analysis.clips.length) {
    throw new Error('No clips available');
  }

  return { clip: pickRandomClip(analysis.clips), analysis };
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
  let summary: string | null = null;
  try {
    summary = await summarizeShareAnswer({
      query,
      answer: result.answer,
      maxChars: 900,
    });
  } catch (error) {
    console.warn('Failed to generate summary:', error);
  }

  const embed = new EmbedBuilder()
    .setTitle(trimText(query, 256))
    .setDescription(summary || trimText(result.answer, 900))
    .setColor(0x5865f2)
    .setFooter({ text: 'Escape Hatch Podcast Search' });

  const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Open full answer')
      .setStyle(ButtonStyle.Link)
      .setURL(shareUrl)
  );

  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(`pdc_follow:${shareId}`)
      .setLabel('Follow-up')
      .setStyle(ButtonStyle.Primary)
  );

  buttons.addComponents(
    new ButtonBuilder()
      .setCustomId(`pdc_up:${shareId}`)
      .setLabel('👍')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`pdc_down:${shareId}`)
      .setLabel('👎')
      .setStyle(ButtonStyle.Secondary)
  );

  return { embed, buttons, summary };
}

function buildQuoteEmbed(clip: PublishedClip, analysis: PublishedAnalysis) {
  const description = trimText(clip.transcriptExcerpt || clip.description || clip.title, 900);
  const embed = new EmbedBuilder()
    .setTitle(trimText(clip.title || 'Random Quote', 256))
    .setDescription(description)
    .setColor(0x5865f2)
    .addFields(
      {
        name: 'Episode',
        value: `#${analysis.episodeNumber} — ${analysis.episodeName}`,
      },
      {
        name: 'Category',
        value: clip.category || 'quote',
        inline: true,
      },
      {
        name: 'Duration',
        value: formatDuration(clip.durationSeconds),
        inline: true,
      }
    )
    .setFooter({ text: 'Escape Hatch Podcast Quote' });

  if (clip.speakers?.length) {
    embed.addFields({
      name: 'Speakers',
      value: trimText(clip.speakers.join(', '), 100),
    });
  }

  if (clip.clipBlobUrl) {
    const buttons = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setLabel('Listen')
        .setStyle(ButtonStyle.Link)
        .setURL(clip.clipBlobUrl)
    );
    return { embed, buttons };
  }

  return { embed, buttons: null };
}

function cacheResult(
  shareId: string,
  shareUrl: string,
  query: string,
  result: SearchResponse,
  summary: string | null
) {
  resultCache.set(shareId, {
    shareId,
    shareUrl,
    query,
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

client.once('clientReady', () => {
  console.log(`Discord bot logged in as ${client.user?.tag}`);
  console.log(`DISCORD_SEARCH_BASE_URL: ${baseUrl}`);
  if (feedbackSheetId) {
    console.log(`DISCORD_FEEDBACK_SHEET_ID: ${feedbackSheetId}`);
  }
  if (baseUrl.includes('localhost')) {
    console.warn('Warning: Bot is configured to use localhost. Set DISCORD_SEARCH_BASE_URL to your public transcript-app URL.');
  }
});

client.on('interactionCreate', async (interaction: Interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName === 'pdc') {
        const query = interaction.options.getString('query', true);

        await interaction.deferReply();

        const result = await fetchSearch(query);
        const { shareUrl, shareId } = await createShare(query, result);
        const { embed, buttons, summary } = await buildEmbed(query, result, shareUrl, shareId);

        cacheResult(shareId, shareUrl, query, result, summary || null);

        await interaction.editReply({ embeds: [embed], components: [buttons] });
        return;
      }

      if (interaction.commandName === 'pdc-quote') {
        await interaction.deferReply();

        try {
          const { clip, analysis } = await getRandomClip();
          const { embed, buttons } = buildQuoteEmbed(clip, analysis);
          if (buttons) {
            await interaction.editReply({ embeds: [embed], components: [buttons] });
          } else {
            await interaction.editReply({ embeds: [embed] });
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Quote unavailable';
          await interaction.editReply({
            content: `${message}. Set CLIPPY_BLOB_BASE_URL or BLOB_BASE_URL and publish clips.`,
          });
        }
        return;
      }
    }

    if (interaction.isButton()) {
      const [action, shareId] = interaction.customId.split(':');

      if (action === 'pdc_follow') {
        const modal = new ModalBuilder()
          .setCustomId(`pdc_follow_modal:${shareId}:${interaction.message?.id ?? ''}`)
          .setTitle('Ask a follow-up');

        const input = new TextInputBuilder()
          .setCustomId('followup_query')
          .setLabel('Your follow-up question')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., What did they say about the guest?')
          .setMaxLength(120)
          .setRequired(true);

        const row = new ActionRowBuilder<TextInputBuilder>().addComponents(input);
        modal.addComponents(row);

        await interaction.showModal(modal);
        return;
      }

      const cached = getCached(shareId);
      if (!cached) {
        await interaction.reply({
          content: 'This result has expired. Please run the command again.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      if (action === 'pdc_up') {
        await interaction.reply({ content: 'Thanks for the feedback!', flags: MessageFlags.Ephemeral });
        return;
      }

      if (action === 'pdc_down') {
        await interaction.reply({ content: "Thanks \u2014 we'll use this to improve.", flags: MessageFlags.Ephemeral });
        if (!feedbackSheetId) {
          console.warn('DISCORD_FEEDBACK_SHEET_ID not set; feedback not stored.');
          return;
        }
        try {
          await appendFeedbackToSheet({
            timestamp: new Date().toISOString(),
            userTag: interaction.user.tag,
            userId: interaction.user.id,
            query: cached.query,
            shareUrl: cached.shareUrl,
            summary: cached.summary,
            guildId: interaction.guildId,
            channelId: interaction.channelId,
          });
        } catch (error) {
          console.error('Failed to store feedback in sheet:', error);
        }
      }
    }

    if (interaction.isModalSubmit()) {
      if (!interaction.customId.startsWith('pdc_follow_modal:')) {
        return;
      }

      const modalPayload = interaction.customId.slice('pdc_follow_modal:'.length);
      const [shareId, messageId] = modalPayload.split(':');
      if (!shareId) {
        await interaction.reply({
          content: 'This result has expired. Please run the command again.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const query = interaction.fields.getTextInputValue('followup_query').trim();
      if (!query) {
        await interaction.reply({ content: 'Please enter a follow-up question.', flags: MessageFlags.Ephemeral });
        return;
      }

      const cached = getCached(shareId);
      if (!cached) {
        await interaction.reply({
          content: 'This result has expired. Please run the command again.',
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.deferReply({ ephemeral: true });

      const contextualQuery = buildContextualQuery(query, cached);
      const result = await fetchSearch(contextualQuery);
      const { shareUrl, shareId: nextShareId } = await createShare(query, result);
      const { embed, buttons, summary } = await buildEmbed(query, result, shareUrl, nextShareId);

      cacheResult(nextShareId, shareUrl, query, result, summary || null);

      let updated = false;
      if (interaction.channel && messageId) {
        try {
          const message = await interaction.channel.messages.fetch(messageId);
          await message.edit({ embeds: [embed], components: [buttons] });
          updated = true;
        } catch (error) {
          console.warn('Failed to update original message:', error);
        }
      }

      if (updated) {
        await interaction.editReply({ content: 'Updated the answer above.' });
      } else {
        await interaction.editReply({ content: 'Here is your follow-up:', embeds: [embed], components: [buttons] });
      }
    }
  } catch (error) {
    console.error('Discord interaction failed:', error);
    if (interaction.isRepliable()) {
      const message = error instanceof Error ? error.message : 'Unexpected error';
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply({ content: message });
      } else {
        await interaction.reply({ content: message, flags: MessageFlags.Ephemeral });
      }
    }
  }
});

client.login(token);
