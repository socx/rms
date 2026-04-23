import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID    = 'user-123';
const EVENT_ID   = 'evt-001';
const SUB_ID     = 'sub-001';
const SUB_ID_2   = 'sub-002';
const CONTACT_ID = 'con-001';
const CONTACT_ID_2 = 'con-002';

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

function makeContact(overrides = {}) {
  return {
    id:           CONTACT_ID,
    subscriberId: SUB_ID,
    channel:      'EMAIL',
    contactValue: 'alice@example.com',
    isPrimary:    true,
    label:        'work',
    status:       'ACTIVE',
    createdAt:    '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSubscriber(overrides = {}) {
  return {
    id:        SUB_ID,
    eventId:   EVENT_ID,
    firstname: 'Alice',
    lastname:  'Smith',
    timezone:  'UTC',
    status:    'ACTIVE',
    contacts:  [makeContact()],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Sets up route mocks. All subscriber route mocks are optional — specify only
 * what the specific test needs; unmatched routes fall through.
 */
async function setup(page, options = {}) {
  const {
    event                  = makeEvent(),
    subscribers            = [],
    postSubscriberResponse = null,
    patchSubscriberResponse = null,
    deleteSubscriberResponse = null,
    unsubscribeResponse    = null,
    postContactResponse    = null,
    patchContactResponse   = null,
    deleteContactResponse  = null,
  } = options;

  await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);

  // GET /events/:id
  await page.route(`**/api/v1/events/${EVENT_ID}`, async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { event }, error: null }),
      });
    }
    return route.fallback();
  });

  // GET / POST /events/:id/subscribers
  await page.route(`**/api/v1/events/${EVENT_ID}/subscribers`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { subscribers }, error: null }),
      });
    }
    if (method === 'POST' && postSubscriberResponse) {
      return route.fulfill({
        status: postSubscriberResponse.success ? 201 : 422,
        contentType: 'application/json',
        body: JSON.stringify(postSubscriberResponse),
      });
    }
    return route.fallback();
  });

  // PATCH / DELETE /events/:id/subscribers/:sid
  await page.route(`**/api/v1/events/${EVENT_ID}/subscribers/${SUB_ID}`, async (route) => {
    const method = route.request().method();
    if (method === 'PATCH' && patchSubscriberResponse) {
      return route.fulfill({
        status: patchSubscriberResponse.success ? 200 : 422,
        contentType: 'application/json',
        body: JSON.stringify(patchSubscriberResponse),
      });
    }
    if (method === 'DELETE' && deleteSubscriberResponse) {
      const status = deleteSubscriberResponse.success ? 200 : (deleteSubscriberResponse.status ?? 409);
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(deleteSubscriberResponse),
      });
    }
    return route.fallback();
  });

  // POST /events/:id/subscribers/:sid/unsubscribe
  await page.route(`**/api/v1/events/${EVENT_ID}/subscribers/${SUB_ID}/unsubscribe`, async (route) => {
    if (route.request().method() === 'POST' && unsubscribeResponse) {
      return route.fulfill({
        status: unsubscribeResponse.success ? 200 : 422,
        contentType: 'application/json',
        body: JSON.stringify(unsubscribeResponse),
      });
    }
    return route.fallback();
  });

  // POST /events/:id/subscribers/:sid/contacts
  await page.route(`**/api/v1/events/${EVENT_ID}/subscribers/${SUB_ID}/contacts`, async (route) => {
    if (route.request().method() === 'POST' && postContactResponse) {
      return route.fulfill({
        status: postContactResponse.success ? 201 : 422,
        contentType: 'application/json',
        body: JSON.stringify(postContactResponse),
      });
    }
    return route.fallback();
  });

  // PATCH / DELETE /events/:id/subscribers/:sid/contacts/:cid
  await page.route(`**/api/v1/events/${EVENT_ID}/subscribers/${SUB_ID}/contacts/${CONTACT_ID}`, async (route) => {
    const method = route.request().method();
    if (method === 'PATCH' && patchContactResponse) {
      return route.fulfill({
        status: patchContactResponse.success ? 200 : 422,
        contentType: 'application/json',
        body: JSON.stringify(patchContactResponse),
      });
    }
    if (method === 'DELETE' && deleteContactResponse) {
      const status = deleteContactResponse.success ? 200 : (deleteContactResponse.status ?? 409);
      return route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(deleteContactResponse),
      });
    }
    return route.fallback();
  });
}

async function openSubscribersTab(page) {
  await page.getByRole('tab', { name: /subscribers/i }).click();
}

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

test.describe('Event detail page — Subscribers tab', () => {
  test('Subscribers tab is visible in tab bar', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('tab', { name: /subscribers/i })).toBeVisible();
  });

  test('clicking Subscribers tab shows subscribers section', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByLabel('Subscribers')).toBeVisible();
  });

  test('switching back to Details tab shows event form', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('tab', { name: /details/i }).click();
    await expect(page.getByRole('form', { name: /edit event/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Subscribers tab — empty state
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — empty state', () => {
  test('shows "No subscribers yet" when list is empty', async ({ page }) => {
    await setup(page, { subscribers: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByText(/no subscribers yet/i)).toBeVisible();
  });

  test('shows Add subscriber button for owner of ACTIVE event', async ({ page }) => {
    await setup(page, { subscribers: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByRole('button', { name: /add subscriber/i })).toBeVisible();
  });

  test('hides Add subscriber button for non-owner (read-only)', async ({ page }) => {
    await setup(page, {
      event: makeEvent({ ownerId: 'other-456' }),
      subscribers: [],
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByRole('button', { name: /add subscriber/i })).not.toBeVisible();
  });

  test('hides Add subscriber button for CANCELLED event', async ({ page }) => {
    await setup(page, {
      event: makeEvent({ status: 'CANCELLED' }),
      subscribers: [],
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByRole('button', { name: /add subscriber/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Subscribers tab — list display
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — list display', () => {
  test('shows subscriber name', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByText('Alice Smith')).toBeVisible();
  });

  test('shows ACTIVE status badge', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByLabel(/subscriber status: active/i)).toBeVisible();
  });

  test('shows UNSUBSCRIBED status badge', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber({ status: 'UNSUBSCRIBED' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByLabel(/subscriber status: unsubscribed/i)).toBeVisible();
  });

  test('shows contact value', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByText('alice@example.com')).toBeVisible();
  });

  test('shows Primary badge for primary contact', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByLabel(/primary contact/i)).toBeVisible();
  });

  test('does not show Primary badge for non-primary contact', async ({ page }) => {
    const sub = makeSubscriber({
      contacts: [makeContact({ isPrimary: false })],
    });
    await setup(page, { subscribers: [sub] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByLabel(/primary contact/i)).not.toBeVisible();
  });

  test('shows subscriber count in header', async ({ page }) => {
    const sub2 = makeSubscriber({ id: SUB_ID_2, firstname: 'Bob', lastname: 'Jones', contacts: [] });
    await setup(page, { subscribers: [makeSubscriber(), sub2] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByText(/subscribers.*\(2\)/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Add subscriber modal
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — add subscriber modal', () => {
  test('opens Add subscriber modal on button click', async ({ page }) => {
    await setup(page, { subscribers: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /add subscriber/i }).click();
    await expect(page.getByRole('dialog', { name: /add subscriber/i })).toBeVisible();
  });

  test('modal has firstname, lastname, timezone, and contact fields', async ({ page }) => {
    await setup(page, { subscribers: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /add subscriber/i }).click();
    await expect(page.locator('#sub-firstname')).toBeVisible();
    await expect(page.locator('#sub-lastname')).toBeVisible();
    await expect(page.locator('#sub-timezone')).toBeVisible();
    await expect(page.locator('#sub-ct-channel')).toBeVisible();
    await expect(page.locator('#sub-ct-value')).toBeVisible();
    await expect(page.locator('#sub-ct-label')).toBeVisible();
  });

  test('Cancel button closes the modal', async ({ page }) => {
    await setup(page, { subscribers: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /add subscriber/i }).click();
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('dialog', { name: /add subscriber/i })).not.toBeVisible();
  });

  test('shows validation error when firstname is missing', async ({ page }) => {
    await setup(page, { subscribers: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /add subscriber/i }).click();
    await page.locator('#sub-lastname').fill('Smith');
    await page.locator('#sub-ct-value').fill('alice@example.com');
    await page.getByRole('button', { name: /^add subscriber$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/first name is required/i);
  });

  test('shows validation error when contact value is missing', async ({ page }) => {
    await setup(page, { subscribers: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /add subscriber/i }).click();
    await page.locator('#sub-firstname').fill('Alice');
    await page.locator('#sub-lastname').fill('Smith');
    // Leave contact value empty
    await page.getByRole('button', { name: /^add subscriber$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/contact value is required/i);
  });

  test('successfully submits and closes modal', async ({ page }) => {
    const newSub = makeSubscriber();
    const postResponse = { success: true, data: { subscriber: newSub }, error: null };

    await setup(page, { subscribers: [], postSubscriberResponse: postResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /add subscriber/i }).click();
    await page.locator('#sub-firstname').fill('Alice');
    await page.locator('#sub-lastname').fill('Smith');
    await page.locator('#sub-ct-value').fill('alice@example.com');
    await page.getByRole('button', { name: /^add subscriber$/i }).click();

    await expect(page.getByRole('dialog', { name: /add subscriber/i })).not.toBeVisible();
  });

  test('shows API error when POST fails', async ({ page }) => {
    const postResponse = {
      success: false, data: null,
      error: { code: 'INVALID_PAYLOAD', message: 'Contact value already in use.' },
    };

    await setup(page, { subscribers: [], postSubscriberResponse: postResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /add subscriber/i }).click();
    await page.locator('#sub-firstname').fill('Alice');
    await page.locator('#sub-lastname').fill('Smith');
    await page.locator('#sub-ct-value').fill('alice@example.com');
    await page.getByRole('button', { name: /^add subscriber$/i }).click();

    await expect(page.getByRole('alert')).toContainText(/contact value already in use/i);
  });
});

// ---------------------------------------------------------------------------
// Edit subscriber modal
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — edit subscriber', () => {
  test('Edit button opens edit modal', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).first().click();
    await expect(page.getByRole('dialog', { name: /edit subscriber/i })).toBeVisible();
  });

  test('edit modal pre-populates firstname and lastname', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).first().click();
    await expect(page.locator('#sub-firstname')).toHaveValue('Alice');
    await expect(page.locator('#sub-lastname')).toHaveValue('Smith');
  });

  test('edit modal saves changes on submit', async ({ page }) => {
    const updated = makeSubscriber({ firstname: 'Alicia' });
    const patchResponse = { success: true, data: { subscriber: updated }, error: null };

    await setup(page, { subscribers: [makeSubscriber()], patchSubscriberResponse: patchResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).first().click();
    await page.locator('#sub-firstname').fill('Alicia');
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('dialog', { name: /edit subscriber/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Add contact
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — add contact', () => {
  test('Add contact button opens the add contact modal', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /\+ add contact/i }).click();
    await expect(page.getByRole('dialog', { name: /add contact/i })).toBeVisible();
  });

  test('add contact modal has channel, value, label and primary fields', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /\+ add contact/i }).click();
    await expect(page.locator('#ct-channel')).toBeVisible();
    await expect(page.locator('#ct-value')).toBeVisible();
    await expect(page.locator('#ct-label')).toBeVisible();
  });

  test('successfully adds a contact and closes modal', async ({ page }) => {
    const newContact = makeContact({ id: CONTACT_ID_2, isPrimary: false, contactValue: 'cell@example.com', channel: 'SMS' });
    const postResponse = { success: true, data: { contact: newContact }, error: null };

    await setup(page, { subscribers: [makeSubscriber()], postContactResponse: postResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /\+ add contact/i }).click();
    await page.locator('#ct-channel').selectOption('sms');
    await page.locator('#ct-value').fill('+15551234567');
    await page.getByRole('button', { name: /^add contact$/i }).click();

    await expect(page.getByRole('dialog', { name: /add contact/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Edit contact (primary flag)
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — edit contact', () => {
  test('Edit link on contact opens edit contact modal', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    // The contact row's Edit button (within the subscriber card)
    await page.getByRole('button', { name: /^edit$/i }).last().click();
    await expect(page.getByRole('dialog', { name: /edit contact/i })).toBeVisible();
  });

  test('edit contact modal pre-populates value', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).last().click();
    await expect(page.locator('#ct-value')).toHaveValue('alice@example.com');
  });

  test('can toggle isPrimary and save', async ({ page }) => {
    const updated = makeContact({ isPrimary: false });
    const patchResponse = { success: true, data: { contact: updated }, error: null };

    await setup(page, { subscribers: [makeSubscriber()], patchContactResponse: patchResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).last().click();
    // Uncheck primary
    const primaryCheckbox = page.getByText(/set as primary contact/i).locator('..').locator('input[type="checkbox"]');
    await primaryCheckbox.uncheck();
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('dialog', { name: /edit contact/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Unsubscribe
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — unsubscribe', () => {
  test('Unsubscribe button opens confirmation dialog', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /unsubscribe alice smith/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm unsubscribe/i })).toBeVisible();
  });

  test('Unsubscribe dialog shows subscriber name', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /unsubscribe alice smith/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm unsubscribe/i })).toContainText('Alice');
  });

  test('Keep button closes unsubscribe dialog', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /unsubscribe alice smith/i }).click();
    await page.getByRole('dialog', { name: /confirm unsubscribe/i }).getByRole('button', { name: /keep/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm unsubscribe/i })).not.toBeVisible();
  });

  test('confirming unsubscribe sends request and closes dialog', async ({ page }) => {
    const updated = makeSubscriber({ status: 'UNSUBSCRIBED' });
    const unsubResponse = { success: true, data: { subscriber: updated }, error: null };

    await setup(page, { subscribers: [makeSubscriber()], unsubscribeResponse: unsubResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /unsubscribe alice smith/i }).click();
    await page.getByRole('dialog', { name: /confirm unsubscribe/i }).getByRole('button', { name: /^unsubscribe$/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm unsubscribe/i })).not.toBeVisible();
  });

  test('Unsubscribe button hidden for already-unsubscribed subscriber', async ({ page }) => {
    await setup(page, {
      subscribers: [makeSubscriber({ status: 'UNSUBSCRIBED' })],
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await expect(page.getByRole('button', { name: /unsubscribe alice smith/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Remove subscriber
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — remove subscriber', () => {
  test('Remove button opens confirmation dialog', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /remove subscriber alice smith/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm remove subscriber/i })).toBeVisible();
  });

  test('Keep button closes the remove dialog', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /remove subscriber alice smith/i }).click();
    await page.getByRole('dialog', { name: /confirm remove subscriber/i }).getByRole('button', { name: /keep/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm remove subscriber/i })).not.toBeVisible();
  });

  test('confirming remove sends request and closes dialog', async ({ page }) => {
    const deleteResponse = { success: true, data: { deleted: true }, error: null };

    await setup(page, { subscribers: [makeSubscriber()], deleteSubscriberResponse: deleteResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /remove subscriber alice smith/i }).click();
    await page.getByRole('dialog', { name: /confirm remove subscriber/i }).getByRole('button', { name: /^remove$/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm remove subscriber/i })).not.toBeVisible();
  });

  test('shows LAST_SUBSCRIBER error when API returns 409', async ({ page }) => {
    const deleteResponse = {
      success: false,
      status: 409,
      data: null,
      error: { code: 'LAST_SUBSCRIBER', message: 'Cannot remove the last active subscriber.' },
    };

    await setup(page, { subscribers: [makeSubscriber()], deleteSubscriberResponse: deleteResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /remove subscriber alice smith/i }).click();
    await page.getByRole('dialog', { name: /confirm remove subscriber/i }).getByRole('button', { name: /^remove$/i }).click();
    await expect(
      page.getByRole('dialog', { name: /confirm remove subscriber/i }).getByRole('alert')
    ).toContainText(/cannot remove the only active subscriber/i);
  });
});

// ---------------------------------------------------------------------------
// Remove contact
// ---------------------------------------------------------------------------

test.describe('Subscribers tab — remove contact', () => {
  test('Remove link on contact opens confirmation dialog', async ({ page }) => {
    await setup(page, { subscribers: [makeSubscriber()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /remove contact alice@example.com/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm remove contact/i })).toBeVisible();
  });

  test('shows LAST_CONTACT error when API returns 409', async ({ page }) => {
    const deleteResponse = {
      success: false,
      status: 409,
      data: null,
      error: { code: 'LAST_CONTACT', message: 'Cannot remove the last active contact.' },
    };

    await setup(page, { subscribers: [makeSubscriber()], deleteContactResponse: deleteResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openSubscribersTab(page);
    await page.getByRole('button', { name: /remove contact alice@example.com/i }).click();
    await page.getByRole('dialog', { name: /confirm remove contact/i }).getByRole('button', { name: /^remove$/i }).click();
    await expect(
      page.getByRole('dialog', { name: /confirm remove contact/i }).getByRole('alert')
    ).toContainText(/cannot remove the only active contact/i);
  });
});
