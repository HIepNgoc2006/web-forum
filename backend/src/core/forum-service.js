import crypto from 'node:crypto';

import { BOARDS, getBoard } from './config.js';
import { createPosterHash, verifyHcaptcha } from './security.js';
import { normalizeBody, parsePostText } from './text-format.js';

function publicPost(post) {
  return !post.isPending && !post.isDeleted;
}

function daySalt(date) {
  return date.toISOString().slice(0, 10);
}

function validateImage(image) {
  if (!image) {
    return null;
  }

  if (!image.type?.startsWith('image/')) {
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

  return {
    name: String(image.name ?? 'tai-len').slice(0, 120),
    type: image.type,
    dataUrl
  };
}

function serializeThread(thread, comments) {
  const publicComments = comments.filter((comment) => comment.threadId === thread.id && publicPost(comment));
  return {
    ...thread,
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

export function createForumService({ store, ai, realtime, now = () => new Date() }) {
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
      const fileBytes = files.reduce((total, file) => total + Buffer.byteLength(file.dataUrl ?? ''), 0);

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
      const publicThreadIds = new Set(state.threads.filter(publicPost).map((thread) => thread.id));
      const threads = state.threads
        .filter(publicPost)
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

    async listThreads(boardSlug) {
      if (!getBoard(boardSlug)) {
        const error = new Error('Không tìm thấy bảng');
        error.statusCode = 404;
        throw error;
      }

      const state = await store.read();
      return state.threads
        .filter((thread) => thread.boardSlug === boardSlug && publicPost(thread))
        .sort((left, right) => right.bumpedAt.localeCompare(left.bumpedAt))
        .map((thread) => serializeThread(thread, state.comments));
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

        if (!thread.isPending) {
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
        const thread = state.threads.find((item) => item.id === threadId && publicPost(item));
        if (!thread) {
          const error = new Error('Không tìm thấy chủ đề');
          error.statusCode = 404;
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

        if (!comment.isPending) {
          thread.bumpedAt = createdAt;
          realtime.publish('comment:created', { threadId, comment: serializeComment(comment) });
          realtime.publish('thread:bumped', { thread: serializeThread(thread, state.comments) });
        }

        return {
          status: comment.isPending ? 'pending' : 'published',
          comment: serializeComment(comment)
        };
      });
    },

    async lookupPost(globalNumber) {
      const state = await store.read();
      const number = Number(globalNumber);
      const thread = state.threads.find((item) => item.globalNumber === number && publicPost(item));
      if (thread) {
        return { type: 'thread', post: serializeThread(thread, state.comments) };
      }
      const comment = state.comments.find((item) => item.globalNumber === number && publicPost(item));
      if (comment) {
        return { type: 'comment', post: serializeComment(comment) };
      }
      const error = new Error('Không tìm thấy bài viết');
      error.statusCode = 404;
      throw error;
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

    async approvePending(id) {
      return mutate(async (state) => {
        const thread = state.threads.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (thread) {
          thread.isPending = false;
          thread.moderationStatus = 'ApprovedByAdmin';
          thread.bumpedAt = now().toISOString();
          realtime.publish('thread:created', { thread: serializeThread(thread, state.comments) });
          return serializeThread(thread, state.comments);
        }

        const comment = state.comments.find((item) => item.id === id && item.isPending && !item.isDeleted);
        if (comment) {
          const parent = state.threads.find((item) => item.id === comment.threadId && publicPost(item));
          if (!parent) {
            const error = new Error('Không tìm thấy chủ đề cha');
            error.statusCode = 404;
            throw error;
          }
          comment.isPending = false;
          comment.moderationStatus = 'ApprovedByAdmin';
          parent.bumpedAt = now().toISOString();
          realtime.publish('comment:created', { threadId: parent.id, comment: serializeComment(comment) });
          realtime.publish('thread:bumped', { thread: serializeThread(parent, state.comments) });
          return serializeComment(comment);
        }

        const error = new Error('Không tìm thấy bài đang chờ duyệt');
        error.statusCode = 404;
        throw error;
      });
    },

    async deletePending(id) {
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
