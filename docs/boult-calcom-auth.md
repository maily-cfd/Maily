# Boult — Cal.com authentication: why API key, not OAuth

## TL;DR
Boult connects to Cal.com with a **per-user API key**, not OAuth. This was a
deliberate, verified decision — **Cal.com's personal-account OAuth cannot create
bookings**, so switching to it would break the core "book a meeting" capability.

## What was verified (June 2026)
Cal.com's personal-account OAuth flow does exist:
- Authorize: `https://app.cal.com/auth/oauth2/authorize?client_id=…&state=…&redirect_uri=…&scope=…`
- Token: `POST https://app.cal.com/api/auth/oauth/token`
- Refresh: `POST https://app.cal.com/api/auth/oauth/refreshToken`
- Verify: `GET https://app.cal.com/api/auth/oauth/me`

**But the only available scopes are `READ_BOOKING` and `READ_PROFILE`.** There is
no scope to list event-types/slots or to **create** a booking. Booking creation in
Cal.com is done via an **API key** (personal) or Platform managed-user access
tokens (an enterprise "Platform" product with `calManagedUserId`, intended for
apps that *provision* users — not for connecting a user's existing personal
account). Cal.com's v2 OAuth surface was also still being restructured as of late
2025.

### Consequence
Replacing the API key with personal-account OAuth would be a **functional
regression**: the agent could read bookings but no longer list availability or book
meetings — the whole point of the integration. Per our no-regressions rule, the API
key stays.

## What we DID fix
The previous code fell back to a shared `CAL_API_KEY` for any user without their
own key. In a multi-tenant deployment that's a serious bug: a keyless user would
read and **book on the operator's Cal.com calendar**.

Now (all call sites — `lib/boult/tools.ts:getCalClient`,
`lib/boult-canvas-action-handlers.js`, `lib/mission-tools.js`):
- Always prefer the user's own connected key.
- The shared key is used **only** when the operator explicitly sets
  `CAL_ALLOW_SHARED_KEY=true` (single-tenant mode). Otherwise a keyless user is
  treated as not-connected and gets a clear "add your Cal.com API key" prompt.

## Operator notes
- **Multi-tenant (default):** leave `CAL_ALLOW_SHARED_KEY` unset. Each user connects
  their own Cal.com API key in Settings → Integrations (guided 3-step flow).
- **Single-tenant / personal:** set `CAL_ALLOW_SHARED_KEY=true` and `CAL_API_KEY`
  to your key; optionally `CAL_COM_USERNAME` for clean booking links.

## If Cal.com later ships write-capable OAuth
Revisit then: add OAuth routes (authorize → token → refresh) storing
`cal_access_token`/`cal_refresh_token`, and teach `CalComService` to send a Bearer
token instead of `?apiKey=`. Only worth it once a booking-creation scope exists.
