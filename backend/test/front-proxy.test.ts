import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import net from 'node:net';
import type { AddressInfo } from 'node:net';
import test from 'node:test';

import { createProductionFrontProxy } from '../src/server/front-proxy.ts';

async function listen(server: http.Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return (server.address() as AddressInfo).port;
}

async function close(server: http.Server): Promise<void> {
  server.close();
  await once(server, 'close');
}

test('production front proxy overwrites spoofable forwarding headers', async () => {
  const target = http.createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(JSON.stringify(request.headers));
  });
  const targetPort = await listen(target);
  const proxy = createProductionFrontProxy({ targetPort });
  const proxyPort = await listen(proxy);
  try {
    const { statusCode, headers } = await new Promise<{
      statusCode: number;
      headers: Record<string, string>;
    }>((resolve, reject) => {
      const request = http.get(
        {
          hostname: '127.0.0.1',
          port: proxyPort,
          path: '/headers',
          headers: {
            host: 'forum.example',
            'x-forwarded-for': '203.0.113.50',
            'x-forwarded-host': 'attacker.example',
            'x-forwarded-proto': 'https',
            'x-real-ip': '203.0.113.50'
          }
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on('data', (chunk: Buffer) => chunks.push(chunk));
          response.once('error', reject);
          response.once('end', () => {
            resolve({
              statusCode: response.statusCode || 0,
              headers: JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, string>
            });
          });
        }
      );
      request.once('error', reject);
    });
    assert.equal(statusCode, 200);
    assert.equal(headers['x-forwarded-for'], '127.0.0.1');
    assert.equal(headers['x-real-ip'], '127.0.0.1');
    assert.equal(headers['x-forwarded-host'], 'forum.example');
    assert.equal(headers['x-forwarded-proto'], 'http');
  } finally {
    await close(proxy);
    await close(target);
  }
});

test('production front proxy sends Socket.IO upgrades directly to the sanitized backend target', async () => {
  let forwardedHeaders: http.IncomingHttpHeaders = {};
  const frontend = http.createServer((_request, response) => response.end('next'));
  const backend = http.createServer((_request, response) => response.end('polling'));
  backend.on('upgrade', (request, socket) => {
    forwardedHeaders = request.headers;
    socket.end(
      'HTTP/1.1 101 Switching Protocols\r\n' +
      'Connection: Upgrade\r\n' +
      'Upgrade: websocket\r\n' +
      'Sec-WebSocket-Accept: test\r\n\r\n'
    );
  });
  const frontendPort = await listen(frontend);
  const backendPort = await listen(backend);
  const proxy = createProductionFrontProxy({
    targetPort: frontendPort,
    realtimeTargetOrigin: 'http://127.0.0.1:' + backendPort
  });
  const proxyPort = await listen(proxy);
  try {
    const response = await new Promise<string>((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: proxyPort }, () => {
        socket.write(
          'GET /socket.io/?EIO=4&transport=websocket HTTP/1.1\r\n' +
          'Host: forum.example\r\n' +
          'Connection: Upgrade\r\n' +
          'Upgrade: websocket\r\n' +
          'X-Forwarded-For: 203.0.113.77\r\n' +
          'X-Real-IP: 203.0.113.77\r\n\r\n'
        );
      });
      const chunks: Buffer[] = [];
      socket.on('data', (chunk: Buffer) => chunks.push(chunk));
      socket.once('error', reject);
      socket.once('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    assert.match(response, /^HTTP\/1\.1 101 Switching Protocols/);
    assert.equal(forwardedHeaders['x-forwarded-for'], '127.0.0.1');
    assert.equal(forwardedHeaders['x-real-ip'], '127.0.0.1');
    assert.equal(forwardedHeaders['x-forwarded-host'], 'forum.example');
    assert.equal(forwardedHeaders.upgrade, 'websocket');
  } finally {
    await close(proxy);
    await close(backend);
    await close(frontend);
  }
});
