import * as dotenv from 'dotenv';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

dotenv.config({ path: '.env.local' });
dotenv.config();

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APP_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !appId) {
  console.error('Missing DISCORD_BOT_TOKEN or DISCORD_APP_ID in env.');
  process.exit(1);
}

const command = new SlashCommandBuilder()
  .setName('pdc')
  .setDescription('Search the Escape Hatch podcast transcripts')
  .addStringOption((option) =>
    option
      .setName('query')
      .setDescription('What do you want to know?')
      .setRequired(true)
  );

const quoteCommand = new SlashCommandBuilder()
  .setName('pdc-quote')
  .setDescription('Get a random great quote from the pod');

const synopsisCommand = new SlashCommandBuilder()
  .setName('pdc-synopsis')
  .setDescription("Get a synopsis of a film in Haitch's style")
  .addStringOption((option) =>
    option.setName('movie').setDescription('Film title').setRequired(true)
  );

const tildaCommand = new SlashCommandBuilder()
  .setName('pdc-tilda')
  .setDescription('Who would Tilda Swinton play in this film?')
  .addStringOption((option) =>
    option.setName('movie').setDescription('Film title').setRequired(true)
  );

const guestCommand = new SlashCommandBuilder()
  .setName('pdc-guest')
  .setDescription('Find all episodes a guest appeared on')
  .addStringOption((option) =>
    option.setName('name').setDescription('Guest name').setRequired(true)
  );

const kevCommand = new SlashCommandBuilder()
  .setName('pdc-kev')
  .setDescription("Get Kev's question of the week for a film")
  .addStringOption((option) =>
    option.setName('movie').setDescription('Film title').setRequired(true)
  );

const statsCommand = new SlashCommandBuilder()
  .setName('pdc-stats')
  .setDescription('Get episode stats for a film or episode number')
  .addStringOption((option) =>
    option.setName('movie').setDescription('Film title').setRequired(false)
  )
  .addIntegerOption((option) =>
    option.setName('episode').setDescription('Episode number').setRequired(false)
  );

const commands = [
  command.toJSON(),
  quoteCommand.toJSON(),
  synopsisCommand.toJSON(),
  tildaCommand.toJSON(),
  guestCommand.toJSON(),
  kevCommand.toJSON(),
  statsCommand.toJSON(),
];

const rest = new REST({ version: '10' }).setToken(token);

async function register() {
  try {
    if (guildId) {
      await rest.put(Routes.applicationGuildCommands(appId, guildId), {
        body: commands,
      });
      console.log(`Registered /pdc command for guild ${guildId}.`);
    } else {
      await rest.put(Routes.applicationCommands(appId), { body: commands });
      console.log('Registered /pdc command globally.');
    }
  } catch (error) {
    console.error('Failed to register commands:', error);
    process.exit(1);
  }
}

register();
