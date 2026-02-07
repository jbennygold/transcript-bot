import * as dotenv from 'dotenv';
import { REST, Routes, SlashCommandBuilder } from 'discord.js';

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

const commands = [command.toJSON()];

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
