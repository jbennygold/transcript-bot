import { google } from 'googleapis';

type FeedbackRow = {
  timestamp: string;
  userTag: string;
  userId: string;
  query: string;
  shareUrl: string;
  summary: string | null;
  guildId?: string | null;
  channelId?: string | null;
};

function getServiceAccount(): { client_email: string; private_key: string } | null {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw);
    if (!parsed.client_email || !parsed.private_key) {
      return null;
    }
    return {
      client_email: parsed.client_email,
      private_key: String(parsed.private_key).replace(/\\n/g, '\n'),
    };
  } catch {
    return null;
  }
}

export async function appendFeedbackToSheet(row: FeedbackRow): Promise<void> {
  const sheetId = process.env.DISCORD_FEEDBACK_SHEET_ID;
  if (!sheetId) {
    throw new Error('DISCORD_FEEDBACK_SHEET_ID not set');
  }

  const serviceAccount = getServiceAccount();
  if (!serviceAccount) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON not set or invalid');
  }

  const auth = new google.auth.JWT({
    email: serviceAccount.client_email,
    key: serviceAccount.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  const sheets = google.sheets({ version: 'v4', auth });
  const tabName = process.env.DISCORD_FEEDBACK_SHEET_TAB || 'Feedback';

  await sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range: `${tabName}!A1`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: {
      values: [
        [
          row.timestamp,
          row.userTag,
          row.userId,
          row.query,
          row.shareUrl,
          row.summary ?? '',
          row.guildId ?? '',
          row.channelId ?? '',
        ],
      ],
    },
  });
}
