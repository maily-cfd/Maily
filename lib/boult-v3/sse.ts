/**
 * Boult V3 — SSE (Server-Sent Events) Manager
 * 
 * Manages SSE connections and emits real-time step execution
 * updates from server to browser. No WebSockets.
 */

// In-memory client registry: key = "userId:planId", value = Response objects
const sseClients: Map<string, Array<{ res: any; heartbeat: NodeJS.Timeout }>> = new Map();

/**
 * Register an SSE client connection for a specific user+plan.
 * Called from the SSE stream API route.
 */
export function registerSSEClient(
  userId: string,
  planId: string,
  res: any
): () => void {
  const key = `${userId}:${planId}`;
  const clients = sseClients.get(key) || [];

  // Set SSE headers
  res.writeHead?.(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  // Send initial connection message
  const initData = `data: ${JSON.stringify({ type: 'connected', planId })}\n\n`;
  if (typeof res.write === 'function') {
    res.write(initData);
  }

  // Heartbeat every 15 seconds to keep connection alive
  const heartbeat = setInterval(() => {
    try {
      if (typeof res.write === 'function') {
        res.write(': heartbeat\n\n');
      }
    } catch {
      // Client disconnected
      cleanup();
    }
  }, 15000);

  const client = { res, heartbeat };
  clients.push(client);
  sseClients.set(key, clients);

  // Return cleanup function
  function cleanup() {
    clearInterval(heartbeat);
    const currentClients = sseClients.get(key) || [];
    const updated = currentClients.filter(c => c !== client);
    if (updated.length === 0) {
      sseClients.delete(key);
    } else {
      sseClients.set(key, updated);
    }
  }

  return cleanup;
}

/**
 * Emit an SSE event to all clients listening for a specific user+plan.
 * Called from the execution engine as steps progress.
 */
export function emitSSE(userId: string, planId: string, event: object): void {
  const key = `${userId}:${planId}`;
  const clients = sseClients.get(key) || [];
  const data = `data: ${JSON.stringify(event)}\n\n`;

  const deadClients: number[] = [];

  clients.forEach((client, index) => {
    try {
      if (typeof client.res.write === 'function') {
        client.res.write(data);
      }
    } catch {
      deadClients.push(index);
    }
  });

  // Clean up dead clients
  if (deadClients.length > 0) {
    const alive = clients.filter((_, i) => !deadClients.includes(i));
    deadClients.forEach(i => {
      clearInterval(clients[i].heartbeat);
    });
    if (alive.length === 0) {
      sseClients.delete(key);
    } else {
      sseClients.set(key, alive);
    }
  }
}

/**
 * Emit an SSE event to ALL clients for a specific user (any plan).
 * Used for broadcasting new plan notifications.
 */
export function emitSSEToUser(userId: string, event: object): void {
  const data = `data: ${JSON.stringify(event)}\n\n`;

  for (const [key, clients] of sseClients.entries()) {
    if (key.startsWith(`${userId}:`)) {
      clients.forEach(client => {
        try {
          if (typeof client.res.write === 'function') {
            client.res.write(data);
          }
        } catch {
          // Ignore dead clients — they'll be cleaned up on next emit
        }
      });
    }
  }
}

/**
 * Get the number of active SSE connections (for monitoring).
 */
export function getSSEClientCount(): number {
  let count = 0;
  for (const clients of sseClients.values()) {
    count += clients.length;
  }
  return count;
}
