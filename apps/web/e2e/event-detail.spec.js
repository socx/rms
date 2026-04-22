import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID    = 'user-123';
const EVENT_ID   = 'evt-001';

function makeEvent(overrides = {}) {
  return {
    id:            EVENT_ID,
    ownerId:       USER_ID,
    subject:       'Annual Team Meeting',
    eventDatetime: '2026-06-15T09:00:00.000Z',
    eventTimezone: 'UTC',
    location:      'Conference Room B',
    description:   'Q2 review session',
    status:        'ACTIVE',
    createdAt:     '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Stubs GET /events/:id and optionally PATCH /events/:id.
 *
 * options.event      – event object returned by GET (default: makeEvent())
 * options.patchBody  – response body for PATCH (null = not stubbed)
 */
async function setup(page, options = {}) {
  const {
    event     = makeEvent(),
    patchBody = null,
  } = options;

  await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);

  await page.route(`**/api/v1/events/${EVENT_ID}`, async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { event }, error: null }),
      });
    }

    if (method === 'PATCH' && patchBody) {
      return route.fulfill({
        status: patchBody.success ? 200 : 400,
        contentType: 'application/json',
        body: JSON.stringify(patchBody),
      });
    }

    return route.fallback();
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test.describe('Event detail page — navigation', () => {
  test('redirects to /login when no token is present', async ({ page }) => {
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page).toHaveURL(/\/login/);
  });

  test('shows "Event details" heading when authenticated', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('heading', { name: /event details/i, level: 1 })).toBeVisible();
  });

  test('"Back to events" link navigates to /events', async ({ page }) => {
    await setup(page);
    // Stub the events list so the page can render
    await page.route('**/api/v1/events**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { events: [] }, error: null }),
      })
    );
    await page.goto(`/events/${EVENT_ID}`);
    await page.getByRole('link', { name: /back to events/i }).click();
    await expect(page).toHaveURL(/\/events$/);
  });
});

// ---------------------------------------------------------------------------
// Field display
// ---------------------------------------------------------------------------

test.describe('Event detail page — field display', () => {
  test('shows subject in the page', async ({ page }) => {
    // Use non-owner event so subject appears as visible text in read-only view
    await setup(page, { event: makeEvent({ ownerId: 'other-user-456' }) });
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByText('Annual Team Meeting')).toBeVisible();
  });

  test('shows location in the page', async ({ page }) => {
    // Use non-owner event so location appears as visible text in read-only view
    await setup(page, { event: makeEvent({ ownerId: 'other-user-456' }) });
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByText('Conference Room B')).toBeVisible();
  });

  test('shows description in the page', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByText('Q2 review session')).toBeVisible();
  });

  test('shows ACTIVE status badge', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByLabel(/status: active/i)).toBeVisible();
  });

  test('shows Owner role badge for owned event', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByLabel(/role: owner/i)).toBeVisible();
  });

  test('shows Shared role badge for non-owned event', async ({ page }) => {
    await setup(page, { event: makeEvent({ ownerId: 'other-user-456' }) });
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByLabel(/role: shared/i)).toBeVisible();
  });

  test('shows CANCELLED status badge', async ({ page }) => {
    await setup(page, { event: makeEvent({ status: 'CANCELLED' }) });
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByLabel(/status: cancelled/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Role-scoped editing
// ---------------------------------------------------------------------------

test.describe('Event detail page — edit form (owner, ACTIVE)', () => {
  test('shows editable form when user is owner and event is ACTIVE', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('form', { name: /edit event/i })).toBeVisible();
    await expect(page.getByLabel(/^subject/i)).toBeVisible();
    await expect(page.getByLabel(/date.*time/i)).toBeVisible();
  });

  test('shows Save changes button for owner', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible();
  });

  test('subject field is pre-populated with event subject', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByLabel(/^subject/i)).toHaveValue('Annual Team Meeting');
  });

  test('location field is pre-populated', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByLabel(/^location/i)).toHaveValue('Conference Room B');
  });

  test('description field is pre-populated', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByLabel(/^description/i)).toHaveValue('Q2 review session');
  });

  test('timezone field is pre-populated', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByLabel(/^timezone/i)).toHaveValue('UTC');
  });
});

test.describe('Event detail page — read-only view', () => {
  test('shows read-only view for non-owner (shared event)', async ({ page }) => {
    await setup(page, { event: makeEvent({ ownerId: 'other-user-456' }) });
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('button', { name: /save changes/i })).not.toBeVisible();
    await expect(page.getByRole('form', { name: /edit event/i })).not.toBeVisible();
    await expect(page.getByText('Annual Team Meeting')).toBeVisible();
  });

  test('shows read-only view for owner of CANCELLED event', async ({ page }) => {
    await setup(page, { event: makeEvent({ status: 'CANCELLED' }) });
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('button', { name: /save changes/i })).not.toBeVisible();
    await expect(page.getByText('Annual Team Meeting')).toBeVisible();
  });

  test('shows read-only view for owner of ARCHIVED event', async ({ page }) => {
    await setup(page, { event: makeEvent({ status: 'ARCHIVED' }) });
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('button', { name: /save changes/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Save: validation
// ---------------------------------------------------------------------------

test.describe('Event detail page — save validation', () => {
  test('shows error when subject is cleared and form is submitted', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await page.getByLabel(/^subject/i).clear();
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('alert')).toContainText(/subject is required/i);
  });

  test('shows error when date & time is cleared and form is submitted', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await page.getByLabel(/date.*time/i).fill('');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('alert')).toContainText(/date.*time is required/i);
  });
});

// ---------------------------------------------------------------------------
// Save: success & API error
// ---------------------------------------------------------------------------

test.describe('Event detail page — save outcomes', () => {
  test('shows success banner after saving', async ({ page }) => {
    const updated = makeEvent({ subject: 'Updated Subject' });
    const patchBody = { success: true, data: { event: updated }, error: null };

    await setup(page, { patchBody });
    await page.goto(`/events/${EVENT_ID}`);
    await page.getByLabel(/^subject/i).fill('Updated Subject');
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('status')).toContainText(/event updated successfully/i);
  });

  test('shows API error message when save fails', async ({ page }) => {
    const patchBody = {
      success: false,
      data: null,
      error: { code: 'VALIDATION_ERROR', message: 'eventDatetime must be in the future.' },
    };

    await setup(page, { patchBody });
    await page.goto(`/events/${EVENT_ID}`);
    await page.getByLabel(/^subject/i).fill('Some Subject');
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('alert')).toContainText(/eventDatetime must be in the future/i);
  });
});

// ---------------------------------------------------------------------------
// Events list — subject link
// ---------------------------------------------------------------------------

test.describe('Events list — subject links to detail page', () => {
  test('clicking an event subject navigates to /events/:id', async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);

    // Stub events list
    await page.route('**/api/v1/events**', async (route) => {
      const url = route.request().url();
      const isDetail = /\/events\/evt-001$/.test(new URL(url).pathname);
      if (isDetail) return route.fallback();
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: {
            events: [{
              id: EVENT_ID, ownerId: USER_ID, subject: 'Annual Team Meeting',
              eventDatetime: '2026-06-15T09:00:00.000Z', eventTimezone: 'UTC',
              status: 'ACTIVE', createdAt: '2026-01-01T00:00:00.000Z',
            }],
          },
          error: null,
        }),
      });
    });

    // Stub detail page fetch
    await page.route(`**/api/v1/events/${EVENT_ID}`, (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { event: makeEvent() }, error: null }),
      })
    );

    await page.goto('/events');
    await page.getByRole('link', { name: 'Annual Team Meeting' }).click();
    await expect(page).toHaveURL(new RegExp(`/events/${EVENT_ID}$`));
    await expect(page.getByRole('heading', { name: /event details/i, level: 1 })).toBeVisible();
  });
});
