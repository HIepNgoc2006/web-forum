import { escapeHtml } from './format';
import type { AnyRecord } from './types';

export function pollHtml(poll: AnyRecord | null | undefined, canVote = true): string {
  if (!poll?.options?.length) {
    return '';
  }
  const totalVotes = Number(poll.totalVotes || 0);
  return `
    <div class="poll-box">
      <div class="poll-title">Thăm dò ẩn danh · ${totalVotes} vote</div>
      ${poll.options
        .map((option) => {
          const votes = Number(option.votes || 0);
          const percent = totalVotes ? Math.round((votes / totalVotes) * 100) : 0;
          return `
            <div class="poll-option">
              <button data-poll-option="${escapeHtml(option.id)}" type="button" ${canVote ? '' : 'disabled'}>
                ${escapeHtml(option.text)}
              </button>
              <span class="poll-meter"><span style="width: ${percent}%"></span></span>
              <span>${votes} (${percent}%)</span>
            </div>
          `;
        })
        .join('')}
    </div>
  `;
}