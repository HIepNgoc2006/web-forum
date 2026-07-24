export function isOwnDmMessageEvent(
  eventName: string,
  senderId: unknown,
  accountId: unknown
): boolean {
  return (
    eventName === 'dm:message' &&
    Boolean(senderId) &&
    String(senderId) === String(accountId || '')
  );
}

export function shouldLoadDmConversationsForRealtime(
  eventName: string,
  locationHash: string
): boolean {
  return eventName === 'dm:message' || String(locationHash || '').startsWith('#messages');
}

export function createTrailingAsyncCoalescer<Input>(
  run: (input: Input) => Promise<void>
): (input: Input) => Promise<void> {
  let running: Promise<void> | null = null;
  let queuedInput: Input;
  let hasQueuedInput = false;

  async function drain(firstInput: Input): Promise<void> {
    let input = firstInput;
    while (true) {
      await run(input);
      if (!hasQueuedInput) {
        return;
      }
      input = queuedInput;
      hasQueuedInput = false;
    }
  }

  return (input: Input) => {
    if (running) {
      queuedInput = input;
      hasQueuedInput = true;
      return running;
    }
    running = drain(input).finally(() => {
      running = null;
      hasQueuedInput = false;
    });
    return running;
  };
}
