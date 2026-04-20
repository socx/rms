import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID    = 'user-123';
const EVENTS_PATTERN = '**/api/v1/events**';

function makeEvent(overrides = {}) {
  return {
    id:            'evt-001',
    ownerId:       USER_ID,
    subject:       'Annual Team Meeting',
    eventDatetime: '2026-06-15T09:00:00.000Z',
    eventTimezone: 'UTC',
    status:        'ACTIVE',
    createdAt:     '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

const MOCK_EVENTS = [
  makeEvent({ id: 'evt-001', subject: 'Annual Team Meeting',    status: 'ACTIVE',    ownerId: USER_ID }),
  makeEvent({ id: 'evt-002', subject: 'Quarterly Review',       status: 'ACTIVE',    ownerId: USER_ID }),
  makeEvent({ id: 'evt-003', subject: 'Shared With Me Event',   status: 'ACTIVE',    ownerId: 'other-user-456' }),
];

/**
 * Set up auth token + stub the /events endpoint.
 *
 * options.listEvents  – array of events for GET /events
 * options.createBody  – response body for POST /events (null = don't stub)
 * options.cancelBody  – response body for POST /events/:id/cancel
 */
async function setup(page, options = {}) {
  const {
    listEvents  = MOCK_EVENTS,
    createBody  = null,
    cancelBody  = null,
  } = options;

  await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);

  // Single catch-all for all /events* URLs
  await page.route(EVENTS_PATTERN, async (route) => {
    const method = route.request().method();
    const url    = route.request().url();
    const path   = new URL(url).pathname; // e.g. /api/v1/events or /api/v1/events/evt-001/cancel

    // Sub-resource routes: /events/:id/...
    if (/\/events\/[^/]+\//.test(path)) {
      if (method === 'POST' && path.endsWith('/cancel') && cancelBody) {
        return route.fulfill({
          status: cancelBody.success ? 200 : 400,
          contentType: 'application/json',
          body: JSON.stringify(cancelBody),
        });
      }
      return route.fallback();
    }

    // Base /events route — list (GET) and create (POST)
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { events: listEvents }, error: null }),
      });
    }

    if (method === 'POST' && createBody) {
      return route.fulfill({
        status: createBody.success ? 201 : 400,
        contentType: 'application/json',
        body: JSON.stringify(createBody),
      });
    }

    await route.fallback();
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test.describe('Events page — navigation', () => {
  test('redirects to /login when no token is present', async ({ page }) => {
    await page.goto('/events');
    await expect(page).toHaveURL(/\/login/);
  });

  test('is accessible at /events when authenticated', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await expect(page.getByRole('heading', { name: /my events/i, level: 1 })).toBeVisible();
  });

  test('"Edit profile" link navigates to /profile', async ({ page }) => {
    await setup(page);
    await page.route('**/api/v1/users/user-123', (route) =>
      route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: { id: USER_ID, firstname: 'Alice', lastname: 'S', email: 'a@b.com', timezone: 'UTC' } }, error: null }),
      })
    );
    // Stub api-keys endpoint so ProfilePage doesn't fail
    await page.route('**/api/v1/users/user-123/api-keys', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true, data: { api_keys: [] }, error: null }) })
    );
    await page.goto('/events');
    await page.getByRole('link', { name: /edit profile/i }).click();
    await expect(page).toHaveURL(/\/profile/);
  });
});

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

test.describe('Events page — listing', () => {
  test('shows all event subjects in the table', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await expect(page.getByText('Annual Team Meeting')).toBeVisible();
    await expect(page.getByText('Quarterly Review')).toBeVisible();
    await expect(page.getByText('Shared With Me Event')).toBeVisible();
  });

  test('shows ACTIVE status badges on active events', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    const badges = page.getByLabel(/status: active/i);
    await expect(badges.first()).toBeVisible();
  });

  test('shows Owner role badge for owned events', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    const ownerBadges = page.getByLabel(/role: owner/i);
    await expect(ownerBadges.first()).toBeVisible();
  });

  test('shows Shared role badge for non-owned events', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await expect(page.getByLabel(/role: shared/i)).toBeVisible();
  });

  test('shows event result count', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await expect(page.getByText(/3 events/i)).toBeVisible();
  });

  test('shows empty state when no events exist', async ({ page }) => {
    await setup(page, { listEvents: [] });
    await page.goto('/events');
    await expect(page.getByText(/no events yet/i)).toBeVisible();
  });

  test('shows "No events match" when filters eliminate all', async ({ page }) => {
    await setup(page, {
      listEvents: [makeEvent({ id: 'evt-001', subject: 'My Event', ownerId: USER_ID })],
    });
    await page.goto('/events');
    // Filter to 'Shared' — the only event is owned by the user, so it should disappear
    await page.getByRole('button', { name: 'Shared' }).click();
    await expect(page.getByText(/no events match/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

test.describe('Events page — filters', () => {
  test('"Owner" filter shows only owned events', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await page.getByRole('button', { name: 'Owner' }).click();
    await expect(page.getByText('Annual Team Meeting')).toBeVisible();
    await expect(page.getByText('Quarterly Review')).toBeVisible();
    await expect(page.getByText('Shared With Me Event')).not.toBeVisible();
  });

  test('"Shared" filter shows only non-owned events', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await page.getByRole('button', { name: 'Shared' }).click();
    await expect(page.getByText('Shared With Me Event')).toBeVisible();
    await expect(page.getByText('Annual Team Meeting')).not.toBeVisible();
    await expect(page.getByText('Quarterly Review')).not.toBeVisible();
  });

  test('"All" filter shows every event', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await page.getByRole('button', { name: 'Owner' }).click();
    await page.getByRole('button', { name: 'All' }).first().click();
    await expect(page.getByText('Shared With Me Event')).toBeVisible();
  });

  test('search input filters events by subject', async ({ page }) => {
    await setup(page, {
      listEvents: [
        makeEvent({ id: 'evt-001', subject: 'Annual Team Meeting' }),
        makeEvent({ id: 'evt-002', subject: 'Quarterly Review' }),
      ],
    });
    // Use a fresh stub that responds to ?q= param
    await page.route(EVENTS_PATTERN, async (route) => {
      const url = new URL(route.request().url());
      const q   = url.searchParams.get('q') || '';
      const all = [
        makeEvent({ id: 'evt-001', subject: 'Annual Team Meeting' }),
        makeEvent({ id: 'evt-002', subject: 'Quarterly Review' }),
      ];
      const filtered = q ? all.filter(e => e.subject.toLowerCase().includes(q.toLowerCase())) : all;
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { events: filtered }, error: null }),
      });
    });

    await page.goto('/events');
    await page.getByRole('searchbox', { name: /search events/i }).fill('Quarterly');
    // Wait for debounce + re-query
    await expect(page.getByText('Quarterly Review')).toBeVisible();
    await expect(page.getByText('Annual Team Meeting')).not.toBeVisible();
  });

  test('status filter is hidden when all events are ACTIVE', async ({ page }) => {
    await setup(page); // all ACTIVE
    await page.goto('/events');
    // No CANCELLED/ARCHIVED events → status filter group not shown
    await expect(page.getByRole('button', { name: 'Cancelled' })).not.toBeVisible();
  });

  test('status filter is shown when non-active events exist', async ({ page }) => {
    await setup(page, {
      listEvents: [
        makeEvent({ id: 'evt-001', subject: 'Active Event',    status: 'ACTIVE' }),
        makeEvent({ id: 'evt-002', subject: 'Cancelled Event', status: 'CANCELLED' }),
      ],
    });
    await page.goto('/events');
    await expect(page.getByRole('button', { name: 'Cancelled' })).toBeVisible();
  });

  test('status filter shows correct events', async ({ page }) => {
    await setup(page, {
      listEvents: [
        makeEvent({ id: 'evt-001', subject: 'Active Event',    status: 'ACTIVE' }),
        makeEvent({ id: 'evt-002', subject: 'Cancelled Event', status: 'CANCELLED', ownerId: USER_ID }),
      ],
    });
    await page.goto('/events');
    await page.getByRole('button', { name: 'Cancelled' }).click();
    await expect(page.getByText('Cancelled Event')).toBeVisible();
    await expect(page.getByText('Active Event')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Create event
// ---------------------------------------------------------------------------

test.describe('Events page — create', () => {
  test('opens create modal when "+ Create event" is clicked', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await page.getByRole('button', { name: /create event/i }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /create event/i })).toBeVisible();
  });

  test('"Cancel" closes the create modal', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await page.getByRole('button', { name: /create event/i }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('shows validation error when subject is empty', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await page.getByRole('button', { name: /create event/i }).first().click();
    await page.getByRole('dialog').getByRole('button', { name: /create event/i }).click();
    await expect(page.getByText(/subject is required/i)).toBeVisible();
  });

  test('shows validation error when datetime is missing', async ({ page }) => {
    await setup(page);
    await page.goto('/events');
    await page.getByRole('button', { name: /create event/i }).first().click();
    await page.getByLabel(/^subject/i).fill('My Event');
    await page.getByRole('dialog').getByRole('button', { name: /create event/i }).click();
    await expect(page.getByText(/date.*time is required/i)).toBeVisible();
  });

  test('shows success banner after event is created', async ({ page }) => {
    const newEvent = makeEvent({ id: 'evt-new', subject: 'New Event' });
    const createResp = { success: true, data: { event: newEvent }, error: null };

    await setup(page, { createBody: createResp });
    await page.goto('/events');
    await page.getByRole('button', { name: /create event/i }).first().click();

    await page.getByLabel(/^subject/i).fill('New Event');
    await page.getByLabel(/date.*time/i).fill('2026-09-01T10:00');
    await page.getByRole('dialog').getByRole('button', { name: /create event/i }).click();

    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText(/event created successfully/i)).toBeVisible();
  });

  test('shows API error within modal when create fails', async ({ page }) => {
    const errResp = {
      success: false,
      data: null,
      error: { code: 'INVALID_PAYLOAD', message: 'subject and eventDatetime are required.' },
    };
    await setup(page, { createBody: errResp });
    await page.goto('/events');
    await page.getByRole('button', { name: /create event/i }).first().click();

    await page.getByLabel(/^subject/i).fill('Test');
    await page.getByLabel(/date.*time/i).fill('2026-09-01T10:00');
    await page.getByRole('dialog').getByRole('button', { name: /create event/i }).click();

    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/subject and eventDatetime are required/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Cancel event
// ---------------------------------------------------------------------------

test.describe('Events page — cancel', () => {
  const ACTIVE_EVENT = makeEvent({ id: 'evt-001', subject: 'Annual Team Meeting', status: 'ACTIVE', ownerId: USER_ID });

  test('shows Cancel action only for owned active events', async ({ page }) => {
    await setup(page, { listEvents: [ACTIVE_EVENT] });
    await page.goto('/events');
    await expect(page.getByRole('button', { name: /cancel annual team meeting/i })).toBeVisible();
  });

  test('Cancel button is not shown for shared events', async ({ page }) => {
    await setup(page, {
      listEvents: [makeEvent({ id: 'evt-003', subject: 'Shared Event', ownerId: 'other-user' })],
    });
    await page.goto('/events');
    await expect(page.getByRole('button', { name: /cancel shared event/i })).not.toBeVisible();
  });

  test('opens confirm modal when Cancel is clicked', async ({ page }) => {
    await setup(page, { listEvents: [ACTIVE_EVENT] });
    await page.goto('/events');
    await page.getByRole('button', { name: /cancel annual team meeting/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/cancel event\?/i)).toBeVisible();
  });

  test('"Keep event" closes the confirm modal', async ({ page }) => {
    await setup(page, { listEvents: [ACTIVE_EVENT] });
    await page.goto('/events');
    await page.getByRole('button', { name: /cancel annual team meeting/i }).click();
    await page.getByRole('button', { name: /keep event/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('shows success banner after event is cancelled', async ({ page }) => {
    const cancelResp = {
      success: true,
      data: { event: { ...ACTIVE_EVENT, status: 'CANCELLED' } },
      error: null,
    };
    await setup(page, { listEvents: [ACTIVE_EVENT], cancelBody: cancelResp });
    await page.goto('/events');
    await page.getByRole('button', { name: /cancel annual team meeting/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /cancel event/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByText(/event cancelled/i)).toBeVisible();
  });
});
