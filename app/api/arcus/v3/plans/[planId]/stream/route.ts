/**
 * Boult V3 — SSE Stream for Plan Execution
 * GET /api/boult/v3/plans/[planId]/stream
 * 
 * Returns a Server-Sent Events stream for real-time step updates.
 */

import { NextRequest } from 'next/server';
import { auth } from '../../../../../../../lib/auth.js';
import { registerSSEClient } from '../../../../../../../lib/boult-v3/sse';
import { logEvent } from "@/lib/logsso";

export const dynamic = 'force-dynamic';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ planId: string }> }
) {
  const session = await auth();
  if (!session?.user?.email) {
    return new Response('Unauthorized', { status: 401 });
  }

  const userId = session.user.email.toLowerCase();
  const { planId } = await params;

  // Create a readable stream for SSE
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();

      // Create a mock response object that writes to the stream controller
      const mockRes = {
        write(data: string) {
          try {
            controller.enqueue(encoder.encode(data));
          } catch {
              logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
            // Stream closed
          }
        },
        writeHead() {
          // No-op — headers are handled by the Response object
        },
      };

      // Register with SSE manager
      const cleanup = registerSSEClient(userId, planId, mockRes);

      // Handle client disconnect
      request.signal.addEventListener('abort', () => {
        cleanup();
        try {
          controller.close();
        } catch {
          logEvent({ channel: "failures", event: "❌ API Error", description: "Unknown error" });
          // Already closed
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  });
}
