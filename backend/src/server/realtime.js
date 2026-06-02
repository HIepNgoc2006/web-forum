export function createRealtimeHub() {
  const clients = new Map();

  function clientMeta(request) {
    const url = new URL(request.url, 'http://localhost');
    return {
      boardSlug: String(url.searchParams.get('boardSlug') || '').slice(0, 80),
      threadId: String(url.searchParams.get('threadId') || '').slice(0, 120)
    };
  }

  return {
    handle(request, response) {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*'
      });
      response.write('event: connected\ndata: {"ok":true}\n\n');
      clients.set(response, clientMeta(request));

      request.on('close', () => {
        clients.delete(response);
      });
    },

    publish(event, payload) {
      const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of clients.keys()) {
        client.write(line);
      }
    },

    count(filter = {}) {
      if (!filter.boardSlug && !filter.threadId) {
        return clients.size;
      }
      return [...clients.values()].filter((meta) => {
        if (filter.boardSlug && meta.boardSlug !== filter.boardSlug) {
          return false;
        }
        if (filter.threadId && meta.threadId !== filter.threadId) {
          return false;
        }
        return true;
      }).length;
    },

    boardCounts() {
      const counts = {};
      for (const meta of clients.values()) {
        if (meta.boardSlug) {
          counts[meta.boardSlug] = (counts[meta.boardSlug] || 0) + 1;
        }
      }
      return counts;
    },

    snapshot() {
      return {
        total: clients.size,
        boards: this.boardCounts()
      };
    }
  };
}
