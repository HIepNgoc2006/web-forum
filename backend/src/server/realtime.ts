import crypto from 'node:crypto';
import type http from 'node:http';

import { Server as SocketIoServer } from 'socket.io';

import { createMemoryRealtimeState } from './realtime-state.ts';
import type {
  RealtimeConnectionMetadata,
  RealtimeState
} from './realtime-state.ts';

const DEFAULT_MAX_CLIENTS = 1000;
const DEFAULT_HEARTBEAT_MS = 25_000;
const DEFAULT_WARN_PCT = 75;
const DEFAULT_CRITICAL_PCT = 90;
const DEFAULT_MAX_BACKPRESSURE_EVENTS = 3;
const DEFAULT_SOCKET_MAX_BUFFER_BYTES = 1_000_000;
const DEFAULT_MAX_CONNECTIONS_PER_ADDRESS = 20;
const DEFAULT_CONNECTION_ATTEMPTS_PER_MINUTE = 60;

type RealtimeCapacityStatus = 'ok' | 'warning' | 'critical';
type RealtimeInterval = ReturnType<typeof setInterval> | { unref?: () => void };

interface RealtimeClient {
  writeHead(code: number, headers: Record<string, string | number>): unknown;
  write(line: string): boolean | void;
  end(data?: string): unknown;
}

interface RealtimeRequest {
  url: string;
  headers?: Record<string, string | string[] | undefined>;
  socket?: { remoteAddress?: string };
  on(event: 'close', handler: () => void): unknown;
}

interface ClientMeta {
  boardSlug: string;
  threadId: string;
  backpressureEvents: number;
  addressHash: string;
}

interface EventScope {
  boardSlug: string;
  threadId: string;
}

interface RealtimeMetricsState {
  totalConnections: number;
  rejected: number;
  dropped: number;
  heartbeats: number;
  backpressureEvents: number;
  backpressureDrops: number;
  socketConnections: number;
  socketDisconnects: number;
  socketAuthFailures: number;
}

export type RealtimeIdentity = {
  userId: string;
  username: string;
  role: string;
  permissions: string[];
};

export type RealtimeAuthentication = {
  account?: RealtimeIdentity;
  moderator?: RealtimeIdentity;
  identities?: RealtimeIdentity[];
};

export type RealtimeAuthenticator = (tokens: {
  accountToken: string;
  adminToken: string;
}) => Promise<RealtimeAuthentication>;

export type RealtimeAttachOptions = {
  authenticate: RealtimeAuthenticator;
  service: any;
};

export interface RealtimeHubOptions {
  maxClients?: number;
  heartbeatMs?: number;
  warnPct?: number;
  criticalPct?: number;
  maxBackpressureEvents?: number;
  setIntervalFn?: (callback: () => void, ms: number) => RealtimeInterval;
  clearIntervalFn?: (timer: RealtimeInterval) => void;
  state?: RealtimeState;
  serverId?: string;
  logger?: (entry: Record<string, unknown>) => void;
  socketMaxBufferBytes?: number;
  maxConnectionsPerAddress?: number;
  connectionAttemptsPerMinute?: number;
}

export interface RealtimeConnectionFilter {
  boardSlug?: string;
  threadId?: string;
}

export interface RealtimeSnapshot {
  total: number;
  boards: Record<string, number>;
}

export interface RealtimeMetrics {
  clients: number;
  boards: Record<string, number>;
  maxClients: number;
  capacityUsedPct: number;
  capacityStatus: RealtimeCapacityStatus;
  heartbeatMs: number;
  maxBackpressureEvents: number;
  totalConnections: number;
  rejected: number;
  dropped: number;
  heartbeats: number;
  backpressureEvents: number;
  backpressureDrops: number;
  sseClients: number;
  socketClients: number;
  socketConnections: number;
  socketDisconnects: number;
  socketAuthFailures: number;
  state: ReturnType<RealtimeState['health']>;
  thresholds: {
    warnPct: number;
    criticalPct: number;
  };
}

export interface RealtimeHub {
  handle(request: RealtimeRequest, response: RealtimeClient): void;
  attach(server: http.Server, options: RealtimeAttachOptions): Promise<void>;
  publish(event: string, payload: unknown): void;
  count(filter?: RealtimeConnectionFilter): number;
  boardCounts(): Record<string, number>;
  snapshot(): RealtimeSnapshot;
  metrics(): RealtimeMetrics;
  close(): Promise<void>;
}

function positiveIntEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

function percentEnv(name: string, fallback: number): number {
  const value = positiveIntEnv(name, fallback);
  return Math.max(1, Math.min(value, 100));
}

function eventScope(payload: unknown): EventScope {
  const record = payload && typeof payload === 'object' ? payload as Record<string, any> : {};
  const thread = record.thread && typeof record.thread === 'object' ? record.thread : {};
  const comment = record.comment && typeof record.comment === 'object' ? record.comment : {};
  const post = record.post && typeof record.post === 'object' ? record.post : {};
  return {
    boardSlug: String(
      record.boardSlug
      || thread.boardSlug
      || comment.boardSlug
      || post.boardSlug
      || record.board?.slug
      || ''
    ),
    threadId: String(
      record.threadId
      || thread.id
      || comment.threadId
      || post.threadId
      || ''
    )
  };
}

function clientAcceptsEvent(meta: ClientMeta, scope: EventScope): boolean {
  if (meta.boardSlug && (!scope.boardSlug || meta.boardSlug !== scope.boardSlug)) {
    return false;
  }
  if (meta.threadId && (!scope.threadId || meta.threadId !== scope.threadId)) {
    return false;
  }
  return true;
}

function payloadRecord(payload: unknown): Record<string, any> {
  return payload && typeof payload === 'object' ? payload as Record<string, any> : {};
}

function participantIds(payload: unknown): string[] {
  const values = payloadRecord(payload).participantIds;
  return Array.isArray(values)
    ? [...new Set(values.map(String).filter(Boolean))]
    : [];
}

function privateRealtimeEvent(event: string): boolean {
  return (
    event.startsWith('dm:') ||
    event.startsWith('notification:') ||
    event.startsWith('moderation:') ||
    event.startsWith('presence:')
  );
}

function connectionAddressHash(address: string): string {
  const secret = process.env.MODERATION_FINGERPRINT_SECRET || process.env.JWT_SECRET || '36chan-dev-realtime';
  return crypto.createHmac('sha256', secret).update(address).digest('hex');
}

function socketErrorPayload(error: unknown): Record<string, unknown> {
  const typed = error instanceof Error ? error : new Error(String(error));
  const statusCode = Number(typed.statusCode) || 500;
  return {
    ok: false,
    error: statusCode >= 500 ? 'Realtime request failed.' : typed.message || 'Realtime request failed.',
    statusCode,
    ...(typed.retryAfter ? { retryAfterMs: Math.max(1, Number(typed.retryAfter) * 1000) } : {})
  };
}

/**
 * SSE used to send Access-Control-Allow-Origin: *. Restrict to:
 * - explicit CORS_ORIGINS / ALLOWED_ORIGINS allowlist when set
 * - same Host as the request (same-origin SPA)
 * - any Origin only outside production (local Vite proxy / smoke)
 */
function resolveSseCorsOrigin(request: RealtimeRequest): string | null {
  const configuredOrigins = [
    process.env.CORS_ORIGINS,
    process.env.ALLOWED_ORIGINS,
    process.env.SOCKET_IO_ORIGINS
  ].filter(Boolean).join(',');
  const allowlist = String(configuredOrigins)
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (process.env.APP_BASE_URL) {
    try {
      allowlist.push(new URL(process.env.APP_BASE_URL).origin);
    } catch {
      // Production secret validation reports an invalid public base URL.
    }
  }
  const originHeader = request.headers?.origin;
  const origin = String(Array.isArray(originHeader) ? originHeader[0] : originHeader || '').trim();
  if (!origin) {
    return null;
  }
  if (allowlist.length > 0) {
    return allowlist.includes(origin) ? origin : null;
  }
  try {
    const originHost = new URL(origin).host;
    const hostHeader = request.headers?.host;
    const requestHost = String(Array.isArray(hostHeader) ? hostHeader[0] : hostHeader || '');
    if (requestHost && originHost === requestHost) {
      return origin;
    }
  } catch {
    // invalid Origin
  }
  if (process.env.NODE_ENV !== 'production') {
    return origin;
  }
  return null;
}

export function createRealtimeHub(options: RealtimeHubOptions = {}): RealtimeHub {
  const clients = new Map<RealtimeClient, ClientMeta>();
  const state = options.state ?? createMemoryRealtimeState();
  const serverId = options.serverId || crypto.randomUUID();
  const logger = options.logger ?? (() => {});
  const maxClients = options.maxClients ?? positiveIntEnv('SSE_MAX_CLIENTS', DEFAULT_MAX_CLIENTS);
  const heartbeatMs = options.heartbeatMs ?? positiveIntEnv('SSE_HEARTBEAT_MS', DEFAULT_HEARTBEAT_MS);
  const configuredWarnPct = options.warnPct ?? percentEnv('SSE_WARN_PCT', DEFAULT_WARN_PCT);
  const configuredCriticalPct = options.criticalPct ?? percentEnv('SSE_CRITICAL_PCT', DEFAULT_CRITICAL_PCT);
  const warnPct = Math.min(configuredWarnPct, configuredCriticalPct);
  const criticalPct = Math.max(configuredWarnPct, configuredCriticalPct);
  const maxBackpressureEvents = options.maxBackpressureEvents ??
    positiveIntEnv('SSE_MAX_BACKPRESSURE_EVENTS', DEFAULT_MAX_BACKPRESSURE_EVENTS);
  const socketMaxBufferBytes = options.socketMaxBufferBytes ??
    positiveIntEnv('SOCKET_IO_MAX_BUFFER_BYTES', DEFAULT_SOCKET_MAX_BUFFER_BYTES);
  const maxConnectionsPerAddress = options.maxConnectionsPerAddress ??
    positiveIntEnv('REALTIME_MAX_CONNECTIONS_PER_IP', DEFAULT_MAX_CONNECTIONS_PER_ADDRESS);
  const connectionAttemptsPerMinute = options.connectionAttemptsPerMinute ??
    positiveIntEnv('REALTIME_CONNECTION_ATTEMPTS_PER_MINUTE', DEFAULT_CONNECTION_ATTEMPTS_PER_MINUTE);
  const addressConnections = new Map<string, number>();
  const startInterval: (callback: () => void, ms: number) => RealtimeInterval =
    options.setIntervalFn ?? ((callback, ms) => setInterval(callback, ms));
  const stopInterval: (timer: RealtimeInterval) => void =
    options.clearIntervalFn ?? ((timer) => clearInterval(timer as ReturnType<typeof setInterval>));

  const metricsState: RealtimeMetricsState = {
    totalConnections: 0,
    rejected: 0,
    dropped: 0,
    heartbeats: 0,
    backpressureEvents: 0,
    backpressureDrops: 0,
    socketConnections: 0,
    socketDisconnects: 0,
    socketAuthFailures: 0
  };

  let heartbeatTimer: RealtimeInterval | null = null;
  let presenceTimer: RealtimeInterval | null = null;
  let io: SocketIoServer | null = null;
  let stopFanoutSubscription: (() => Promise<void>) | null = null;

  function logRealtimeWarning(event: string, error: unknown): void {
    logger({
      level: 'warn',
      event,
      message: error instanceof Error ? error.message : String(error)
    });
  }

  function socketCount(): number {
    return io?.of('/').sockets.size ?? 0;
  }

  function addressFromRequest(headers: Record<string, any> = {}, directAddress = ''): string {
    const direct = String(directAddress || 'unknown');
    const forwarded = String(headers['x-forwarded-for'] || '').split(',')[0].trim();
    return forwarded && /^(127\.|::1$|::ffff:127\.)/.test(direct) ? forwarded : direct;
  }

  function reserveAddress(addressHash: string): boolean {
    const current = addressConnections.get(addressHash) || 0;
    if (current >= maxConnectionsPerAddress) {
      return false;
    }
    addressConnections.set(addressHash, current + 1);
    return true;
  }

  function releaseAddress(addressHash: string): void {
    const current = addressConnections.get(addressHash) || 0;
    if (current <= 1) {
      addressConnections.delete(addressHash);
    } else {
      addressConnections.set(addressHash, current - 1);
    }
  }

  function socketMetadata(socket: any): RealtimeConnectionMetadata {
    const identity = socket.data.account || socket.data.moderator;
    return {
      connectionId: serverId + ':' + socket.id,
      socketId: socket.id,
      serverId,
      ...(identity?.userId ? { userId: identity.userId } : {}),
      ...(identity?.username ? { username: identity.username } : {}),
      ...(identity?.role ? { role: identity.role } : {}),
      connectedAt: String(socket.data.connectedAt || new Date().toISOString()),
      transport: String(socket.conn?.transport?.name || 'unknown').slice(0, 32),
      origin: String(socket.handshake?.headers?.origin || '').slice(0, 300),
      userAgent: String(socket.handshake?.headers?.['user-agent'] || '').slice(0, 300),
      addressHash: String(socket.data.addressHash || connectionAddressHash('unknown'))
    };
  }

  function clientMeta(request: RealtimeRequest): ClientMeta {
    const url = new URL(request.url, 'http://localhost');
    return {
      boardSlug: String(url.searchParams.get('boardSlug') || '').slice(0, 80),
      threadId: String(url.searchParams.get('threadId') || '').slice(0, 120),
      backpressureEvents: 0,
      addressHash: connectionAddressHash(addressFromRequest(request.headers, request.socket?.remoteAddress))
    };
  }

  function dropClient(client: RealtimeClient): void {
    if (!clients.has(client)) {
      return;
    }
    const meta = clients.get(client);
    clients.delete(client);
    if (meta) {
      releaseAddress(meta.addressHash);
    }
    metricsState.dropped += 1;
    try {
      client.end();
    } catch {
      // client already closed
    }
  }

  // Returns true if the write succeeded, false if it failed (client dropped).
  function safeWrite(client: RealtimeClient, line: string): boolean {
    try {
      const flushed = client.write(line);
      const meta = clients.get(client);
      if (flushed === false) {
        metricsState.backpressureEvents += 1;
        if (meta) {
          meta.backpressureEvents += 1;
          if (meta.backpressureEvents >= maxBackpressureEvents) {
            metricsState.backpressureDrops += 1;
            dropClient(client);
            return false;
          }
        }
      } else if (meta) {
        meta.backpressureEvents = 0;
      }
      return true;
    } catch {
      dropClient(client);
      return false;
    }
  }

  function ensureHeartbeat(): void {
    if (heartbeatTimer || heartbeatMs <= 0) {
      return;
    }
    heartbeatTimer = startInterval(() => {
      metricsState.heartbeats += 1;
      for (const client of [...clients.keys()]) {
        safeWrite(client, `: ping ${Date.now()}\n\n`);
      }
    }, heartbeatMs);
    if (typeof heartbeatTimer?.unref === 'function') {
      heartbeatTimer.unref();
    }
  }

  function maybeStopHeartbeat(): void {
    if (heartbeatTimer && clients.size === 0) {
      stopInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
  }

  function boardCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const meta of clients.values()) {
      if (meta.boardSlug) {
        counts[meta.boardSlug] = (counts[meta.boardSlug] || 0) + 1;
      }
    }
    for (const socket of io?.of('/').sockets.values() ?? []) {
      const boardSlug = String(socket.data.boardSlug || '');
      if (boardSlug) {
        counts[boardSlug] = (counts[boardSlug] || 0) + 1;
      }
    }
    return counts;
  }

  function socketMatchesFilter(socket: any, filter: RealtimeConnectionFilter): boolean {
    if (filter.boardSlug && String(socket.data.boardSlug || '') !== filter.boardSlug) {
      return false;
    }
    if (filter.threadId && String(socket.data.threadId || '') !== filter.threadId) {
      return false;
    }
    return true;
  }

  function publishSocketLocal(event: string, payload: unknown): void {
    if (!io) {
      return;
    }
    if (event.startsWith('dm:') || event.startsWith('notification:')) {
      const recipients = participantIds(payload);
      if (!recipients.length) {
        return;
      }
      let target = io.to('user:' + recipients[0]);
      for (const userId of recipients.slice(1)) {
        target = target.to('user:' + userId);
      }
      target.emit(event, payload);
      return;
    }
    if (event.startsWith('moderation:')) {
      io.to('moderation').emit(event, payload);
      return;
    }
    if (event.startsWith('presence:')) {
      return;
    }
    io.emit(event, payload);
  }

  function publishSseLocal(event: string, payload: unknown): void {
    if (privateRealtimeEvent(event)) {
      return;
    }
    const line = 'event: ' + event + '\ndata: ' + JSON.stringify(payload) + '\n\n';
    const scope = eventScope(payload);
    for (const [client, meta] of [...clients.entries()]) {
      if (clientAcceptsEvent(meta, scope)) {
        safeWrite(client, line);
      }
    }
  }

  function publishLocal(event: string, payload: unknown): void {
    publishSocketLocal(event, payload);
    publishSseLocal(event, payload);
  }

  function socketAction(
    socket: any,
    acknowledge: unknown,
    action: (identity: RealtimeIdentity) => Promise<unknown>
  ): void {
    const reply = typeof acknowledge === 'function' ? acknowledge as (value: unknown) => void : () => {};
    void Promise.resolve().then(async () => {
      await socket.data.reauthenticate?.(false);
      const identity = socket.data.account as RealtimeIdentity | undefined;
      if (!identity?.userId) {
        const error = new Error('Vui lòng đăng nhập tài khoản');
        error.statusCode = 401;
        throw error;
      }
      return action(identity);
    }).then(
      (data) => reply({ ok: true, data }),
      (error) => {
        if ((Number((error as any)?.statusCode) || 500) >= 500) {
          logRealtimeWarning('realtime.socket.action_failed', error);
        }
        reply(socketErrorPayload(error));
      }
    );
  }

  function ensurePresenceRefresh(): void {
    if (presenceTimer) {
      return;
    }
    const refreshMs = Math.max(5_000, Math.floor(state.health().presenceTtlSeconds * 500));
    presenceTimer = startInterval(() => {
      if (!io) {
        return;
      }
      for (const socket of io.of('/').sockets.values()) {
        void Promise.resolve()
          .then(() => socket.data.reauthenticate?.(true))
          .then(() => state.refreshConnection(socketMetadata(socket)))
          .catch((error) => {
            logRealtimeWarning('realtime.presence.refresh_failed', error);
            socket.disconnect(true);
          });
      }
    }, refreshMs);
    if (typeof presenceTimer?.unref === 'function') {
      presenceTimer.unref();
    }
  }

  async function attachSocketServer(
    server: http.Server,
    { authenticate, service }: RealtimeAttachOptions
  ): Promise<void> {
    if (io) {
      return;
    }
    io = new SocketIoServer(server, {
      path: '/socket.io',
      // Next normalizes the proxied polling URL to `/socket.io` (without the
      // trailing slash). Accept that form while remaining compatible with the
      // default Socket.IO client path, `/socket.io/`.
      addTrailingSlash: false,
      serveClient: false,
      maxHttpBufferSize: socketMaxBufferBytes,
      allowRequest(request, callback) {
        const origin = request.headers.origin;
        const allowed = !origin || Boolean(resolveSseCorsOrigin(request as unknown as RealtimeRequest));
        callback(allowed ? null : 'Origin is not allowed.', allowed);
      }
    });

    io.use(async (socket, next) => {
      if (clients.size + socketCount() >= maxClients) {
        metricsState.rejected += 1;
        next(new Error('Realtime đã đạt giới hạn kết nối. Thử lại sau.'));
        return;
      }
      const addressHash = connectionAddressHash(addressFromRequest(
        socket.handshake?.headers,
        socket.handshake?.address
      ));
      if (!reserveAddress(addressHash)) {
        metricsState.rejected += 1;
        next(new Error('Quá nhiều kết nối realtime từ nguồn này.'));
        return;
      }
      socket.data.addressHash = addressHash;
      socket.data.addressReserved = true;
      const releaseReservedAddress = () => {
        if (socket.data.addressReserved) {
          socket.data.addressReserved = false;
          releaseAddress(addressHash);
        }
      };
      socket.conn.once('close', releaseReservedAddress);
      try {
        const rate = await state.consumeUserRateLimit('address:' + addressHash, 'connect', {
          limit: connectionAttemptsPerMinute,
          windowMs: 60_000
        });
        if (!rate.allowed) {
          metricsState.rejected += 1;
          releaseReservedAddress();
          const error = new Error('Quá nhiều lần kết nối realtime. Thử lại sau.');
          (error as any).data = {
            ok: false,
            error: error.message,
            statusCode: 429,
            retryAfterMs: rate.retryAfterMs
          };
          next(error);
          return;
        }
      } catch {
        releaseReservedAddress();
        next(new Error('Realtime tạm thời không khả dụng.'));
        return;
      }
      const auth = payloadRecord(socket.handshake.auth);
      const accountToken = String(auth.accountToken || '').slice(0, 12_000);
      const adminToken = String(auth.adminToken || '').slice(0, 12_000);
      if (!accountToken && !adminToken) {
        socket.data.identities = [];
        socket.data.authTokens = null;
        next();
        return;
      }
      try {
        const result = await authenticate({ accountToken, adminToken });
        socket.data.account = result.account;
        socket.data.moderator = result.moderator;
        socket.data.identities = result.identities || [result.account, result.moderator].filter(Boolean);
        socket.data.authTokens = { accountToken, adminToken };
        socket.data.authValidatedAt = Date.now();
        next();
      } catch (error) {
        releaseReservedAddress();
        metricsState.socketAuthFailures += 1;
        const authError = new Error('Phiên realtime không hợp lệ.');
        (authError as any).data = socketErrorPayload(error);
        next(authError);
      }
    });

    io.on('connection', (socket) => {
      metricsState.socketConnections += 1;
      socket.data.connectedAt = new Date().toISOString();
      socket.data.reauthenticate = async (force = false) => {
        const tokens = socket.data.authTokens;
        if (!tokens) {
          return;
        }
        if (!force && Date.now() - Number(socket.data.authValidatedAt || 0) < 15_000) {
          return;
        }
        const previousUserId = String(socket.data.account?.userId || '');
        const result = await authenticate(tokens);
        const nextUserId = String(result.account?.userId || '');
        if (previousUserId && nextUserId !== previousUserId) {
          throw new Error('Phiên realtime đã thay đổi tài khoản.');
        }
        const previousIdentityIds = new Set<string>(
          (Array.isArray(socket.data.identities) ? socket.data.identities : [])
            .map((identity) => String(identity?.userId || ''))
            .filter(Boolean)
        );
        const nextIdentities = result.identities || [result.account, result.moderator].filter(Boolean);
        const nextIdentityIds = new Set<string>(
          nextIdentities.map((identity) => String(identity?.userId || '')).filter(Boolean)
        );
        for (const userId of previousIdentityIds) {
          if (!nextIdentityIds.has(userId)) {
            await socket.leave('user:' + userId);
          }
        }
        for (const userId of nextIdentityIds) {
          if (!previousIdentityIds.has(userId)) {
            await socket.join('user:' + userId);
          }
        }
        socket.data.account = result.account;
        socket.data.moderator = result.moderator;
        socket.data.identities = nextIdentities;
        socket.data.authValidatedAt = Date.now();
        if (result.moderator?.userId) {
          await socket.join('moderation');
        } else {
          await socket.leave('moderation');
        }
      };
      const identities = Array.isArray(socket.data.identities)
        ? socket.data.identities as RealtimeIdentity[]
        : [];
      for (const identity of identities) {
        if (identity?.userId) {
          void socket.join('user:' + identity.userId);
        }
      }
      if (socket.data.moderator?.userId) {
        void socket.join('moderation');
      }
      void state.trackConnection(socketMetadata(socket)).catch((error) => {
        logRealtimeWarning('realtime.presence.track_failed', error);
      });

      socket.conn.on('upgrade', () => {
        void state.refreshConnection(socketMetadata(socket)).catch((error) => {
          logRealtimeWarning('realtime.connection_metadata.refresh_failed', error);
        });
      });

      socket.on('realtime:scope', (payload, acknowledge) => {
        const scope = payloadRecord(payload);
        socket.data.boardSlug = String(scope.boardSlug || '').slice(0, 80);
        socket.data.threadId = String(scope.threadId || '').slice(0, 120);
        if (typeof acknowledge === 'function') {
          acknowledge({ ok: true });
        }
      });

      socket.on('dm:send', (payload, acknowledge) => {
        socketAction(socket, acknowledge, (identity) => {
          const body = payloadRecord(payload);
          return service.sendDmMessage(
            identity.userId,
            String(body.conversationId || '').slice(0, 160),
            {
              body: body.body,
              replyToId: body.replyToId
            }
          );
        });
      });

      socket.on('dm:typing', (payload, acknowledge) => {
        socketAction(socket, acknowledge, (identity) => {
          const conversationId = String(payloadRecord(payload).conversationId || '').slice(0, 160);
          return service.signalDmTyping(identity.userId, conversationId);
        });
      });

      socket.on('dm:read', (payload, acknowledge) => {
        socketAction(socket, acknowledge, (identity) => {
          const conversationId = String(payloadRecord(payload).conversationId || '').slice(0, 160);
          return service.markDmConversationRead(identity.userId, conversationId);
        });
      });

      socket.on('presence:query', (payload, acknowledge) => {
        socketAction(socket, acknowledge, async (identity) => {
          const rate = await state.consumeUserRateLimit(identity.userId, 'presence-query', {
            limit: 30,
            windowMs: 60_000
          });
          if (!rate.allowed) {
            const error = new Error('Quá nhiều yêu cầu trạng thái. Thử lại sau.');
            error.statusCode = 429;
            error.retryAfter = Math.max(1, Math.ceil(rate.retryAfterMs / 1000));
            throw error;
          }
          const ids = payloadRecord(payload).userIds;
          const userIds = Array.isArray(ids)
            ? [...new Set(ids.map(String).filter(Boolean))].slice(0, 50)
            : [];
          return { presence: await state.getPresence(userIds) };
        });
      });

      socket.once('disconnect', () => {
        metricsState.socketDisconnects += 1;
        const metadata = socketMetadata(socket);
        void state.removeConnection(metadata.connectionId, metadata.userId).catch((error) => {
          logRealtimeWarning('realtime.presence.remove_failed', error);
        });
      });

      socket.emit('connected', {
        ok: true,
        authenticated: Boolean(socket.data.account?.userId),
        moderation: Boolean(socket.data.moderator?.userId)
      });
    });

    stopFanoutSubscription = await state.subscribeFanout((envelope) => {
      if (envelope.originId !== serverId) {
        publishLocal(envelope.event, envelope.payload);
      }
    });
    ensurePresenceRefresh();
  }

  return {
    handle(request: RealtimeRequest, response: RealtimeClient): void {
      if (clients.size + socketCount() >= maxClients) {
        metricsState.rejected += 1;
        response.writeHead(503, {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': Math.ceil(heartbeatMs / 1000) || 5,
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'strict-origin-when-cross-origin'
        });
        response.end(JSON.stringify({ ok: false, error: 'Realtime đã đạt giới hạn kết nối. Thử lại sau.' }));
        return;
      }
      const meta = clientMeta(request);
      if (!reserveAddress(meta.addressHash)) {
        metricsState.rejected += 1;
        response.writeHead(429, {
          'content-type': 'application/json; charset=utf-8',
          'retry-after': 60,
          'x-content-type-options': 'nosniff',
          'x-frame-options': 'DENY',
          'referrer-policy': 'strict-origin-when-cross-origin'
        });
        response.end(JSON.stringify({ ok: false, error: 'Quá nhiều kết nối realtime từ nguồn này.' }));
        return;
      }

      const headers: Record<string, string | number> = {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache, no-transform',
        connection: 'keep-alive',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'strict-origin-when-cross-origin'
      };
      const corsOrigin = resolveSseCorsOrigin(request);
      if (corsOrigin) {
        headers['access-control-allow-origin'] = corsOrigin;
        headers.vary = 'Origin';
      }
      response.writeHead(200, headers);
      clients.set(response, meta);
      metricsState.totalConnections += 1;
      ensureHeartbeat();
      // Register before the first write so a client that throws on write is
      // dropped through the normal path instead of escaping handle().
      safeWrite(response, 'event: connected\ndata: {"ok":true}\n\n');

      request.on('close', () => {
        if (clients.delete(response)) {
          releaseAddress(meta.addressHash);
        }
        maybeStopHeartbeat();
      });
    },

    attach: attachSocketServer,

    publish(event: string, payload: unknown): void {
      publishLocal(event, payload);
      void state.publishFanout({
        originId: serverId,
        event,
        payload,
        publishedAt: new Date().toISOString()
      }).catch((error) => {
        logRealtimeWarning('realtime.fanout.publish_failed', error);
      });
    },

    count(filter: RealtimeConnectionFilter = {}): number {
      if (!filter.boardSlug && !filter.threadId) {
        return clients.size + socketCount();
      }
      const sseCount = [...clients.values()].filter((meta) => {
        if (filter.boardSlug && meta.boardSlug !== filter.boardSlug) {
          return false;
        }
        if (filter.threadId && meta.threadId !== filter.threadId) {
          return false;
        }
        return true;
      }).length;
      const scopedSocketCount = [...(io?.of('/').sockets.values() ?? [])]
        .filter((socket) => socketMatchesFilter(socket, filter))
        .length;
      return sseCount + scopedSocketCount;
    },

    boardCounts,

    snapshot(): RealtimeSnapshot {
      return {
        total: clients.size + socketCount(),
        boards: boardCounts()
      };
    },

    // Production metrics + alert thresholds for /api/health and dashboards.
    metrics(): RealtimeMetrics {
      const clientsCount = clients.size + socketCount();
      const capacityUsedPct = maxClients > 0 ? Math.round((clientsCount / maxClients) * 100) : 0;
      let capacityStatus: RealtimeCapacityStatus = 'ok';
      if (capacityUsedPct >= criticalPct) {
        capacityStatus = 'critical';
      } else if (capacityUsedPct >= warnPct) {
        capacityStatus = 'warning';
      }
      return {
        clients: clientsCount,
        boards: boardCounts(),
        maxClients,
        capacityUsedPct,
        capacityStatus,
        heartbeatMs,
        maxBackpressureEvents,
        totalConnections: metricsState.totalConnections,
        rejected: metricsState.rejected,
        dropped: metricsState.dropped,
        heartbeats: metricsState.heartbeats,
        backpressureEvents: metricsState.backpressureEvents,
        backpressureDrops: metricsState.backpressureDrops,
        sseClients: clients.size,
        socketClients: socketCount(),
        socketConnections: metricsState.socketConnections,
        socketDisconnects: metricsState.socketDisconnects,
        socketAuthFailures: metricsState.socketAuthFailures,
        state: state.health(),
        thresholds: { warnPct, criticalPct }
      };
    },

    // Stop the heartbeat timer (used on shutdown and in tests).
    async close(): Promise<void> {
      if (heartbeatTimer) {
        stopInterval(heartbeatTimer);
        heartbeatTimer = null;
      }
      if (presenceTimer) {
        stopInterval(presenceTimer);
        presenceTimer = null;
      }
      if (stopFanoutSubscription) {
        await stopFanoutSubscription();
        stopFanoutSubscription = null;
      }
      for (const client of [...clients.keys()]) {
        try {
          client.end();
        } catch {
          // already closed
        }
      }
      clients.clear();
      addressConnections.clear();
      const attachedIo = io;
      io = null;
      if (attachedIo) {
        await new Promise<void>((resolve) => {
          attachedIo.close(() => resolve());
        });
      }
      await state.close();
    }
  };
}
