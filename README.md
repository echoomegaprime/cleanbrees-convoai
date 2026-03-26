# cleanbrees-convoai

> ElevenLabs ConvoAI voice agent for Clean Bree's Cleaning Service — answers phone calls as Bree, gives quotes, books appointments, and manages employees via Twilio integration.

## Overview

A Cloudflare Worker that powers an AI voice receptionist for Clean Bree's Cleaning Service in Midland, Texas. Incoming phone calls via Twilio are routed to an ElevenLabs ConvoAI agent that speaks as Bree with a warm, Southern personality. The agent can calculate accurate cleaning quotes (residential, commercial, and specialty services with volume and recurring discounts), book appointments directly into the D1 database, check scheduling conflicts, look up employees, get driving directions via Google Maps, and send SMS messages via Twilio.

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | `/` | Service info with available endpoint list |
| GET | `/health` | Health check with agent and phone status |
| POST | `/twilio/voice` | Twilio voice webhook — returns TwiML connecting to ConvoAI |
| POST | `/twilio/status` | Twilio call status callback — logs call events to D1 |
| POST | `/convoai/tools` | ConvoAI tool execution webhook (calculate_quote, book_appointment, check_schedule, get_employees, get_directions, send_sms) |
| POST | `/setup/agent` | Create or update the ElevenLabs ConvoAI agent |
| POST | `/setup/twilio` | Configure Twilio phone number webhook routing |
| POST | `/setup/db` | Initialize call_logs table in D1 |
| GET | `/quote` | Pricing reference and example request format |
| POST | `/quote` | Calculate a cleaning quote via HTTP |
| GET | `/schedule/:date` | Check bookings for a specific date |

## Configuration

### Secrets

- `ELEVENLABS_API_KEY` — ElevenLabs API key for ConvoAI agent management
- `TWILIO_ACCOUNT_SID` — Twilio account SID for SMS and call management
- `TWILIO_AUTH_TOKEN` — Twilio auth token
- `GOOGLE_MAPS_API_KEY` — Google Maps Directions API key (optional, falls back to link)
- `CONVOAI_AGENT_ID` — ElevenLabs ConvoAI agent ID (set after running `/setup/agent`)

### Bindings

| Binding | Type | Resource |
|---------|------|----------|
| `DB` | D1 Database | `cleanbrees-db` (shared with cleanbrees-api) |

### Environment Variables

- `CLEANBREES_API_URL` — `https://cleanbrees-api.bmcii1976.workers.dev`
- `BREE_VOICE_ID` — `pzKXffibtCDxnrVO8d1U` (Bree's ElevenLabs voice)
- `BUSINESS_PHONE` — `+14329997402`

## Deployment

```bash
cd O:\ECHO_OMEGA_PRIME\WORKERS\cleanbrees-convoai && npx wrangler deploy
```

## Architecture

Twilio routes incoming calls to `/twilio/voice`, which returns TwiML connecting the call to ElevenLabs ConvoAI via WebSocket streaming. The ConvoAI agent uses Bree's cloned voice and a system prompt containing full business knowledge (pricing, hours, service area, discount structure). During the conversation, the agent calls webhook tools on this same Worker (`/convoai/tools`) to calculate quotes, book appointments, check schedules, look up employees, get driving directions, and send SMS messages. All bookings and call logs are stored in the shared `cleanbrees-db` D1 database. The quote calculator mirrors the website pricing logic exactly, including volume discounts (10-25%), recurring discounts (10-30%), and deep clean surcharges (+50%).
