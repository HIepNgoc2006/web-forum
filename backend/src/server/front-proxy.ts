import http from 'node:http';
import https from 'node:https';

const HOP_BY_HOP_HEADERS = [
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade'
] as const;

type FrontProxyOptions = {
  targetHost?: string;
  targetPort: number;
  realtimeTargetOrigin?: string;
  onProxyError?: (error: Error) => void;
};

type ProxyTarget = {
  protocol: 'http:' | 'https:';
  hostname: string;
  port: number;
};

function firstHeader(value: string | string[] | undefined): string {
  return String(Array.isArray(value) ? value[0] ?? '' : value ?? '').trim();
}

function normalizedHost(value: string): string {
  if (!value || /[\\/@?#\s]/.test(value)) return '';
  try {
    const parsed = new URL(`http://${value}`);
    return parsed.username || parsed.password || parsed.pathname !== '/' ? '' : parsed.host;
  } catch {
    return '';
  }
}

function proxyTarget(origin: string): ProxyTarget {
  const parsed = new URL(origin);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error('Realtime proxy target must be an HTTP(S) origin.');
  }
  return {
    protocol: parsed.protocol as 'http:' | 'https:',
    hostname: parsed.hostname,
    port: Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
  };
}

function isBackendPath(requestUrl: string | undefined): boolean {
  try {
    const pathname = new URL(requestUrl || '/', 'http://localhost').pathname;
    return (
      pathname === '/socket.io' ||
      pathname.startsWith('/socket.io/') ||
      pathname === '/api' ||
      pathname.startsWith('/api/') ||
      pathname === '/events' ||
      pathname.startsWith('/events/') ||
      pathname === '/uploads' ||
      pathname.startsWith('/uploads/') ||
      pathname === '/feeds' ||
      pathname.startsWith('/feeds/')
    );
  } catch {
    return false;
  }
}

function requestTransport(target: ProxyTarget) {
  return target.protocol === 'https:' ? https : http;
}

export function normalizedRemoteAddress(value: string | undefined): string {
  const address = String(value || '').trim();
  return address.startsWith('::ffff:') ? address.slice(7) : address || '127.0.0.1';
}

export function forwardedRequestHeaders(request: http.IncomingMessage): http.OutgoingHttpHeaders {
  const headers: http.OutgoingHttpHeaders = { ...request.headers };
  for (const name of HOP_BY_HOP_HEADERS) delete headers[name];
  delete headers.forwarded;
  delete headers['x-forwarded-for'];
  delete headers['x-forwarded-host'];
  delete headers['x-forwarded-port'];
  delete headers['x-forwarded-proto'];
  delete headers['x-real-ip'];

  const host = normalizedHost(firstHeader(request.headers.host));
  if (host) {
    headers.host = host;
    headers['x-forwarded-host'] = host;
  } else {
    delete headers.host;
  }
  const remoteAddress = normalizedRemoteAddress(request.socket.remoteAddress);
  headers['x-forwarded-for'] = remoteAddress;
  headers['x-real-ip'] = remoteAddress;
  headers['x-forwarded-proto'] = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http';
  return headers;
}

function forwardedResponseHeaders(headers: http.IncomingHttpHeaders): http.OutgoingHttpHeaders {
  const forwarded: http.OutgoingHttpHeaders = { ...headers };
  for (const name of HOP_BY_HOP_HEADERS) delete forwarded[name];
  return forwarded;
}

export function createProductionFrontProxy({
  targetHost = '127.0.0.1',
  targetPort,
  realtimeTargetOrigin,
  onProxyError = () => {}
}: FrontProxyOptions): http.Server {
  const frontendTarget: ProxyTarget = {
    protocol: 'http:',
    hostname: targetHost,
    port: targetPort
  };
  const realtimeTarget = realtimeTargetOrigin ? proxyTarget(realtimeTargetOrigin) : null;

  const server = http.createServer((request, response) => {
    const target = realtimeTarget && isBackendPath(request.url)
      ? realtimeTarget
      : frontendTarget;
    const proxyRequest = requestTransport(target).request(
      {
        hostname: target.hostname,
        port: target.port,
        method: request.method,
        path: request.url || '/',
        headers: forwardedRequestHeaders(request)
      },
      (proxyResponse) => {
        response.writeHead(
          proxyResponse.statusCode || 502,
          proxyResponse.statusMessage,
          forwardedResponseHeaders(proxyResponse.headers)
        );
        proxyResponse.pipe(response);
      }
    );
    proxyRequest.on('error', (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      onProxyError(error);
      if (response.headersSent) {
        response.destroy(error);
      } else {
        response.writeHead(502, { 'content-type': 'text/plain; charset=utf-8', connection: 'close' });
        response.end('Upstream service is unavailable.');
      }
    });
    request.once('aborted', () => proxyRequest.destroy());
    response.once('close', () => {
      if (!response.writableEnded) proxyRequest.destroy();
    });
    request.pipe(proxyRequest);
  });
  server.on('upgrade', (request, clientSocket, head) => {
    if (!realtimeTarget || !isBackendPath(request.url)) {
      clientSocket.end('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
      return;
    }
    const headers = forwardedRequestHeaders(request);
    headers.connection = 'Upgrade';
    headers.upgrade = firstHeader(request.headers.upgrade) || 'websocket';
    const proxyRequest = requestTransport(realtimeTarget).request({
      hostname: realtimeTarget.hostname,
      port: realtimeTarget.port,
      method: request.method,
      path: request.url || '/socket.io/',
      headers
    });

    proxyRequest.once('upgrade', (proxyResponse, proxySocket, proxyHead) => {
      const responseHeaders = forwardedResponseHeaders(proxyResponse.headers);
      responseHeaders.connection = 'Upgrade';
      responseHeaders.upgrade = firstHeader(proxyResponse.headers.upgrade) || 'websocket';
      let headerBlock =
        'HTTP/1.1 ' + (proxyResponse.statusCode || 101) + ' ' +
        (proxyResponse.statusMessage || 'Switching Protocols') + '\r\n';
      for (const [name, value] of Object.entries(responseHeaders)) {
        if (value === undefined) {
          continue;
        }
        for (const item of Array.isArray(value) ? value : [value]) {
          headerBlock += name + ': ' + String(item) + '\r\n';
        }
      }
      clientSocket.write(headerBlock + '\r\n');
      if (proxyHead.length) {
        clientSocket.write(proxyHead);
      }
      if (head.length) {
        proxySocket.write(head);
      }
      proxySocket.once('error', () => clientSocket.destroy());
      clientSocket.once('error', () => proxySocket.destroy());
      proxySocket.pipe(clientSocket);
      clientSocket.pipe(proxySocket);
    });
    proxyRequest.once('response', (proxyResponse) => {
      const statusCode = proxyResponse.statusCode || 502;
      clientSocket.write(
        'HTTP/1.1 ' + statusCode + ' ' + (proxyResponse.statusMessage || 'Bad Gateway') +
        '\r\nConnection: close\r\n\r\n'
      );
      proxyResponse.pipe(clientSocket);
    });
    proxyRequest.once('error', (cause) => {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      onProxyError(error);
      clientSocket.destroy(error);
    });
    proxyRequest.end();
  });
  server.on('clientError', (_error, socket) => {
    if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });
  return server;
}
