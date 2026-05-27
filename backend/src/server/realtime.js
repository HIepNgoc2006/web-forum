export function createRealtimeHub() {
  const clients = new Set();

  return {
    handle(request, response) {
      response.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        'access-control-allow-origin': '*'
      });
      response.write('event: connected\ndata: {"ok":true}\n\n');
      clients.add(response);

      request.on('close', () => {
        clients.delete(response);
      });
    },

    publish(event, payload) {
      const line = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
      for (const client of clients) {
        client.write(line);
      }
    },

    count() {
      return clients.size;
    }
  };
}
