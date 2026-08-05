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
 * One row of the app's per-comment sync outcome. `outcome` is a superset of
 * the three failure reasons the app rolls up into SyncSummary.failed:
 * `append_failed` (transient, worth retrying), `invalid_note` (text outside
 * the 5-1000 char range — will never succeed on retry), and `no_sheet_row`
 * (the episode has no row in the sheet yet). Other outcomes (appended,
 * duplicate, already_synced) are ignored here; only failures are broken out.
 */
export interface SyncResultEntry {
  discordMessageId: string;
  outcome: string;
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
  archived: boolean,
  results?: SyncResultEntry[]
): string {
  const lines = [
    `**Episode ${episode}** — considered ${summary.considered} reacted comment${summary.considered === 1 ? '' : 's'}.`,
    `• Appended: ${summary.appended}`,
    `• Already in the sheet: ${summary.duplicate}`,
    `• Already synced earlier: ${summary.alreadySynced}`,
  ];
  if (summary.failed > 0) {
    lines.push(`• ⚠️ Failed: ${summary.failed}`);
    if (results && results.length > 0) {
      const appendFailed = results.filter((r) => r.outcome === 'append_failed').length;
      const invalidNote = results.filter((r) => r.outcome === 'invalid_note').length;
      const noSheetRow = results.filter((r) => r.outcome === 'no_sheet_row').length;
      if (appendFailed > 0) {
        lines.push(`  – ${appendFailed} failed to append — run the command again to retry.`);
      }
      if (invalidNote > 0) {
        lines.push(
          `  – ${invalidNote} outside the 5-1000 character limit — won't sync until the comment is edited.`
        );
      }
      if (noSheetRow > 0) {
        lines.push(`  – ${noSheetRow} the episode has no row in the sheet yet.`);
      }
    } else {
      lines.push('  – these stay unsynced; run the command again to retry.');
    }
  }
  if (archived) {
    lines.push('_This thread is archived. Any new reaction needs the thread unarchived first._');
  }
  return lines.join('\n');
}
