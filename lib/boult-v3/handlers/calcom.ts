/**
 * Boult V3 — Cal.com Action Handler
 * 
 * Executes cal.com actions: cancel_booking, reschedule_booking.
 * Uses API key authentication.
 */

/**
 * Cal.com Action Handler
 */
export async function calcomHandler(
  apiKey: string,
  action: string,
  params: any
): Promise<{ success: boolean; data?: any; error?: string }> {
  const baseUrl = 'https://api.cal.com/v1';

  try {
    switch (action) {
      case 'cancel_booking':
        return await cancelBooking(baseUrl, apiKey, params);
      case 'reschedule_booking':
        return await rescheduleBooking(baseUrl, apiKey, params);
      default:
        return { success: false, error: `Unsupported Cal.com action: ${action}` };
    }
  } catch (err: any) {
    console.error(`[Boult V3] Cal.com handler error (${action}):`, err.message);
    return { success: false, error: err.message };
  }
}

async function cancelBooking(baseUrl: string, apiKey: string, params: any) {
  const { bookingId, reason } = params;
  if (!bookingId) throw new Error('bookingId is required for cancel_booking');

  const response = await fetch(`${baseUrl}/bookings/${bookingId}/cancel?apiKey=${apiKey}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cal.com cancel failed: ${errorText}`);
  }

  return { success: true };
}

async function rescheduleBooking(baseUrl: string, apiKey: string, params: any) {
  const { bookingId, start, end, reason } = params;
  if (!bookingId) throw new Error('bookingId is required for reschedule_booking');

  const response = await fetch(`${baseUrl}/bookings/${bookingId}/reschedule?apiKey=${apiKey}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ start, end, reason }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Cal.com reschedule failed: ${errorText}`);
  }

  const data = await response.json();
  return { success: true, data };
}
