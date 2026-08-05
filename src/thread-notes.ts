/**
 * Pure helpers for /pdc-sync-notes.
 *
 * Deliberately free of discord.js imports: the command handler flattens
 * discord.js objects into ThreadMessage records, and everything decision-shaped
 * happens here where it can be tested without a gateway connection.
 */

/** An admin adds one of these to a comment to approve it. Nothing else counts. */
export const APPROVAL_EMOJI = ['✅', '👍'] as const;

export interface ThreadMessage {
  id: string;
  authorTag: string;
  authorIsBot: boolean;
  content: string;
  /** True when ✅ or 👍 was added by a user holding the admin role. */
  approvedByAdmin: boolean;
}

export interface SyncComment {
  discordMessageId: string;
  text: string;
  submittedBy: string;
}

export interface SyncSummary {
  considered: number;
  appended: number;
  duplicate: number;
  alreadySynced: number;
  failed: number;
}

/**
 * Keep only human comments an admin reacted to.
 *
 * `starterMessageId` is the thread's own id — in Discord a thread and its
 * starter message share one id — so the announcement itself is never collected.
 */
export function selectApprovedComments(
  messages: ThreadMessage[],
  starterMessageId: string
): SyncComment[] {
  const picked: SyncComment[] = [];
  for (const m of messages) {
    if (m.id === starterMessageId) continue;
    if (m.authorIsBot) continue;
    if (!m.approvedByAdmin) continue;
    const text = m.content.trim();
    if (text === '') continue;
    picked.push({ discordMessageId: m.id, text, submittedBy: m.authorTag });
  }
  return picked;
}

/**
 * Read the episode number out of a thread name written by threadNameFor()
 * in the app repo — "Ep 317 · Film" or "Episode 317". Returns null rather than
 * guessing: writing a note to the wrong sheet row is worse than asking for ep:.
 */
export function episodeFromThreadName(name: string): string | null {
  const m = /^Ep(?:isode)?\s+(\d+)/i.exec(String(name ?? '').trim());
  return m ? m[1] : null;
}

export function formatSyncReply(
  episode: string,
  summary: SyncSummary,
  archived: boolean
): string {
  const lines = [
    `**Episode ${episode}** — considered ${summary.considered} reacted comment${summary.considered === 1 ? '' : 's'}.`,
    `• Appended: ${summary.appended}`,
    `• Already in the sheet: ${summary.duplicate}`,
    `• Already synced earlier: ${summary.alreadySynced}`,
  ];
  if (summary.failed > 0) {
    lines.push(`• ⚠️ Failed: ${summary.failed} — these stay unsynced; run the command again to retry.`);
  }
  if (archived) {
    lines.push('_This thread is archived. Any new reaction needs the thread unarchived first._');
  }
  return lines.join('\n');
}
