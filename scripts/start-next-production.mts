import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import type http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { createProductionFrontProxy } from '../backend/src/server/front-proxy.ts';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const backendRoot = path.join(repoRoot, 'backend');
const frontendRoot = path.join(repoRoot, 'frontend');
const standaloneRoot = path.join(frontendRoot, '.next', 'standalone');

function port(name: string, fallback: number): number {
  const value = Number(process.env[name] || fallback);
  if (!Number.isInteger(value) || value < 1 || value > 65535) throw new Error(`${name} không hợp lệ`);
  return value;
}

function origin(value: string): string {
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('BACKEND_ORIGIN phải là origin HTTP(S) hợp lệ');
  }
  return parsed.origin;
}

function enabled(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === '') return fallback;
  return /^(1|true|yes|on)$/i.test(value.trim());
}

const frontendPort = port('PORT', port('FRONTEND_PORT', 3000));
const backendPort = port('BACKEND_PORT', frontendPort === 3000 ? 3003 : 3000);
const nextInternalPort = port('NEXT_INTERNAL_PORT', 3002);
if (frontendPort === nextInternalPort || backendPort === frontendPort) {
  throw new Error('FRONTEND_PORT, BACKEND_PORT và NEXT_INTERNAL_PORT phải khác nhau');
}
const backendHost = process.env.BACKEND_HOST || '127.0.0.1';
if (!['127.0.0.1', '::1', 'localhost'].includes(backendHost)) {
  throw new Error('BACKEND_HOST phải là địa chỉ loopback trong chế độ giám sát');
}
const frontendHost = process.env.FRONTEND_HOST || '0.0.0.0';
const nextInternalHost = '127.0.0.1';
const localBackendOrigin = origin(`http://${backendHost}:${backendPort}`);
const stamp = JSON.parse(readFileSync(path.join(standaloneRoot, 'backend-origin.json'), 'utf8')) as {
  backendOrigin?: string;
};
const backendOrigin = localBackendOrigin;
const startBackend = enabled(process.env.START_BACKEND, true);

type ManagedChild = { label: string; process: ChildProcess };
const children = new Set<ManagedChild>();
let frontProxy: http.Server | null = null;
let stopping = false;
let shutdownCode = 0;
let forceTimer: NodeJS.Timeout | null = null;

function writeError(message: string, cause?: unknown): void {
  const detail = cause instanceof Error ? `: ${cause.message}` : cause ? `: ${String(cause)}` : '';
  process.stderr.write(`[36chan:start] ${message}${detail}\n`);
}

function terminateChild(child: ManagedChild, signal: NodeJS.Signals): void {
  if (child.process.exitCode !== null || child.process.signalCode !== null) return;
  try {
    child.process.kill(signal);
  } catch (cause) {
    writeError(`Không thể gửi ${signal} tới ${child.label}`, cause);
  }
}

function finishWhenStopped(): void {
  if (!stopping || children.size > 0) return;
  if (forceTimer) clearTimeout(forceTimer);
  process.exit(shutdownCode);
}

function shutdown(code: number, signal: NodeJS.Signals, reason: string): void {
  if (stopping) return;
  stopping = true;
  shutdownCode = code;
  process.stderr.write(`[36chan:start] ${reason}; đang dừng toàn bộ dịch vụ.\n`);
  if (frontProxy?.listening) frontProxy.close();
  for (const child of children) terminateChild(child, signal);
  if (children.size === 0) return finishWhenStopped();
  forceTimer = setTimeout(() => {
    for (const child of children) terminateChild(child, 'SIGKILL');
    process.exit(shutdownCode || 1);
  }, 8_000);
  forceTimer.unref();
}

function supervise(
  label: string,
  command: string,
  args: string[],
  options: { cwd: string; env: NodeJS.ProcessEnv }
): ManagedChild {
  const child: ManagedChild = {
    label,
    process: spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: 'inherit',
      windowsHide: true
    })
  };
  children.add(child);
  child.process.once('error', (cause) => {
    writeError(`${label} không thể khởi động`, cause);
    shutdown(1, 'SIGTERM', `${label} gặp lỗi khởi động`);
  });
  child.process.once('exit', (code, signal) => {
    children.delete(child);
    if (!stopping) {
      const exitCode = typeof code === 'number' && code !== 0 ? code : 1;
      shutdown(
        exitCode,
        'SIGTERM',
        `${label} đã dừng ngoài dự kiến (code=${code ?? 'null'}, signal=${signal ?? 'none'})`
      );
    }
    finishWhenStopped();
  });
  return child;
}

const commonEnv: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: 'production' };
if (startBackend) {
  supervise('backend', process.execPath, ['--experimental-strip-types', path.join(backendRoot, 'server.ts')], {
    cwd: backendRoot,
    env: {
      ...commonEnv,
      PORT: String(backendPort),
      HOST: backendHost,
      TRUST_PROXY: process.env.TRUST_PROXY || '1',
      STATIC_ROOT: process.env.STATIC_ROOT || path.join(frontendRoot, 'public')
    }
  });
}
supervise('frontend', process.execPath, [path.join(standaloneRoot, 'server.js')], {
  cwd: standaloneRoot,
  env: {
    ...commonEnv,
    PORT: String(nextInternalPort),
    HOSTNAME: nextInternalHost,
    BACKEND_ORIGIN: backendOrigin,
    NEXT_TELEMETRY_DISABLED: process.env.NEXT_TELEMETRY_DISABLED || '1'
  }
});

frontProxy = createProductionFrontProxy({
  targetHost: nextInternalHost,
  targetPort: nextInternalPort,
  realtimeTargetOrigin: backendOrigin,
  onProxyError: (error) => writeError('Front proxy không kết nối được tới Next', error)
});
frontProxy.once('error', (cause) => {
  shutdown(1, 'SIGTERM', `Front proxy gặp lỗi: ${String(cause)}`);
});
frontProxy.listen(frontendPort, frontendHost, () => {
  process.stdout.write(`[36chan:start] Next public proxy: http://${frontendHost}:${frontendPort}\n`);
});

process.once('SIGINT', () => shutdown(130, 'SIGINT', 'Đã nhận SIGINT'));
process.once('SIGTERM', () => shutdown(143, 'SIGTERM', 'Đã nhận SIGTERM'));
process.once('uncaughtException', (cause) => {
  writeError('Supervisor gặp uncaughtException', cause);
  shutdown(1, 'SIGTERM', 'Supervisor gặp lỗi');
});
process.once('unhandledRejection', (cause) => {
  writeError('Supervisor gặp unhandledRejection', cause);
  shutdown(1, 'SIGTERM', 'Supervisor gặp lỗi');
});
