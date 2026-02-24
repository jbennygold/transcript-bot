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
const clippyWebUrl = (process.env.CLIPPY_WEB_URL || 'https://clippy-web-nine.vercel.app').replace(/\/+$/, '');

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

type CachedClip = {
  clip: PublishedClip;
  episodeNumber: number;
  createdAt: number;
};
const clipCache = new Map<string, CachedClip>();

function getCachedClip(clipId: string): CachedClip | null {
  const cached = clipCache.get(clipId);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > CACHE_TTL_MS) {
    clipCache.delete(clipId);
    return null;
  }
  return cached;
}

function trimText(text: string, maxChars: number): string {
  if (text.length <= maxChars) {
    return text;
  }
  return `${text.slice(0, maxChars - 3).trim()}...`;
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
    .addFields({
      name: 'Episode',
      value: `#${analysis.episodeNumber} — ${analysis.episodeName}`,
    })
    .setFooter({ text: 'Escape Hatch Podcast Quote' });

  const components: ActionRowBuilder<ButtonBuilder>[] = [];

  // Row 1: Link button (must be in its own row — can't mix link + non-link)
  const linkRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setLabel('Listen')
      .setStyle(ButtonStyle.Link)
      .setURL(`${clippyWebUrl}/clip/${clip.id}`)
  );
  components.push(linkRow);

  // Row 2: Vote + note buttons
  const actionRow = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`quote_up:${clip.id}`)
      .setLabel('\u{1F44D}')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`quote_down:${clip.id}`)
      .setLabel('\u{1F44E}')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`quote_note:${clip.id}`)
      .setLabel('Add note')
      .setStyle(ButtonStyle.Secondary),
  );
  components.push(actionRow);

  return { embed, components };
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
          clipCache.set(clip.id, {
            clip,
            episodeNumber: analysis.episodeNumber,
            createdAt: Date.now(),
          });
          const { embed, components } = buildQuoteEmbed(clip, analysis);
          await interaction.editReply({ embeds: [embed], components });
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

      // --- Clip vote buttons ---
      if (action === 'quote_up' || action === 'quote_down') {
        const clipId = interaction.customId.split(':').slice(1).join(':');
        const cachedClip = getCachedClip(clipId);
        if (!cachedClip) {
          await interaction.reply({
            content: 'This clip has expired. Use /pdc-quote again.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }
        try {
          await postJson(`${clippyWebUrl}/api/feedback`, {
            clipId,
            episodeNumber: cachedClip.episodeNumber,
            vote: action === 'quote_up' ? 'up' : 'down',
            comment: '',
            source: 'discord',
          });
          await interaction.reply({ content: 'Thanks for the feedback!', flags: MessageFlags.Ephemeral });
        } catch (error) {
          console.error('Failed to submit clip feedback:', error);
          await interaction.reply({
            content: 'Failed to submit feedback. Try again later.',
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

      if (action === 'quote_note') {
        const clipId = interaction.customId.split(':').slice(1).join(':');
        const cachedClip = getCachedClip(clipId);
        if (!cachedClip) {
          await interaction.reply({
            content: 'This clip has expired. Use /pdc-quote again.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`quote_note_modal:${clipId}`)
          .setTitle('Rate this clip');

        const voteInput = new TextInputBuilder()
          .setCustomId('quote_vote')
          .setLabel('Vote (up or down)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('up or down')
          .setMaxLength(4)
          .setRequired(true);

        const noteInput = new TextInputBuilder()
          .setCustomId('quote_comment')
          .setLabel('Note (optional)')
          .setStyle(TextInputStyle.Short)
          .setPlaceholder('e.g., Great timing')
          .setMaxLength(200)
          .setRequired(false);

        modal.addComponents(
          new ActionRowBuilder<TextInputBuilder>().addComponents(voteInput),
          new ActionRowBuilder<TextInputBuilder>().addComponents(noteInput),
        );

        await interaction.showModal(modal);
        return;
      }

      // --- Search result buttons ---
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
      // --- Clip note modal ---
      if (interaction.customId.startsWith('quote_note_modal:')) {
        const clipId = interaction.customId.slice('quote_note_modal:'.length);
        const cachedClip = getCachedClip(clipId);
        if (!cachedClip) {
          await interaction.reply({
            content: 'This clip has expired. Use /pdc-quote again.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const voteRaw = interaction.fields.getTextInputValue('quote_vote').trim().toLowerCase();
        if (voteRaw !== 'up' && voteRaw !== 'down') {
          await interaction.reply({
            content: 'Vote must be "up" or "down". Please try again.',
            flags: MessageFlags.Ephemeral,
          });
          return;
        }

        const comment = interaction.fields.getTextInputValue('quote_comment').trim();

        try {
          await postJson(`${clippyWebUrl}/api/feedback`, {
            clipId,
            episodeNumber: cachedClip.episodeNumber,
            vote: voteRaw,
            comment,
            source: 'discord',
          });
          await interaction.reply({ content: 'Feedback saved!', flags: MessageFlags.Ephemeral });
        } catch (error) {
          console.error('Failed to submit clip feedback:', error);
          await interaction.reply({
            content: 'Failed to submit feedback. Try again later.',
            flags: MessageFlags.Ephemeral,
          });
        }
        return;
      }

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
