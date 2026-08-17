export class CalComService {
    constructor(apiKey) {
        this.apiKey = apiKey;
        this.baseUrl = 'https://api.cal.com/v1';
    }

    async makeRequest(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}${endpoint.includes('?') ? '&' : '?'}apiKey=${this.apiKey}`;

        const response = await fetch(url, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                ...options.headers,
            },
        });

        if (!response.ok) {
            const error = await response.text();
            throw new Error(`Cal.com API error: ${response.status} - ${error}`);
        }

        return response.json();
    }

    /**
     * Get available slots for an event type
     */
    async getAvailableSlots({ eventTypeId, startTime, endTime }) {
        // Cal.com uses /slots endpoint
        const endpoint = `/slots?eventTypeId=${eventTypeId}&startTime=${startTime}&endTime=${endTime}`;
        const data = await this.makeRequest(endpoint);
        return data.slots || {};
    }

    /**
     * Get user's event types
     */
    async getEventTypes() {
        const data = await this.makeRequest('/event-types');
        return data.event_types || [];
    }

    /**
     * Create a booking
     */
    async createBooking({ eventTypeId, start, end, name, email, notes, timezone }) {
        const body = {
            eventTypeId,
            start,
            end,
            responses: {
                name,
                email,
                notes,
                location: {
                    value: 'integrations:google:meet', // Default to Google Meet if possible, or Cal Video
                    optionValue: ''
                }
            },
            timeZone: timezone || 'UTC',
            language: 'en',
            metadata: {}
        };

        const data = await this.makeRequest('/bookings', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        return data.booking;
    }

    /**
     * List bookings (most recent first). Useful for "what's on my Cal.com",
     * rescheduling, and cancelling.
     */
    async getBookings() {
        const data = await this.makeRequest('/bookings');
        return data.bookings || [];
    }

    /**
     * Cancel a booking by id. Cal.com v1: DELETE /bookings/{id}/cancel.
     */
    async cancelBooking({ bookingId, reason }) {
        const endpoint = `/bookings/${bookingId}/cancel`;
        return this.makeRequest(endpoint, {
            method: 'DELETE',
            body: JSON.stringify({ reason: reason || 'Cancelled via Maily' }),
        });
    }
}
