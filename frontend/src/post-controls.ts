import { POST_REACTIONS } from './constants';
import { escapeHtml } from './format';
import { readReaction, readVote } from './storage';
import type { AnyRecord } from './types';

export function reactionControlHtml(post: AnyRecord = {}): string {
  const reactions = post.reactions && typeof post.reactions === 'object' ? post.reactions : {};
  const myReaction = readReaction(post.globalNumber);
  return `
    <span class="post-reactions" aria-label="Cảm xúc bài viết">
      ${POST_REACTIONS.map((item) => {
        const count = Math.max(0, Number(reactions[item.type]) || 0);
        const active = myReaction === item.type ? ' active' : '';
        return `
          <button class="reaction-button${active}" data-reaction="${item.type}" data-reaction-target="${post.globalNumber}" type="button" title="${escapeHtml(item.label)}" aria-label="${escapeHtml(item.label)}">
            <span aria-hidden="true">${item.icon}</span>${count ? `<span class="reaction-count">${count}</span>` : ''}
          </button>
        `;
      }).join('')}
    </span>
  `;
}

export function voteControlHtml(post: AnyRecord = {}): string {
  const votes = post.votes || { up: 0, down: 0, score: 0 };
  const score = Number(votes.score ?? (Number(votes.up || 0) - Number(votes.down || 0)));
  const myVote = readVote(post.globalNumber);
  return `
    <span class="post-votes">
      <button class="vote-button vote-up${myVote === 'up' ? ' active' : ''}" data-vote="up" data-vote-target="${post.globalNumber}" type="button" title="Upvote" aria-label="Upvote">▲</button>
      <span class="vote-score" title="Điểm">${score}</span>
      <button class="vote-button vote-down${myVote === 'down' ? ' active' : ''}" data-vote="down" data-vote-target="${post.globalNumber}" type="button" title="Downvote" aria-label="Downvote">▼</button>
    </span>
  `;
}