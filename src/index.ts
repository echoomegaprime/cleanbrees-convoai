/**
 * CLEAN BREE'S CONVOAI VOICE AGENT
 * ElevenLabs ConvoAI + Twilio integration for Clean Bree's Cleaning Service
 *
 * Features:
 * - Answers phone calls as Bree with full business knowledge
 * - Books appointments with proximity/driving-time-aware scheduling
 * - Gives quotes following website pricing logic (volume + recurring discounts)
 * - Calls employees, routes them to jobs, checks status
 * - Sends Google Maps directions
 * - Integrates with cleanbrees-api D1 database
 */

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { WorkerEntrypoint } from 'cloudflare:workers';

// ============================================================================
// STRUCTURED LOGGING
// ============================================================================

function log(level: 'info' | 'warn' | 'error' | 'debug', message: string, data?: Record<string, unknown>): void {
  const entry = JSON.stringify({ ts: new Date().toISOString(), level, message, worker: 'cleanbrees-convoai', ...data });
  if (level === 'error') console.error(entry);
  else if (level === 'warn') console.warn(entry);
  else console.log(entry);
}

// ============================================================================
// TYPES
// ============================================================================

export interface Env {
  DB: D1Database;
  ELEVENLABS_API_KEY: string;
  TWILIO_ACCOUNT_SID: string;
  TWILIO_AUTH_TOKEN: string;
  GOOGLE_MAPS_API_KEY: string;
  CLEANBREES_API_URL: string;
  BREE_VOICE_ID: string;
  BUSINESS_PHONE: string;
  CONVOAI_AGENT_ID: string;
  OWNER_PHONE: string; // Commander's phone for emergency forwarding
  ADMIN_API_KEY: string; // gates /setup/* routes
  CONVOAI_WEBHOOK_SECRET: string; // shared secret ElevenLabs sends back on every /convoai/tools call
}

// ============================================================================
// BUSINESS KNOWLEDGE — Complete pricing, services, hours
// ============================================================================

const BUSINESS = {
  name: "Clean Bree's Cleaning Service",
  owner: "Bree McWilliams",
  phone: "(432) 999-7402",
  email: "customersupport@echo-op.com",
  website: "https://cleanbrees.echo-op.com",
  location: "Midland, TX 79701",
  serviceArea: "Midland, Odessa, Andrews, Big Spring, Stanton, Crane, Monahans, Pecos — entire Permian Basin",
  hours: {
    weekdays: "Monday through Friday, 7:00 AM to 6:00 PM",
    saturday: "Saturday, 8:00 AM to 4:00 PM",
    sunday: "Closed on Sunday",
  },
  tagline: "Licensed, Bonded & Insured — Serving the Permian Basin",
};

// Per-room/area pricing for quote calculations
const RESIDENTIAL_PRICING: Record<string, { label: string; price: number }> = {
  bedroom:  { label: 'Bedroom',      price: 25 },
  bathroom: { label: 'Bathroom',     price: 30 },
  kitchen:  { label: 'Kitchen',      price: 35 },
  living:   { label: 'Living Room',  price: 25 },
  dining:   { label: 'Dining Room',  price: 20 },
  office:   { label: 'Home Office',  price: 20 },
  laundry:  { label: 'Laundry Room', price: 15 },
  garage:   { label: 'Garage',       price: 25 },
  porch:    { label: 'Porch/Patio',  price: 20 },
  blowoff:  { label: 'Driveway Blow-off', price: 15 },
};

const COMMERCIAL_PRICING: Record<string, { label: string; price: number }> = {
  office:      { label: 'Office',          price: 35 },
  bathroom:    { label: 'Bathroom',        price: 45 },
  breakroom:   { label: 'Break Room',      price: 50 },
  lab:         { label: 'Lab/Clean Room',  price: 55 },
  reception:   { label: 'Reception Area',  price: 40 },
  conference:  { label: 'Conference Room', price: 35 },
  hallway:     { label: 'Hallway',         price: 25 },
  warehouse:   { label: 'Warehouse Area',  price: 75 },
};

const OTHER_SERVICES: Record<string, { label: string; price: number; unit: string }> = {
  lawn:        { label: 'Lawn Mowing',        price: 100, unit: 'starting at (additional charges for animal waste, trash, bigger yards)' },
  'lawn-full': { label: 'Full Lawn Service',  price: 150, unit: 'starting at (additional charges may apply)' },
  pressure:    { label: 'Pressure Washing',   price: 125, unit: 'per service' },
  trash:       { label: 'Trash Haul-Off',     price: 75, unit: 'starting at (prices subject to change based on load size + dump fees)' },
  appliance:   { label: 'Appliance Haul-Off', price: 50, unit: 'starting at (larger appliances like fridges/freezers cost more + dump fees)' },
  moveinout:   { label: 'Move In/Out Clean',  price: 200, unit: 'starting at' },
  postconstruction: { label: 'Post Construction', price: 300, unit: 'starting at' },
  deep:        { label: 'Deep Clean',         price: 200, unit: 'starting at' },
  carpet:      { label: 'Carpet Cleaning (Vacuum + Shampoo)', price: 70, unit: 'per room (heavy vacuum 4+ passes + double shampoo, 5 rooms = $350)' },
  // RAH (Right at Home) Handyman Services
  handyman:    { label: 'General Handyman',   price: 75, unit: 'per hour' },
  plumbing:    { label: 'Plumbing Repair',    price: 125, unit: 'per visit (parts extra)' },
  electrical:  { label: 'Electrical Work',    price: 125, unit: 'per visit (parts extra)' },
  painting:    { label: 'Painting',           price: 200, unit: 'per room' },
  drywall:     { label: 'Drywall Repair',     price: 100, unit: 'per patch/area' },
  doorlock:    { label: 'Door & Lock Service', price: 85, unit: 'per door' },
  faucet:      { label: 'Faucet Install/Repair', price: 150, unit: 'per faucet (parts extra)' },
  toilet:      { label: 'Toilet Install/Repair', price: 175, unit: 'per toilet (parts extra)' },
  ceilingfan:  { label: 'Ceiling Fan Install', price: 125, unit: 'per fan (fan not included)' },
  gutter:      { label: 'Gutter Cleaning',    price: 150, unit: 'per house' },
  fence:       { label: 'Fence Repair',       price: 175, unit: 'starting at (materials extra)' },
  tile:        { label: 'Tile Repair',        price: 200, unit: 'per area (materials extra)' },
  flooring:    { label: 'Flooring Install',   price: 5, unit: 'per sq ft (materials extra)' },
  shelving:    { label: 'Shelf & Shelving Install', price: 65, unit: 'per unit' },
  furniture:   { label: 'Furniture Assembly',  price: 75, unit: 'per item' },
  applianceinstall: { label: 'Appliance Installation', price: 100, unit: 'per appliance' },
  smokedetector: { label: 'Smoke Detector Install', price: 35, unit: 'per detector' },
  caulking:    { label: 'Caulking & Sealing', price: 60, unit: 'per area (tub, shower, windows)' },
  blinds:      { label: 'Blinds & Curtain Install', price: 50, unit: 'per window' },
};

// Volume discount tiers
const VOLUME_DISCOUNTS = [
  { min: 15, discount: 0.25, label: '25% off (15+ areas)' },
  { min: 11, discount: 0.20, label: '20% off (11+ areas)' },
  { min: 8,  discount: 0.15, label: '15% off (8+ areas)' },
  { min: 5,  discount: 0.10, label: '10% off (5+ areas)' },
];

// Recurring discounts
const RECURRING_DISCOUNTS: Record<string, { discount: number; label: string }> = {
  weekly:    { discount: 0.30, label: '30% off (Weekly)' },
  biweekly:  { discount: 0.20, label: '20% off (Bi-Weekly)' },
  monthly:   { discount: 0.10, label: '10% off (Monthly)' },
  once:      { discount: 0,    label: 'One-time (no discount)' },
};

// ============================================================================
// QUOTE CALCULATOR — mirrors website PricingTable.tsx logic
// ============================================================================

interface QuoteRequest {
  type: 'residential' | 'commercial' | 'other';
  areas?: Record<string, number>; // area_key -> quantity
  service?: string; // for 'other' type
  quantity?: number; // for 'other' type
  recurring?: string; // weekly, biweekly, monthly, once
  deepClean?: boolean;
}

function calculateQuote(req: QuoteRequest): {
  subtotal: number;
  volumeDiscount: number;
  recurringDiscount: number;
  deepCleanSurcharge: number;
  total: number;
  breakdown: string;
} {
  let subtotal = 0;
  let totalAreas = 0;
  const lines: string[] = [];

  if (req.type === 'residential' && req.areas) {
    for (const [key, qty] of Object.entries(req.areas)) {
      if (qty > 0 && RESIDENTIAL_PRICING[key]) {
        const item = RESIDENTIAL_PRICING[key];
        const lineTotal = item.price * qty;
        subtotal += lineTotal;
        totalAreas += qty;
        lines.push(`${item.label} x${qty}: $${lineTotal}`);
      }
    }
  } else if (req.type === 'commercial' && req.areas) {
    for (const [key, qty] of Object.entries(req.areas)) {
      if (qty > 0 && COMMERCIAL_PRICING[key]) {
        const item = COMMERCIAL_PRICING[key];
        const lineTotal = item.price * qty;
        subtotal += lineTotal;
        totalAreas += qty;
        lines.push(`${item.label} x${qty}: $${lineTotal}/week`);
      }
    }
  } else if (req.type === 'other' && req.service) {
    const svc = OTHER_SERVICES[req.service];
    if (svc) {
      const qty = req.quantity || 1;
      subtotal = svc.price * qty;
      lines.push(`${svc.label} x${qty}: $${subtotal}`);
    }
  }

  // Volume discount
  let volumeDiscount = 0;
  if (totalAreas > 0) {
    for (const tier of VOLUME_DISCOUNTS) {
      if (totalAreas >= tier.min) {
        volumeDiscount = subtotal * tier.discount;
        lines.push(`Volume discount (${tier.label}): -$${volumeDiscount.toFixed(2)}`);
        break;
      }
    }
  }

  // Deep clean surcharge (+50%)
  let deepCleanSurcharge = 0;
  if (req.deepClean) {
    deepCleanSurcharge = (subtotal - volumeDiscount) * 0.5;
    lines.push(`Deep clean surcharge (+50%): +$${deepCleanSurcharge.toFixed(2)}`);
  }

  // Recurring discount
  let recurringDiscount = 0;
  const recurring = req.recurring || 'once';
  if (recurring !== 'once' && RECURRING_DISCOUNTS[recurring]) {
    const afterVolume = subtotal - volumeDiscount + deepCleanSurcharge;
    recurringDiscount = afterVolume * RECURRING_DISCOUNTS[recurring].discount;
    lines.push(`Recurring discount (${RECURRING_DISCOUNTS[recurring].label}): -$${recurringDiscount.toFixed(2)}`);
  }

  const total = subtotal - volumeDiscount + deepCleanSurcharge - recurringDiscount;
  lines.push(`TOTAL: $${total.toFixed(2)}${req.type === 'commercial' ? '/week' : ''}`);

  return {
    subtotal,
    volumeDiscount,
    recurringDiscount,
    deepCleanSurcharge,
    total: Math.max(0, total),
    breakdown: lines.join('\n'),
  };
}

// ============================================================================
// CONVOAI AGENT SYSTEM PROMPT
// ============================================================================

function buildAgentPrompt(): string {
  return `You are Bree, the voice of Clean Bree's Cleaning Service in Midland, Texas. You answer phone calls for the business.

PERSONALITY:
- Warm, friendly, and genuinely helpful — you're a real Midland girl
- Professional but personable — like talking to a friend who owns a business
- Direct and efficient — don't waste people's time
- Southern charm — say "y'all" occasionally, be conversational
- Confident about pricing and services — you know your stuff
- If someone's rude, stay professional but don't be a pushover

ABOUT THE BUSINESS:
- Owner: ${BUSINESS.owner}
- Location: ${BUSINESS.location}
- Service Area: ${BUSINESS.serviceArea}
- Hours: ${BUSINESS.hours.weekdays}. ${BUSINESS.hours.saturday}. ${BUSINESS.hours.sunday}.
- Phone: ${BUSINESS.phone}
- Website: ${BUSINESS.website}
- ${BUSINESS.tagline}

SERVICES & PRICING:

RESIDENTIAL CLEANING (per room):
${Object.values(RESIDENTIAL_PRICING).map(p => `- ${p.label}: $${p.price}`).join('\n')}

COMMERCIAL CLEANING (per area, per week):
${Object.values(COMMERCIAL_PRICING).map(p => `- ${p.label}: $${p.price}/week`).join('\n')}

OTHER SERVICES:
${Object.values(OTHER_SERVICES).map(s => `- ${s.label}: $${s.price} ${s.unit}`).join('\n')}

DISCOUNT STRUCTURE:
Volume Discounts (residential & commercial):
- 5+ areas: 10% off
- 8+ areas: 15% off
- 11+ areas: 20% off
- 15+ areas: 25% off

Recurring Service Discounts:
- Weekly: 30% off
- Bi-Weekly: 20% off
- Monthly: 10% off

Deep Clean: adds 50% surcharge to the base price

INSTRUCTIONS:
1. When someone calls, greet them warmly: "Hey there! Thanks for calling Clean Bree's, this is Bree. How can I help y'all today?"
2. For quotes: Ask what rooms/areas they need cleaned, calculate the price using the pricing above, and apply any applicable discounts. Use the calculate_quote tool for accurate pricing.
3. For booking: Collect their name, phone number, address (with city and zip), what service they need, and preferred date/time. Use the book_appointment tool.
4. When booking, consider driving time — try to schedule appointments in the same area close together. Use the check_schedule tool to see existing bookings for the day.
5. For commercial clients, explain per-area weekly pricing and mention volume discounts.
6. If asked about something outside our services, be honest and suggest alternatives.
7. Always mention we're licensed, bonded, and insured if relevant.
8. For payments: We accept cash, check, card, Zelle, and Venmo.
9. Cancellation policy: 24-hour notice required. Same-day cancellations may incur a $50 fee.
10. We bring all our own supplies and equipment. We use eco-friendly, pet-safe products.
11. If they want to book online, direct them to ${BUSINESS.website}/booking
12. Keep responses conversational and natural — this is a phone call, not a text chat.
13. NEVER make up prices that aren't listed above. If unsure, say you'll have Bree personally follow up.
IMPORTANT PRICING NOTES:
- Lawn mowing starts at $100 but additional charges apply for animal waste cleanup, trash in the yard, and larger-than-standard lots. Always mention "starting at" when quoting lawn service.
- Trash & junk haul-off prices are subject to change based on load size. There are also dump fees on top of the base price. Always mention this.
- Appliance haul-off: larger appliances like fridges and freezers may cost more than the base $50. Dump fees are additional. Always mention this.
- For haul-offs, give the starting price but let them know the final price depends on what they have and dump fees that day.
- Carpet cleaning is $70 per room — includes heavy vacuuming (4+ passes until no more pet hair/dirt) plus double shampoo. 5 rooms is $350. Great for pet owners and move-in/move-out.
14. When asked about employee-related things, you manage the team. Use tools to check schedules and route workers.
15. For driving directions, use the get_directions tool to help workers or customers find locations.
16. EMERGENCY/URGENT CALLS: If a caller says it's an emergency, urgent, needs to speak to Bree or the owner right away, or there's a safety issue (water leak at a job site, injury, etc.), use the forward_to_owner tool. Say something like "Let me connect you with Bree right now, one moment please." This forwards them to Bree's personal line.
17. RAH (RIGHT AT HOME) HANDYMAN SERVICES: We also offer a full range of handyman services through our Right at Home division. This includes plumbing, electrical, painting, drywall, door/lock service, faucet and toilet work, ceiling fans, gutter cleaning, fence repair, tile, flooring, shelving, furniture assembly, appliance installation, smoke detectors, caulking, and blinds installation. Quote these the same way — use the pricing in OTHER SERVICES above. For handyman work, always mention that parts and materials are extra unless otherwise noted.`;
}

// ============================================================================
// CONVOAI TOOL DEFINITIONS — what the agent can call during conversations
// ============================================================================

function getToolDefinitions(): any[] {
  return [
    {
      type: 'webhook',
      name: 'calculate_quote',
      description: 'Calculate an accurate price quote for cleaning services based on rooms/areas selected, recurring frequency, and deep clean option. Call this whenever a customer asks for a quote or pricing estimate.',
      parameters: {
        type: 'object',
        properties: {
          service_type: {
            type: 'string',
            enum: ['residential', 'commercial', 'lawn', 'lawn-full', 'pressure', 'trash', 'appliance', 'moveinout', 'postconstruction', 'deep', 'carpet', 'handyman', 'plumbing', 'electrical', 'painting', 'drywall', 'doorlock', 'faucet', 'toilet', 'ceilingfan', 'gutter', 'fence', 'tile', 'flooring', 'shelving', 'furniture', 'applianceinstall', 'smokedetector', 'caulking', 'blinds'],
            description: 'Type of service requested'
          },
          bedrooms: { type: 'number', description: 'Number of bedrooms (residential)' },
          bathrooms: { type: 'number', description: 'Number of bathrooms' },
          kitchens: { type: 'number', description: 'Number of kitchens (usually 1)' },
          living_rooms: { type: 'number', description: 'Number of living rooms' },
          dining_rooms: { type: 'number', description: 'Number of dining rooms' },
          offices: { type: 'number', description: 'Number of offices' },
          laundry_rooms: { type: 'number', description: 'Number of laundry rooms' },
          garages: { type: 'number', description: 'Number of garages' },
          porches: { type: 'number', description: 'Number of porches/patios' },
          blowoffs: { type: 'number', description: 'Driveway blow-off' },
          breakrooms: { type: 'number', description: 'Number of break rooms (commercial)' },
          labs: { type: 'number', description: 'Number of labs (commercial)' },
          receptions: { type: 'number', description: 'Number of reception areas (commercial)' },
          conferences: { type: 'number', description: 'Number of conference rooms (commercial)' },
          hallways: { type: 'number', description: 'Number of hallways (commercial)' },
          warehouses: { type: 'number', description: 'Number of warehouse areas (commercial)' },
          recurring: {
            type: 'string',
            enum: ['once', 'weekly', 'biweekly', 'monthly'],
            description: 'How often they want service'
          },
          deep_clean: { type: 'boolean', description: 'Whether this is a deep clean (adds 50% surcharge)' },
          quantity: { type: 'number', description: 'Quantity for other services (loads, appliances, etc.)' },
        },
        required: ['service_type'],
      },
    },
    {
      type: 'webhook',
      name: 'book_appointment',
      description: 'Book a cleaning appointment for a customer. Collect their name, phone, address, service type, and preferred date/time before calling this.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: { type: 'string', description: 'Customer full name' },
          customer_phone: { type: 'string', description: 'Customer phone number' },
          customer_email: { type: 'string', description: 'Customer email (optional)' },
          service_type: {
            type: 'string',
            enum: ['residential', 'commercial', 'lawn', 'lawn-full', 'pressure', 'trash', 'appliance', 'moveinout', 'postconstruction', 'deep', 'carpet', 'handyman', 'plumbing', 'electrical', 'painting', 'drywall', 'doorlock', 'faucet', 'toilet', 'ceilingfan', 'gutter', 'fence', 'tile', 'flooring', 'shelving', 'furniture', 'applianceinstall', 'smokedetector', 'caulking', 'blinds'],
            description: 'Service type'
          },
          address: { type: 'string', description: 'Service address (street)' },
          city: { type: 'string', description: 'City (default: Midland)' },
          zip: { type: 'string', description: 'ZIP code' },
          scheduled_date: { type: 'string', description: 'Date in YYYY-MM-DD format' },
          scheduled_time: { type: 'string', description: 'Time in HH:MM format (24hr)' },
          notes: { type: 'string', description: 'Any special instructions or room details' },
          quoted_price: { type: 'number', description: 'Quoted price if already calculated' },
          recurring: { type: 'string', enum: ['once', 'weekly', 'biweekly', 'monthly'], description: 'Recurring frequency' },
        },
        required: ['customer_name', 'customer_phone', 'service_type', 'address', 'scheduled_date', 'scheduled_time'],
      },
    },
    {
      type: 'webhook',
      name: 'check_schedule',
      description: 'Check the schedule for a specific date to see what bookings already exist. Use this to find available time slots and avoid scheduling conflicts. Also helps schedule jobs near each other geographically.',
      parameters: {
        type: 'object',
        properties: {
          date: { type: 'string', description: 'Date to check in YYYY-MM-DD format' },
        },
        required: ['date'],
      },
    },
    {
      type: 'webhook',
      name: 'get_employees',
      description: 'Get list of active employees with their roles and contact info.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
    {
      type: 'webhook',
      name: 'get_directions',
      description: 'Get driving directions and estimated travel time between two addresses. Use this for scheduling proximity-aware appointments or routing employees.',
      parameters: {
        type: 'object',
        properties: {
          origin: { type: 'string', description: 'Starting address' },
          destination: { type: 'string', description: 'Destination address' },
        },
        required: ['origin', 'destination'],
      },
    },
    {
      type: 'webhook',
      name: 'send_sms',
      description: 'Send an SMS message to an employee or customer with job details, directions, or status updates.',
      parameters: {
        type: 'object',
        properties: {
          to: { type: 'string', description: 'Phone number to send to (with country code)' },
          message: { type: 'string', description: 'Message content' },
        },
        required: ['to', 'message'],
      },
    },
    {
      type: 'webhook',
      name: 'forward_to_owner',
      description: 'Forward the current call to the business owner (Bree). Use this ONLY for emergencies, urgent matters, or when the caller specifically requests to speak to Bree or the owner. Say "Let me connect you with Bree right now" before calling this.',
      parameters: {
        type: 'object',
        properties: {
          reason: { type: 'string', description: 'Brief reason for forwarding (e.g. "emergency water leak", "caller requested owner")' },
          caller_phone: { type: 'string', description: 'The caller phone number if available' },
        },
        required: ['reason'],
      },
    },
  ];
}

// ============================================================================
// TOOL EXECUTION — handles ConvoAI tool calls
// ============================================================================

async function executeTool(toolName: string, params: any, env: Env): Promise<string> {
  switch (toolName) {
    case 'calculate_quote':
      return handleCalculateQuote(params);
    case 'book_appointment':
      return await handleBookAppointment(params, env);
    case 'check_schedule':
      return await handleCheckSchedule(params, env);
    case 'get_employees':
      return await handleGetEmployees(env);
    case 'get_directions':
      return await handleGetDirections(params, env);
    case 'send_sms':
      return await handleSendSMS(params, env);
    case 'forward_to_owner':
      return await handleForwardToOwner(params, env);
    default:
      return `Unknown tool: ${toolName}`;
  }
}

function handleCalculateQuote(params: any): string {
  const svcType = params.service_type;

  // Other services (non room-based) — includes cleaning add-ons + RAH handyman
  const otherServiceKeys = Object.keys(OTHER_SERVICES);
  if (otherServiceKeys.includes(svcType)) {
    const svc = OTHER_SERVICES[svcType];
    if (!svc) return 'Service not found.';
    const qty = params.quantity || 1;
    const total = svc.price * qty;
    return `${svc.label}: $${total} (${svc.unit}${qty > 1 ? ` x${qty}` : ''})`;
  }

  // Residential or commercial — build areas map
  const areas: Record<string, number> = {};
  const isCommercial = svcType === 'commercial';

  if (isCommercial) {
    if (params.offices) areas.office = params.offices;
    if (params.bathrooms) areas.bathroom = params.bathrooms;
    if (params.breakrooms) areas.breakroom = params.breakrooms;
    if (params.labs) areas.lab = params.labs;
    if (params.receptions) areas.reception = params.receptions;
    if (params.conferences) areas.conference = params.conferences;
    if (params.hallways) areas.hallway = params.hallways;
    if (params.warehouses) areas.warehouse = params.warehouses;
  } else {
    if (params.bedrooms) areas.bedroom = params.bedrooms;
    if (params.bathrooms) areas.bathroom = params.bathrooms;
    if (params.kitchens) areas.kitchen = params.kitchens;
    if (params.living_rooms) areas.living = params.living_rooms;
    if (params.dining_rooms) areas.dining = params.dining_rooms;
    if (params.offices) areas.office = params.offices;
    if (params.laundry_rooms) areas.laundry = params.laundry_rooms;
    if (params.garages) areas.garage = params.garages;
    if (params.porches) areas.porch = params.porches;
    if (params.blowoffs) areas.blowoff = params.blowoffs;
  }

  const quote = calculateQuote({
    type: isCommercial ? 'commercial' : 'residential',
    areas,
    recurring: params.recurring || 'once',
    deepClean: params.deep_clean || false,
  });

  return `Quote breakdown:\n${quote.breakdown}\n\nTotal: $${quote.total.toFixed(2)}${isCommercial ? ' per week' : ''}`;
}

async function handleBookAppointment(params: any, env: Env): Promise<string> {
  try {
    // Build notes from params
    const notes = params.notes || '';
    const recurringNote = params.recurring && params.recurring !== 'once' ? ` | Recurring: ${params.recurring}` : '';
    const priceNote = params.quoted_price ? ` | Quoted: $${params.quoted_price}` : '';
    const fullNotes = `Booked via phone (Bree ConvoAI)${recurringNote}${priceNote}${notes ? ' | ' + notes : ''}`;

    // Create booking via D1 directly (same DB binding)
    let customerId: number | null = null;
    if (params.customer_name) {
      const nameParts = params.customer_name.trim().split(/\s+/);
      const firstName = nameParts[0] || '';
      const lastName = nameParts.slice(1).join(' ') || '';

      // Check if customer already exists by phone
      const existing = await env.DB.prepare(
        `SELECT id FROM customers WHERE phone = ?1 LIMIT 1`
      ).bind(params.customer_phone).first<{ id: number }>();

      if (existing) {
        customerId = existing.id;
      } else {
        const custResult = await env.DB.prepare(
          `INSERT INTO customers (first_name, last_name, phone, email, address, city, state, zip, source)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'TX', ?7, 'phone')`
        ).bind(
          firstName, lastName, params.customer_phone || null,
          params.customer_email || null, params.address || null,
          params.city || 'Midland', params.zip || null
        ).run();
        customerId = custResult.meta.last_row_id as number;
      }
    }

    // Resolve service_id
    let serviceId: number | null = null;
    if (params.service_type) {
      const svc = await env.DB.prepare(
        `SELECT id FROM services WHERE LOWER(name) LIKE ?1 OR LOWER(category) = ?2 ORDER BY sort_order LIMIT 1`
      ).bind(`%${params.service_type.toLowerCase()}%`, params.service_type.toLowerCase()).first<{ id: number }>();
      if (svc) serviceId = svc.id;
    }

    const result = await env.DB.prepare(
      `INSERT INTO bookings (customer_id, service_id, scheduled_date, scheduled_time, duration_minutes,
       address, city, state, zip, notes, quoted_price, status)
       VALUES (?1, ?2, ?3, ?4, 120, ?5, ?6, 'TX', ?7, ?8, ?9, 'pending')`
    ).bind(
      customerId, serviceId, params.scheduled_date, params.scheduled_time || '09:00',
      params.address || null, params.city || 'Midland', params.zip || null,
      fullNotes, params.quoted_price || null
    ).run();

    const bookingId = result.meta.last_row_id;
    return `Appointment booked successfully! Booking #${bookingId} for ${params.customer_name} on ${params.scheduled_date} at ${params.scheduled_time}. Address: ${params.address}, ${params.city || 'Midland'}. Status: pending confirmation. We'll send a confirmation shortly!`;
  } catch (err: any) {
    return `I'm sorry, I had trouble booking that appointment. Error: ${err.message}. Let me take your information and have Bree call you back to confirm.`;
  }
}

async function handleCheckSchedule(params: any, env: Env): Promise<string> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT b.id, b.scheduled_time, b.duration_minutes, b.address, b.city, b.status, b.notes,
       COALESCE(c.company_name, c.first_name || ' ' || c.last_name) as customer_name,
       s.name as service_name
       FROM bookings b
       LEFT JOIN customers c ON b.customer_id = c.id
       LEFT JOIN services s ON b.service_id = s.id
       WHERE b.scheduled_date = ?1 AND b.status != 'cancelled'
       ORDER BY b.scheduled_time`
    ).bind(params.date).all();

    if (!results || results.length === 0) {
      return `No bookings found for ${params.date}. The entire day is available!`;
    }

    const schedule = results.map((b: any) => {
      const endTime = addMinutes(b.scheduled_time, b.duration_minutes || 120);
      return `- ${b.scheduled_time}-${endTime}: ${b.customer_name || 'Unknown'} (${b.service_name || b.notes || 'Service'}) at ${b.address || 'No address'}, ${b.city || 'Midland'} [${b.status}]`;
    }).join('\n');

    return `Schedule for ${params.date} (${results.length} booking${results.length > 1 ? 's' : ''}):\n${schedule}\n\nAvailable gaps can be filled — try to book nearby addresses in adjacent time slots.`;
  } catch (err: any) {
    return `Could not check schedule: ${err.message}`;
  }
}

function addMinutes(time: string, minutes: number): string {
  const [h, m] = (time || '09:00').split(':').map(Number);
  const totalMin = h * 60 + m + minutes;
  const newH = Math.floor(totalMin / 60) % 24;
  const newM = totalMin % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

async function handleGetEmployees(env: Env): Promise<string> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT id, first_name, last_name, phone, role, status FROM employees WHERE status = 'active' ORDER BY last_name`
    ).all();

    if (!results || results.length === 0) {
      return 'No active employees found in the system.';
    }

    const list = results.map((e: any) =>
      `- ${e.first_name} ${e.last_name} (${e.role}) — Phone: ${e.phone || 'N/A'} [ID: ${e.id}]`
    ).join('\n');

    return `Active employees (${results.length}):\n${list}`;
  } catch (err: any) {
    return `Could not retrieve employees: ${err.message}`;
  }
}

async function handleGetDirections(params: any, env: Env): Promise<string> {
  const { origin, destination } = params;
  if (!env.GOOGLE_MAPS_API_KEY) {
    // Fallback: return a Google Maps link
    const url = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
    return `Here's a Google Maps link for directions from ${origin} to ${destination}: ${url}`;
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}&key=${env.GOOGLE_MAPS_API_KEY}`;
    const resp = await fetch(url);
    const data = await resp.json() as any;

    if (data.status !== 'OK' || !data.routes?.[0]) {
      const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
      return `Could not get exact directions. Here's a Google Maps link: ${mapsUrl}`;
    }

    const route = data.routes[0];
    const leg = route.legs[0];
    const steps = leg.steps.slice(0, 5).map((s: any, i: number) =>
      `${i + 1}. ${s.html_instructions.replace(/<[^>]*>/g, '')} (${s.distance.text})`
    ).join('\n');

    return `Directions from ${leg.start_address} to ${leg.end_address}:\nDistance: ${leg.distance.text}\nDrive time: ${leg.duration.text}\n\n${steps}${leg.steps.length > 5 ? `\n... and ${leg.steps.length - 5} more steps` : ''}\n\nGoogle Maps: https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
  } catch (err: any) {
    const mapsUrl = `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(origin)}&destination=${encodeURIComponent(destination)}`;
    return `Here's a Google Maps link: ${mapsUrl}`;
  }
}

interface TwilioSendResult {
  ok: boolean;
  status: number;
  /** Twilio's numeric error code when it rejects the message (e.g. 20003, 21608); null otherwise. */
  code: number | null;
  /** Raw error body. Only handleSendSMS repeats it; OwnerNotify never returns or logs it. */
  text: string;
}

async function twilioSendSms(to: string, body: string, env: Env): Promise<TwilioSendResult> {
  let toNumber = to.replace(/[^\d+]/g, '');
  if (!toNumber.startsWith('+')) toNumber = '+1' + toNumber;

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        To: toNumber,
        From: env.BUSINESS_PHONE || '+14329997402',
        Body: body,
      }),
    }
  );

  if (resp.ok) return { ok: true, status: resp.status, code: null, text: '' };
  const text = await resp.text();
  let code: number | null = null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed.code === 'number') code = parsed.code;
  } catch {
    // Non-JSON error body: keep code null and report the HTTP status instead.
  }
  return { ok: false, status: resp.status, code, text };
}

async function handleSendSMS(params: any, env: Env): Promise<string> {
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) {
    return 'SMS service is not configured.';
  }

  try {
    const res = await twilioSendSms(params.to, params.message, env);
    if (res.ok) {
      return `SMS sent successfully to ${params.to}!`;
    }
    return `Failed to send SMS: ${res.text}`;
  } catch (err: any) {
    return `SMS error: ${err.message}`;
  }
}

async function handleForwardToOwner(params: any, env: Env): Promise<string> {
  const ownerPhone = env.OWNER_PHONE || '+14322248166';
  const reason = params.reason || 'caller requested';
  const callerPhone = params.caller_phone || 'unknown';

  // Send SMS to owner alerting them about the incoming forward
  if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
    try {
      await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/Messages.json`,
        {
          method: 'POST',
          headers: {
            'Authorization': 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            To: ownerPhone,
            From: env.BUSINESS_PHONE || '+14329997402',
            Body: `[Clean Bree's] Call forwarding to you. Reason: ${reason}. Caller: ${callerPhone}`,
          }),
        }
      );
    } catch (e) {
      log('warn', 'Failed to send forward alert SMS', { error: (e as Error).message });
    }
  }

  log('info', 'Call forwarded to owner', { reason, callerPhone, ownerPhone });

  // Return instruction — the ConvoAI agent will say this and the TwiML redirect will handle the actual forward
  return `FORWARD_CALL:${ownerPhone}|Connecting you to Bree now. One moment please — I'm transferring your call.`;
}

// ============================================================================
// ELEVENLABS CONVOAI AGENT MANAGEMENT
// ============================================================================

async function createOrUpdateAgent(env: Env): Promise<{ agent_id: string }> {
  if (!env.CONVOAI_WEBHOOK_SECRET) {
    throw new Error('CONVOAI_WEBHOOK_SECRET not set -- refusing to publish an agent config whose tool webhook would have no auth header');
  }
  const prompt = buildAgentPrompt();
  const tools = getToolDefinitions();

  // Build the webhook URL for tool calls
  const webhookUrl = `https://cleanbrees-convoai.bmcii1976.workers.dev/convoai/tools`;

  const agentConfig = {
    conversation_config: {
      agent: {
        prompt: {
          prompt: prompt,
        },
        first_message: "Hey there! Thanks for calling Clean Bree's, this is Bree. How can I help y'all today?",
        language: 'en',
      },
      tts: {
        voice_id: env.BREE_VOICE_ID || 'pzKXffibtCDxnrVO8d1U',
      },
      conversation: {
        max_duration_seconds: 600,
      },
      tools: tools.map((t: any) => ({
        type: 'webhook',
        name: t.name,
        description: t.description,
        api_schema: {
          url: webhookUrl,
          method: 'POST',
          // `request_headers` (not `headers`) is the field ElevenLabs actually reads for
          // webhook-tool config. CONVOAI_WEBHOOK_SECRET here is how /convoai/tools verifies
          // the call genuinely came from our agent -- see verifyConvoAISecret(). Passed as a
          // plain value rather than an env_var_label indirection for now (see SECURITY.md for
          // the tradeoff and future-hardening note).
          request_headers: {
            'Content-Type': 'application/json',
            'X-Tool-Name': t.name,
            'X-ConvoAI-Secret': env.CONVOAI_WEBHOOK_SECRET || '',
          },
          request_body: t.parameters,
        },
      })),
    },
    name: "Bree - Clean Bree's Voice Agent",
    platform_settings: {
      twilio: {
        phone_number_sid: '', // Will be set separately
      },
    },
  };

  // Check if agent already exists
  if (env.CONVOAI_AGENT_ID) {
    // Update existing agent
    const resp = await fetch(`https://api.elevenlabs.io/v1/convai/agents/${env.CONVOAI_AGENT_ID}`, {
      method: 'PATCH',
      headers: {
        'xi-api-key': env.ELEVENLABS_API_KEY,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(agentConfig),
    });

    if (resp.ok) {
      return { agent_id: env.CONVOAI_AGENT_ID };
    }
    // If update fails, create new
  }

  // Create new agent
  const resp = await fetch('https://api.elevenlabs.io/v1/convai/agents/create', {
    method: 'POST',
    headers: {
      'xi-api-key': env.ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(agentConfig),
  });

  if (!resp.ok) {
    const err = await resp.text();
    throw new Error(`Failed to create ConvoAI agent: ${resp.status} ${err}`);
  }

  const data = await resp.json() as any;
  return { agent_id: data.agent_id };
}

// ============================================================================
// TWILIO PHONE NUMBER CONFIGURATION
// ============================================================================

async function configureTwilioWebhook(env: Env, phoneNumberSid: string): Promise<boolean> {
  // Set the voice webhook URL to return TwiML that connects to ConvoAI
  const webhookUrl = `https://cleanbrees-convoai.bmcii1976.workers.dev/twilio/voice`;

  const resp = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}/IncomingPhoneNumbers/${phoneNumberSid}.json`,
    {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + btoa(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        VoiceUrl: webhookUrl,
        VoiceMethod: 'POST',
        StatusCallback: `https://cleanbrees-convoai.bmcii1976.workers.dev/twilio/status`,
        StatusCallbackMethod: 'POST',
      }),
    }
  );

  return resp.ok;
}

// ============================================================================
// AUTH — Twilio webhook signatures, ConvoAI shared secret, admin key
// ============================================================================
// None of /twilio/*, /convoai/tools, or /setup/* verified their caller at all.
// That meant: anyone could POST a forged Twilio-shaped request, anyone could
// POST directly to /convoai/tools to send arbitrary SMS from the business's
// real Twilio number or write bogus bookings into the live schedule, and
// anyone could POST to /setup/agent to silently rewrite the live voice
// agent's system prompt/behavior using our own paid ElevenLabs key.

export function timingSafeEqual(a: string, b: string): boolean {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

// Twilio's exact algorithm (github.com/twilio/twilio-node webhooks.ts):
// HMAC-SHA1(authToken, url + sorted(params).reduce((acc,[k,v]) => acc+k+v, "")), base64.
export async function computeTwilioSignature(authToken: string, url: string, params: Record<string, string>): Promise<string> {
  const data = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url);
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(authToken), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  // btoa over the raw signature bytes (base64, matching Twilio's own encoding)
  let binary = '';
  for (const b of new Uint8Array(sig)) binary += String.fromCharCode(b);
  return btoa(binary);
}

export async function verifyTwilioSignature(request: Request, formParams: Record<string, string>, env: Env): Promise<boolean> {
  if (!env.TWILIO_AUTH_TOKEN) return false;
  const provided = request.headers.get('X-Twilio-Signature') || '';
  if (!provided) return false;
  const expected = await computeTwilioSignature(env.TWILIO_AUTH_TOKEN, request.url, formParams);
  return timingSafeEqual(provided, expected);
}

export function verifyConvoAISecret(request: Request, env: Env): boolean {
  if (!env.CONVOAI_WEBHOOK_SECRET) return false;
  const provided = request.headers.get('X-ConvoAI-Secret') || '';
  return timingSafeEqual(provided, env.CONVOAI_WEBHOOK_SECRET);
}

export function requireAdminAuth(request: Request, env: Env): Response | null {
  if (!env.ADMIN_API_KEY) {
    return new Response(JSON.stringify({ error: 'Service misconfigured: ADMIN_API_KEY not set' }), { status: 503, headers: { 'Content-Type': 'application/json' } });
  }
  const key = request.headers.get('X-Echo-API-Key') || (request.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!timingSafeEqual(key, env.ADMIN_API_KEY)) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  return null;
}

// ============================================================================
// HONO APP — ROUTES
// ============================================================================

const app = new Hono<{ Bindings: Env }>();
app.use('*', cors());

// Payload size limit (1MB)
const MAX_BODY_BYTES = 1_048_576;
app.use('*', async (c, next) => {
  if (c.req.method === 'POST' || c.req.method === 'PUT') {
    const size = parseInt(c.req.header('Content-Length') || '0');
    if (size > MAX_BODY_BYTES) {
      return c.json({ error: 'Payload too large', max_bytes: MAX_BODY_BYTES }, 413);
    }
  }
  return next();
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/health', (c) => {
  return c.json({
    status: 'ok',
    service: 'cleanbrees-convoai',
    version: '2.0.0',
    agent_id: c.env.CONVOAI_AGENT_ID || 'not configured',
    phone: c.env.BUSINESS_PHONE,
    services: Object.keys(OTHER_SERVICES).length + ' other services + residential + commercial',
  });
});

// ---------------------------------------------------------------------------
// Root info
// ---------------------------------------------------------------------------
app.get('/', (c) => {
  return c.json({
    service: 'cleanbrees-convoai',
    version: '1.0.0',
    description: "Bree ConvoAI Voice Agent for Clean Bree's Cleaning Service",
    endpoints: [
      'GET  /health',
      'POST /twilio/voice — Twilio voice webhook (returns TwiML)',
      'POST /twilio/status — Twilio call status callback',
      'POST /convoai/tools — ConvoAI tool execution webhook',
      'POST /setup/agent — Create/update ConvoAI agent',
      'POST /setup/twilio — Configure Twilio phone webhook',
      'GET  /quote — Calculate a quote',
      'GET  /schedule/:date — Check schedule for a date',
    ],
  });
});

// ---------------------------------------------------------------------------
// TWILIO VOICE WEBHOOK — Returns TwiML to connect call to ConvoAI
// ---------------------------------------------------------------------------
app.post('/twilio/voice', async (c) => {
  const formData = (await c.req.parseBody()) as Record<string, string>;
  if (!(await verifyTwilioSignature(c.req.raw, formData, c.env))) {
    log('warn', 'Rejected /twilio/voice: invalid or missing X-Twilio-Signature');
    return c.text('Forbidden', 403);
  }

  const agentId = c.env.CONVOAI_AGENT_ID;

  if (!agentId) {
    // No ConvoAI agent configured — play a message
    const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Thanks for calling Clean Bree's Cleaning Service. We're currently setting up our automated assistant. Please call back shortly or visit cleanbrees.echo-op.com to book online. Have a great day!</Say>
  <Hangup/>
</Response>`;
    return new Response(twiml, {
      headers: { 'Content-Type': 'text/xml' },
    });
  }

  // Connect call to ElevenLabs ConvoAI via WebSocket stream
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream url="wss://api.elevenlabs.io/v1/convai/conversation?agent_id=${agentId}">
      <Parameter name="caller_id" value="{{From}}" />
    </Stream>
  </Connect>
</Response>`;

  return new Response(twiml, {
    headers: { 'Content-Type': 'text/xml' },
  });
});

// ---------------------------------------------------------------------------
// TWILIO CALL FORWARD — Transfers call to owner for emergencies
// ---------------------------------------------------------------------------
app.post('/twilio/forward', async (c) => {
  const formData = (await c.req.parseBody()) as Record<string, string>;
  if (!(await verifyTwilioSignature(c.req.raw, formData, c.env))) {
    log('warn', 'Rejected /twilio/forward: invalid or missing X-Twilio-Signature');
    return c.text('Forbidden', 403);
  }

  const ownerPhone = c.env.OWNER_PHONE || '+14322248166';
  const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna">Connecting you now. Please hold.</Say>
  <Dial callerId="${c.env.BUSINESS_PHONE || '+14329997402'}" timeout="30">
    <Number>${ownerPhone}</Number>
  </Dial>
  <Say voice="Polly.Joanna">I'm sorry, Bree is unavailable right now. Please leave a message after the beep and she will call you back.</Say>
  <Record maxLength="120" transcribe="true" />
</Response>`;
  return new Response(twiml, { headers: { 'Content-Type': 'text/xml' } });
});

// ---------------------------------------------------------------------------
// TWILIO STATUS CALLBACK — Logs call events
// ---------------------------------------------------------------------------
app.post('/twilio/status', async (c) => {
  try {
    const formData = (await c.req.parseBody()) as Record<string, string>;
    if (!(await verifyTwilioSignature(c.req.raw, formData, c.env))) {
      log('warn', 'Rejected /twilio/status: invalid or missing X-Twilio-Signature');
      return c.text('Forbidden', 403);
    }
    const callSid = formData['CallSid'] as string;
    const status = formData['CallStatus'] as string;
    const from = formData['From'] as string;
    const duration = formData['CallDuration'] as string;

    log('info', 'Call status update', { callSid, status, from, duration: duration || 'N/A' });

    // Store call log in D1
    try {
      await c.env.DB.prepare(
        `INSERT INTO call_logs (call_sid, caller_number, status, duration_seconds, created_at)
         VALUES (?1, ?2, ?3, ?4, datetime('now'))`
      ).bind(callSid, from, status, duration ? parseInt(duration) : null).run();
    } catch (e) {
      log("warn", "call_logs insert failed", { error: (e as Error)?.message || String(e) });
    }
  } catch (err) {
    log('error', 'Status callback error', { error: (err as Error).message });
  }

  return c.text('OK', 200);
});

// ---------------------------------------------------------------------------
// CONVOAI TOOL EXECUTION WEBHOOK — Called by ConvoAI during conversations
// ---------------------------------------------------------------------------
app.post('/convoai/tools', async (c) => {
  if (!verifyConvoAISecret(c.req.raw, c.env)) {
    log('warn', 'Rejected /convoai/tools: invalid or missing X-ConvoAI-Secret');
    return c.json({ error: 'Forbidden' }, 403);
  }
  try {
    const body = await c.req.json().catch(() => ({}));
    const toolName = c.req.header('X-Tool-Name') || body.tool_name || body.name;
    const params = body.parameters || body.params || body;

    log('info', 'ConvoAI tool call', { toolName, params });

    const result = await executeTool(toolName, params, c.env);

    return c.json({ result });
  } catch (err: any) {
    log('error', 'Tool execution error', { error: (err as Error).message });
    return c.json({ result: `I had trouble with that request. Error: ${err.message}` }, 200);
  }
});

// ---------------------------------------------------------------------------
// SETUP: Create/Update ConvoAI Agent
// ---------------------------------------------------------------------------
app.post('/setup/agent', async (c) => {
  const authError = requireAdminAuth(c.req.raw, c.env);
  if (authError) return authError;
  try {
    if (!c.env.ELEVENLABS_API_KEY) {
      return c.json({ error: 'ELEVENLABS_API_KEY not configured' }, 400);
    }

    const result = await createOrUpdateAgent(c.env);
    return c.json({
      success: true,
      agent_id: result.agent_id,
      message: `ConvoAI agent created/updated. Set CONVOAI_AGENT_ID secret to: ${result.agent_id}`,
      next_steps: [
        `Run: echo "${result.agent_id}" | npx wrangler secret put CONVOAI_AGENT_ID`,
        'Then POST /setup/twilio to configure the phone number',
      ],
    });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ---------------------------------------------------------------------------
// SETUP: Configure Twilio phone number webhook
// ---------------------------------------------------------------------------
app.post('/setup/twilio', async (c) => {
  const authError = requireAdminAuth(c.req.raw, c.env);
  if (authError) return authError;
  try {
    const body = await c.req.json().catch(() => ({})) as any;
    const phoneNumberSid = body.phone_number_sid;

    if (!phoneNumberSid) {
      return c.json({ error: 'Provide phone_number_sid in request body' }, 400);
    }

    const success = await configureTwilioWebhook(c.env, phoneNumberSid);

    if (success) {
      return c.json({
        success: true,
        message: `Twilio phone number ${phoneNumberSid} configured to route calls to ConvoAI agent.`,
        webhook_url: 'https://cleanbrees-convoai.bmcii1976.workers.dev/twilio/voice',
      });
    }

    return c.json({ error: 'Failed to configure Twilio webhook. Check credentials.' }, 500);
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});

// ---------------------------------------------------------------------------
// UTILITY: Calculate quote via HTTP (for testing)
// ---------------------------------------------------------------------------
app.post('/quote', async (c) => {
  const params = await c.req.json().catch(() => ({}));
  const result = handleCalculateQuote(params);
  return c.json({ quote: result });
});

app.get('/quote', (c) => {
  return c.json({
    usage: 'POST /quote with service_type, room counts, recurring, deep_clean',
    example: {
      service_type: 'residential',
      bedrooms: 3,
      bathrooms: 2,
      kitchens: 1,
      living_rooms: 1,
      recurring: 'biweekly',
      deep_clean: false,
    },
    pricing: {
      residential: RESIDENTIAL_PRICING,
      commercial: COMMERCIAL_PRICING,
      other: OTHER_SERVICES,
    },
  });
});

// ---------------------------------------------------------------------------
// UTILITY: Check schedule via HTTP (for testing)
// ---------------------------------------------------------------------------
app.get('/schedule/:date', async (c) => {
  // Returns customer names and addresses: owner/admin only, fails closed (503) when ADMIN_API_KEY is unset.
  const authError = requireAdminAuth(c.req.raw, c.env);
  if (authError) return authError;
  const date = c.req.param('date');
  const result = await handleCheckSchedule({ date }, c.env);
  return c.json({ date, schedule: result });
});

// ---------------------------------------------------------------------------
// UTILITY: Init call_logs table
// ---------------------------------------------------------------------------
app.post('/setup/db', async (c) => {
  const authError = requireAdminAuth(c.req.raw, c.env);
  if (authError) return authError;
  try {
    await c.env.DB.exec(`CREATE TABLE IF NOT EXISTS call_logs (id INTEGER PRIMARY KEY AUTOINCREMENT, call_sid TEXT, caller_number TEXT, status TEXT, duration_seconds INTEGER, agent_id TEXT, notes TEXT, created_at TEXT DEFAULT (datetime('now')))`);
    await c.env.DB.exec(`CREATE INDEX IF NOT EXISTS idx_call_logs_created ON call_logs(created_at DESC)`);
    return c.json({ success: true, message: 'call_logs table created' });
  } catch (err: any) {
    return c.json({ error: err.message }, 500);
  }
});


app.onError((err, c) => {
  if (err.message?.includes('JSON')) {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }
  console.error(`[cleanbrees-convoai] ${err.message}`);
  return c.json({ error: 'Internal server error' }, 500);
});

app.notFound((c) => {
  return c.json({ error: 'Not found' }, 404);
});

// ============================================================================
// OWNER NOTIFY — named RPC entrypoint used by cleanbrees-api POST /api/contact
// (service binding CONVOAI -> cleanbrees-convoai#OwnerNotify). Named entrypoints
// are reachable only through a service binding, never from the public internet.
// It returns status only: never the owner's number or Twilio's response body.
// ============================================================================

export interface ContactLead {
  ref?: string;
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
}

export interface OwnerNotifyResult {
  sent: boolean;
  /** ok | owner_phone_unset | twilio_unset | twilio_<code> | twilio_http_<status> | sms_exception */
  reason: string;
}

function clip(value: unknown, max: number): string {
  return String(value == null ? '' : value)
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

export function contactLeadSms(lead: ContactLead): string {
  const ref = clip(lead.ref, 40);
  return `[Clean Bree's] New website message${ref ? ' ' + ref : ''} from ${clip(lead.name, 60) || 'unknown'} | ${clip(lead.phone, 25) || 'no phone'} | ${clip(lead.email, 80) || 'no email'}: ${clip(lead.message, 300)}`;
}

export async function notifyOwnerOfContactLead(lead: ContactLead, env: Env): Promise<OwnerNotifyResult> {
  if (!env.OWNER_PHONE) return { sent: false, reason: 'owner_phone_unset' };
  if (!env.TWILIO_ACCOUNT_SID || !env.TWILIO_AUTH_TOKEN) return { sent: false, reason: 'twilio_unset' };
  const safeLead: ContactLead = lead && typeof lead === 'object' ? lead : {};
  const ref = clip(safeLead.ref, 40);
  try {
    const res = await twilioSendSms(String(env.OWNER_PHONE), contactLeadSms(safeLead), env);
    if (res.ok) {
      log('info', 'Contact lead owner SMS', { sent: true, ref });
      return { sent: true, reason: 'ok' };
    }
    const reason = res.code !== null ? `twilio_${res.code}` : `twilio_http_${res.status}`;
    log('warn', 'Contact lead owner SMS', { sent: false, ref, reason });
    return { sent: false, reason };
  } catch (err) {
    log('warn', 'Contact lead owner SMS threw', { ref, error: (err as Error)?.message || String(err) });
    return { sent: false, reason: 'sms_exception' };
  }
}

export class OwnerNotify extends WorkerEntrypoint<Env> {
  async contactLead(lead: ContactLead): Promise<OwnerNotifyResult> {
    return notifyOwnerOfContactLead(lead, this.env);
  }
}

export default app;
