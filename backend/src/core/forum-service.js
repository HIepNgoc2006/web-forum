import crypto from 'node:crypto';

import { BOARDS, THREAD_LIFECYCLE, getBoard } from './config.js';
import { createPosterHash, verifyHcaptcha } from './security.js';
import { normalizeBody, parsePostText } from './text-format.js';

function publicPost(post) {
  return !post.isPending && !post.isDeleted;
}

function activePublicThread(thread) {
  return publicPost(thread) && !thread.isArchived;
}

function archivedPublicThread(thread) {
  return publicPost(thread) && thread.isArchived;
}

function publicReplyCount(state, threadId) {
  return state.comments.filter((comment) => comment.threadId === threadId && publicPost(comment)).length;
}

function archiveThreadRecord(thread, reason, archivedAt) {
  thread.isArchived = true;
  thread.archivedAt = archivedAt;
  thread.archivedReason = reason;
}

function daySalt(date) {
  return date.toISOString().slice(0, 10);
}

function dataUrlBytes(dataUrl = '') {
  const base64 = String(dataUrl).split(',')[1] || '';
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((base64.length * 3) / 4) - padding);
}

function sanitizePositiveInteger(value, max) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    return null;
  }
  return Math.min(Math.round(number), max);
}

function sanitizeFileName(name) {
  return (
    String(name ?? 'tai-len')
      .replace(/[\u0000-\u001f\u007f]/g, '')
      .replace(/[&<>"']/g, '')
      .slice(0, 120) || 'tai-len'
  );
}

function validateImage(image) {
  if (!image) {
    return null;
  }

  const type = String(image.type ?? '').toLowerCase();
  if (!type.startsWith('image/')) {
    const error = new Error('Chỉ hỗ trợ tải ảnh lên');
    error.statusCode = 415;
    throw error;
  }

  const dataUrl = image.dataUrl ?? '';
  if (!dataUrl.startsWith('data:image/')) {
    const error = new Error('Dữ liệu ảnh không hợp lệ');
    error.statusCode = 400;
    throw error;
  }

  const maxBytes = Number(process.env.MAX_IMAGE_BYTES ?? 1_500_000);
  if (Buffer.byteLength(dataUrl) > maxBytes) {
    const error = new Error('Ảnh quá lớn');
    error.statusCode = 413;
    throw error;
  }

  const safeImage = {
    name: sanitizeFileName(image.name),
    type,
    dataUrl,
    sizeBytes: sanitizePositiveInteger(image.sizeBytes, maxBytes) ?? dataUrlBytes(dataUrl)
  };

  const width = sanitizePositiveInteger(image.width, 20_000);
  const height = sanitizePositiveInteger(image.height, 20_000);
  if (width) {
    safeImage.width = width;
  }
  if (height) {
    safeImage.height = height;
  }

  return safeImage;
}

function serializeThread(thread, comments) {
  const publicComments = comments.filter((comment) => comment.threadId === thread.id && publicPost(comment));
  return {
    ...thread,
    isArchived: Boolean(thread.isArchived),
    archivedAt: thread.archivedAt ?? null,
    archivedReason: thread.archivedReason ?? null,
    bodyLines: parsePostText(thread.body),
    replyCount: publicComments.length
  };
}

function serializeComment(comment) {
  return {
    ...comment,
    bodyLines: parsePostText(comment.body)
  };
}

function compareNewestPosts(left, right) {
  const dateCompare = right.createdAt.localeCompare(left.createdAt);
  if (dateCompare !== 0) {
    return dateCompare;
  }
  return Number(right.globalNumber) - Number(left.globalNumber);
}

function incrementHotBoardMetric(metrics, boardSlug, type, createdAt) {
  const metric = metrics.get(boardSlug);
  if (!metric) {
    return;
  }

  metric.postCountLast24h += 1;
  if (type === 'thread') {
    metric.threadCountLast24h += 1;
  } else {
    metric.replyCountLast24h += 1;
  }
  if (!metric.latestActivityAt || createdAt.localeCompare(metric.latestActivityAt) > 0) {
    metric.latestActivityAt = createdAt;
  }
}

function sanitizeReason(reason) {
  return normalizeBody(reason ?? '').slice(0, 240);
}

function recordModerationAction(state, { action, actor = 'system', postType, post, reason = '', createdAt }) {
  state.moderationActions.push({
    id: crypto.randomUUID(),
    action,
    actor: String(actor || 'system').slice(0, 80),
    reason: sanitizeReason(reason),
    postType,
    postId: post.id,
    threadId: postType === 'thread' ? post.id : post.threadId,
    boardSlug: post.boardSlug,
    globalNumber: post.globalNumber,
    moderationStatus: post.moderationStatus,
    moderationLabels: post.moderationLabels ?? [],
    createdAt
  });
}

function findPublicPostByGlobalNumber(state, globalNumber) {
  const number = Number(globalNumber);
  const thread = state.threads.find((item) => item.globalNumber === number && publicPost(item));
  if (thread) {
    return { postType: 'thread', post: thread };
  }

  const comment = state.comments.find((item) => item.globalNumber === number && publicPost(item));
  if (comment) {
    return { postType: 'comment', post: comment };
  }

  return null;
}

export function createForumService({ store, ai, realtime, now = () => new Date(), lifecycle = THREAD_LIFECYCLE }) {
  async function mutate(callback) {
    const state = await store.read();
    const result = await callback(state);
    await store.write(state);
    return result;
  }

  async function requireCaptcha(token, ip) {
    const ok = await verifyHcaptcha(token, ip);
    if (!ok) {
      const error = new Error('Xác minh hCaptcha thất bại');
      error.statusCode = 403;
      throw error;
    }
  }

  function nextNumber(state) {
    const value = state.nextGlobalNumber;
    state.nextGlobalNumber += 1;
    return value;
  }

  function enforceBoardThreadCap(state, boardSlug, archivedAt) {
    const activeThreads = state.threads
      .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
      .sort((left, right) => left.bumpedAt.localeCompare(right.bumpedAt));

    while (activeThreads.length > lifecycle.maxActiveThreadsPerBoard) {
      const thread = activeThreads.shift();
      archiveThreadRecord(thread, 'board-limit', archivedAt);
      realtime.publish('thread:archived', { thread: serializeThread(thread, state.comments) });
    }
  }

  return {
    async listBoards() {
      const { BOARDS } = await import('./config.js');
      return BOARDS;
    },

    async getStats() {
      const state = await store.read();
      const publicThreads = state.threads.filter(publicPost);
      const publicComments = state.comments.filter(publicPost);
      const publicPosts = [...publicThreads, ...publicComments];
      const activeBoards = new Set(publicThreads.map((thread) => thread.boardSlug));
      const files = publicPosts.map((post) => post.image).filter(Boolean);
      const nowMs = now().getTime();
      const oneHourAgo = nowMs - 60 * 60 * 1000;
      const oneDayAgo = nowMs - 24 * 60 * 60 * 1000;
      const postTime = (post) => new Date(post.createdAt).getTime();
      const fileBytes = files.reduce((total, file) => total + (file.sizeBytes ?? dataUrlBytes(file.dataUrl)), 0);

      return {
        totalThreads: publicThreads.length,
        totalPosts: publicPosts.length,
        activeBoards: activeBoards.size,
        publicBoardCount: BOARDS.length,
        totalBoardCount: BOARDS.length,
        postCountLast24h: publicPosts.filter((post) => postTime(post) >= oneDayAgo).length,
        postCountLastHour: publicPosts.filter((post) => postTime(post) >= oneHourAgo).length,
        fileCount: files.length,
        fileMegabytes: Number((fileBytes / 1024 / 1024).toFixed(1)),
        activeContentMb: Number((fileBytes / 1024 / 1024).toFixed(1)),
        currentUsers: Math.max(1, realtime.count?.() ?? 1)
      };
    },

    async listLatestPosts(limit = 10) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 10, 20));
      const publicThreadIds = new Set(state.threads.filter(activePublicThread).map((thread) => thread.id));
      const threads = state.threads
        .filter(activePublicThread)
        .map((thread) => ({
          type: 'thread',
          threadId: thread.id,
          ...serializeThread(thread, state.comments)
        }));
      const comments = state.comments
        .filter((comment) => publicPost(comment) && publicThreadIds.has(comment.threadId))
        .map((comment) => ({
          type: 'comment',
          ...serializeComment(comment)
        }));

      return [...threads, ...comments].sort(compareNewestPosts).slice(0, safeLimit);
    },

    async listHotBoards(limit = 8) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 8, BOARDS.length));
      const oneDayAgo = now().getTime() - 24 * 60 * 60 * 1000;
      const inLast24h = (post) => new Date(post.createdAt).getTime() >= oneDayAgo;
      const activeThreadIds = new Set(state.threads.filter(activePublicThread).map((thread) => thread.id));
      const metrics = new Map(
        BOARDS.map((board) => [
          board.slug,
          {
            boardSlug: board.slug,
            postCountLast24h: 0,
            threadCountLast24h: 0,
            replyCountLast24h: 0,
            latestActivityAt: null
          }
        ])
      );

      for (const thread of state.threads) {
        if (activePublicThread(thread) && inLast24h(thread)) {
          incrementHotBoardMetric(metrics, thread.boardSlug, 'thread', thread.createdAt);
        }
      }
      for (const comment of state.comments) {
        if (publicPost(comment) && activeThreadIds.has(comment.threadId) && inLast24h(comment)) {
          incrementHotBoardMetric(metrics, comment.boardSlug, 'comment', comment.createdAt);
        }
      }

      return [...metrics.values()]
        .filter((metric) => metric.postCountLast24h > 0)
        .sort((left, right) => {
          const postCompare = right.postCountLast24h - left.postCountLast24h;
          if (postCompare !== 0) {
            return postCompare;
          }
          return (right.latestActivityAt ?? '').localeCompare(left.latestActivityAt ?? '');
        })
        .slice(0, safeLimit);
    },

    async listModerationActions(limit = 50) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      return [...state.moderationActions]
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, safeLimit);
    },

    async listReports(limit = 50) {
      const state = await store.read();
      const safeLimit = Math.max(1, Math.min(Number(limit) || 50, 200));
      return [...state.reports].sort((left, right) => right.createdAt.localeCompare(left.createdAt)).slice(0, safeLimit);
    },

    async listThreads(boardSlug) {
      if (!getBoard(boardSlug)) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const state = await store.read();
      return state.threads
        .filter((thread) => thread.boardSlug === boardSlug && activePublicThread(thread))
        .sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt))
        .map((thread) => serializeThread(thread, state.comments));
    },

    async listArchivedThreads(boardSlug) {
      if (!getBoard(boardSlug)) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const state = await store.read();
      return state.threads
        .filter((thread) => thread.boardSlug === boardSlug && archivedPublicThread(thread))
        .sort((left, right) => (right.archivedAt ?? '').localeCompare(left.archivedAt ?? ''))
        .map((thread) => serializeThread(thread, state.comments));
    },

    async archiveThread(threadId, reason = 'manual') {
      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === threadId && activePublicThread(item));
        if (!thread) {
          const error = new Error('Không tìm thấy chủ đề công khai');
          error.statusCode = 404;
          throw error;
        }

        archiveThreadRecord(thread, reason, now().toISOString());
        const serialized = serializeThread(thread, state.comments);
        realtime.publish('thread:archived', { thread: serialized });
        return serialized;
      });
    },

    async createThread({ boardSlug, body, image, captchaToken, ip, posterToken }) {
      const board = getBoard(boardSlug);
      if (!board) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      await requireCaptcha(captchaToken, ip);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const safeImage = validateImage(image);
      const moderation = await ai.moderate(normalizedBody);
      const createdAt = now().toISOString();

      return mutate(async (state) => {
        const id = crypto.randomUUID();
        const thread = {
          id,
          boardSlug,
          body: normalizedBody,
          image: safeImage,
          globalNumber: nextNumber(state),
          posterHash: createPosterHash({ ip, threadId: id, salt: daySalt(new Date(createdAt)), posterToken }),
          isPending: moderation.status === 'Flagged',
          isDeleted: false,
          moderationStatus: moderation.status,
          moderationLabels: moderation.labels ?? [],
          createdAt,
          bumpedAt: createdAt
        };
        state.threads.push(thread);
        recordModerationAction(state, {
          action: 'ai:moderate',
          actor: 'ai',
          postType: 'thread',
          post: thread,
          reason: moderation.labels?.join(', ') || moderation.status,
          createdAt
        });

        if (!thread.isPending) {
          enforceBoardThreadCap(state, boardSlug, createdAt);
          realtime.publish('thread:created', { thread: serializeThread(thread, state.comments) });
        }

        return { status: thread.isPending ? 'pending' : 'published', thread: serializeThread(thread, state.comments) };
      });
    },

    async getThread(threadId) {
      const state = await store.read();
      const thread = state.threads.find((item) => item.id === threadId && publicPost(item));
      if (!thread) {
        const error = new Error('Không tìm thấy chủ đề');
        error.statusCode = 404;
        throw error;
      }

      return {
        thread: serializeThread(thread, state.comments),
        comments: state.comments
          .filter((comment) => comment.threadId === threadId && publicPost(comment))
          .sort((left, right) => left.globalNumber - right.globalNumber)
          .map(serializeComment)
      };
    },

    async createComment({ threadId, body, captchaToken, ip, posterToken }) {
      await requireCaptcha(captchaToken, ip);
      const normalizedBody = normalizeBody(body);
      if (!normalizedBody) {
        const error = new Error('Nội dung là bắt buộc');
        error.statusCode = 400;
        throw error;
      }
      const moderation = await ai.moderate(normalizedBody);
      const createdAt = now().toISOString();

      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === threadId && activePublicThread(item));
        if (!thread) {
          const error = new Error('Không tìm thấy chủ đề');
          error.statusCode = 404;
          throw error;
        }

        const repliesBeforeCreate = publicReplyCount(state, threadId);
        if (repliesBeforeCreate >= lifecycle.replyLimit) {
          const error = new Error('Chủ đề đã đạt giới hạn phản hồi');
          error.statusCode = 409;
          throw error;
        }

        const comment = {
          id: crypto.randomUUID(),
          threadId,
          boardSlug: thread.boardSlug,
          body: normalizedBody,
          globalNumber: nextNumber(state),
          posterHash: createPosterHash({ ip, threadId, salt: daySalt(new Date(createdAt)), posterToken }),
          isPending: moderation.status === 'Flagged',
          isDeleted: false,
          moderationStatus: moderation.status,
          moderationLabels: moderation.labels ?? [],
          createdAt
        };
        state.comments.push(comment);
        recordModerationAction(state, {
          action: 'ai:moderate',
          actor: 'ai',
          postType: 'comment',
          post: comment,
          reason: moderation.labels?.join(', ') || moderation.status,
          createdAt
        });

        if (!comment.isPending) {
          realtime.publish('comment:created', { threadId, comment: serializeComment(comment) });
          if (repliesBeforeCreate < lifecycle.bumpLimit) {
            thread.bumpedAt = createdAt;
            realtime.publish('thread:bumped', { thread: serializeThread(thread, state.comments) });
          }
        }

        return {
          status: comment.isPending ? 'pending' : 'published',
          comment: serializeComment(comment)
        };
      });
    },

    async lookupPost(globalNumber) {
      const state = await store.read();
      const found = findPublicPostByGlobalNumber(state, globalNumber);
      if (found?.postType === 'thread') {
        return { type: 'thread', post: serializeThread(found.post, state.comments) };
      }
      if (found?.postType === 'comment') {
        return { type: 'comment', post: serializeComment(found.post) };
      }
      const error = new Error('Không tìm thấy bài viết');
      error.statusCode = 404;
      throw error;
    },

    async reportPost({ globalNumber, reason, ip, posterToken }) {
      const safeReason = sanitizeReason(reason);
      if (!safeReason) {
        const error = new Error('Lý do báo cáo là bắt buộc');
        error.statusCode = 400;
        throw error;
      }

      return mutate(async (state) => {
        const found = findPublicPostByGlobalNumber(state, globalNumber);
        if (!found) {
          const error = new Error('Không tìm thấy bài viết');
          error.statusCode = 404;
          throw error;
        }

        const createdAt = now().toISOString();
        const report = {
          id: crypto.randomUUID(),
          postType: found.postType,
          postId: found.post.id,
          threadId: found.postType === 'thread' ? found.post.id : found.post.threadId,
          boardSlug: found.post.boardSlug,
          globalNumber: found.post.globalNumber,
          reason: safeReason,
          reporterHash: createPosterHash({
            ip,
            threadId: `report:${found.post.globalNumber}`,
            salt: daySalt(new Date(createdAt)),
            posterToken
          }),
          status: 'open',
          createdAt
        };
        state.reports.push(report);
        return report;
      });
    },

    async listPending() {
      const state = await store.read();
      const threads = state.threads
        .filter((thread) => thread.isPending && !thread.isDeleted)
        .map((thread) => ({ type: 'thread', ...serializeThread(thread, state.comments) }));
      const comments = state.comments
        .filter((comment) => comment.isPending && !comment.isDeleted)
        .map((comment) => ({ type: 'comment', ...serializeComment(comment) }));
      return [...threads, ...comments].sort((left, right) => left.createdAt.localeCompare(right.createdAt));
    },

    async approvePending(id, { reason = '', actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const actionAt = now().toISOString();
        const thread = state.threads.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (thread) {
          thread.isPending = false;
          thread.moderationStatus = 'ApprovedByAdmin';
          thread.moderationReason = sanitizeReason(reason);
          thread.bumpedAt = actionAt;
          recordModerationAction(state, {
            action: 'admin:approve',
            actor,
            postType: 'thread',
            post: thread,
            reason,
            createdAt: actionAt
          });
          realtime.publish('thread:created', { thread: serializeThread(thread, state.comments) });
          return serializeThread(thread, state.comments);
        }

        const comment = state.comments.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (comment) {
          const parent = state.threads.find((item) => item.id === comment.threadId && activePublicThread(item));
          if (!parent) {
            const error = new Error('Không tìm thấy chủ đề cha');
            error.statusCode = 404;
            throw error;
          }
          comment.isPending = false;
          comment.moderationStatus = 'ApprovedByAdmin';
          comment.moderationReason = sanitizeReason(reason);
          parent.bumpedAt = actionAt;
          recordModerationAction(state, {
            action: 'admin:approve',
            actor,
            postType: 'comment',
            post: comment,
            reason,
            createdAt: actionAt
          });
          realtime.publish('comment:created', { threadId: parent.id, comment: serializeComment(comment) });
          realtime.publish('thread:bumped', { thread: serializeThread(parent, state.comments) });
          return serializeComment(comment);
        }

        const error = new Error('Không tìm thấy bài đang chờ duyệt');
        error.statusCode = 404;
        throw error;
      });
    },

    async deletePending(id, { reason = '', actor = 'admin' } = {}) {
      return mutate(async (state) => {
        const post =
          state.threads.find((item) => item.id === id && item.isPending && !item.isDeleted) ??
          state.comments.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (!post) {
          const error = new Error('Không tìm thấy bài đang chờ duyệt');
          error.statusCode = 404;
          throw error;
        }
        post.isDeleted = true;
        post.deletedAt = now().toISOString();
        post.deleteReason = sanitizeReason(reason);
        recordModerationAction(state, {
          action: 'admin:delete',
          actor,
          postType: post.threadId ? 'comment' : 'thread',
          post,
          reason,
          createdAt: post.deletedAt
        });
        return { ok: true };
      });
    },

    async summarizeThread(threadId) {
      const detail = await this.getThread(threadId);
      const items = [detail.thread, ...detail.comments].map((item) => ({ body: item.body }));
      return ai.summarize(items);
    },

    async summarizeBoard(boardSlug) {
      const threads = await this.listThreads(boardSlug);
      return ai.summarize(threads.map((thread) => ({ body: thread.body })));
    },

    async suggestComments(threadId) {
      const detail = await this.getThread(threadId);
      const items = [detail.thread, ...detail.comments.slice(-3)].map((item) => ({ body: item.body }));
      return ai.suggest(items);
    }
  };
}
