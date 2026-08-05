import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  APPROVAL_EMOJI,
  episodeFromThreadName,
  selectApprovedComments,
  formatSyncReply,
  type ThreadMessage,
} from './thread-notes.ts';

function msg(over: Partial<ThreadMessage> = {}): ThreadMessage {
  return {
    id: 'm1',
    authorTag: 'jason#0',
    authorIsBot: false,
    content: 'A moment worth recording',
    approvedByAdmin: true,
    ...over,
  };
}

test('APPROVAL_EMOJI is exactly the check mark and thumbs up', () => {
  assert.deepEqual(APPROVAL_EMOJI, ['✅', '👍']);
});

test('selectApprovedComments keeps an admin-reacted human comment', () => {
  assert.deepEqual(selectApprovedComments([msg()], 'starter'), [
    { discordMessageId: 'm1', text: 'A moment worth recording', submittedBy: 'jason#0' },
  ]);
});

test('selectApprovedComments drops comments with no admin reaction', () => {
  assert.deepEqual(selectApprovedComments([msg({ approvedByAdmin: false })], 'starter'), []);
});

test('selectApprovedComments drops bot messages', () => {
  assert.deepEqual(selectApprovedComments([msg({ authorIsBot: true })], 'starter'), []);
});

test('selectApprovedComments drops the thread starter message', () => {
  // In Discord a thread's id equals its starter message's id.
  assert.deepEqual(selectApprovedComments([msg({ id: 'starter' })], 'starter'), []);
});

test('selectApprovedComments drops empty comments', () => {
  assert.deepEqual(selectApprovedComments([msg({ content: '   ' })], 'starter'), []);
});

test('selectApprovedComments preserves order and handles a mixed thread', () => {
  const picked = selectApprovedComments(
    [
      msg({ id: 'starter', content: 'announcement' }),
      msg({ id: 'a', content: 'first moment here' }),
      msg({ id: 'b', content: 'unreacted', approvedByAdmin: false }),
      msg({ id: 'c', content: 'second moment here' }),
      msg({ id: 'd', content: 'bot chatter', authorIsBot: true }),
    ],
    'starter'
  );
  assert.deepEqual(picked.map(p => p.discordMessageId), ['a', 'c']);
});

test('episodeFromThreadName reads the episode out of the thread title', () => {
  assert.equal(episodeFromThreadName('Ep 317 · Barton Fink (1991)'), '317');
  assert.equal(episodeFromThreadName('Episode 317'), '317');
});

test('episodeFromThreadName returns null when there is no episode to read', () => {
  assert.equal(episodeFromThreadName('General chat'), null);
  assert.equal(episodeFromThreadName(''), null);
});

test('formatSyncReply reports considered, appended, and skipped counts', () => {
  const reply = formatSyncReply('317', {
    considered: 5,
    appended: 3,
    duplicate: 1,
    alreadySynced: 1,
    failed: 0,
  }, false);
  assert.match(reply, /317/);
  assert.match(reply, /5/);
  assert.match(reply, /3/);
});

test('formatSyncReply flags failures rather than reading as a clean success', () => {
  const reply = formatSyncReply('317', {
    considered: 2,
    appended: 1,
    duplicate: 0,
    alreadySynced: 0,
    failed: 1,
  }, false);
  assert.match(reply, /fail/i);
});

test('formatSyncReply says so when the thread was archived', () => {
  // Otherwise an archived thread with no new reactions looks identical to a
  // live thread nobody reacted in.
  const reply = formatSyncReply('317', {
    considered: 0,
    appended: 0,
    duplicate: 0,
    alreadySynced: 0,
    failed: 0,
  }, true);
  assert.match(reply, /archiv/i);
});
