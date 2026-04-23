import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID    = 'user-123';
const EVENT_ID   = 'evt-001';
const REM_ID     = 'rem-001';

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

function makeReminder(overrides = {}) {
  return {
    id:              REM_ID,
    eventId:         EVENT_ID,
    remindAt:        '2026-06-14T09:00:00.000Z',
    subjectTemplate: 'Reminder: {{event_subject}}',
    bodyTemplate:    '<p>Hi {{subscriber_firstname}}, reminder for {{event_subject}}.</p>',
    channels:        ['EMAIL'],
    recurrence:      'NEVER',
    status:          'SCHEDULED',
    occurrenceCount: 0,
    createdAt:       '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

/**
 * Sets up:
 *  - localStorage token
 *  - GET /events/:id mock
 *  - GET /events/:id/reminders mock
 *  - Optional: POST /events/:id/reminders mock
 *  - Optional: PATCH /events/:id/reminders/:rid mock
 *  - Optional: DELETE /events/:id/reminders/:rid mock
 *  - Optional: POST /events/:id/reminders/:rid/preview mock
 */
async function setup(page, options = {}) {
  const {
    event          = makeEvent(),
    reminders      = [],
    postReminderResponse = null,
    patchReminderResponse = null,
    deleteReminderResponse = null,
    previewResponse = null,
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

  // GET /events/:id/reminders
  await page.route(`**/api/v1/events/${EVENT_ID}/reminders`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { reminders }, error: null }),
      });
    }
    if (method === 'POST' && postReminderResponse) {
      return route.fulfill({
        status: postReminderResponse.success ? 201 : 422,
        contentType: 'application/json',
        body: JSON.stringify(postReminderResponse),
      });
    }
    return route.fallback();
  });

  // PATCH / DELETE / preview for specific reminder
  await page.route(`**/api/v1/events/${EVENT_ID}/reminders/${REM_ID}`, async (route) => {
    const method = route.request().method();
    if (method === 'PATCH' && patchReminderResponse) {
      return route.fulfill({
        status: patchReminderResponse.success ? 200 : 422,
        contentType: 'application/json',
        body: JSON.stringify(patchReminderResponse),
      });
    }
    if (method === 'DELETE' && deleteReminderResponse) {
      return route.fulfill({
        status: deleteReminderResponse.success ? 200 : 403,
        contentType: 'application/json',
        body: JSON.stringify(deleteReminderResponse),
      });
    }
    return route.fallback();
  });

  // Preview
  await page.route(`**/api/v1/events/${EVENT_ID}/reminders/${REM_ID}/preview`, async (route) => {
    if (previewResponse) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(previewResponse),
      });
    }
    return route.fallback();
  });
}

async function openRemindersTab(page) {
  await page.getByRole('tab', { name: /reminders/i }).click();
}

// ---------------------------------------------------------------------------
// Tab navigation
// ---------------------------------------------------------------------------

test.describe('Event detail page — tabs', () => {
  test('shows Details tab by default', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('tab', { name: /details/i })).toBeVisible();
    await expect(page.getByRole('tab', { name: /reminders/i })).toBeVisible();
    // Details content should be visible by default
    await expect(page.getByRole('form', { name: /edit event/i })).toBeVisible();
  });

  test('switching to Reminders tab shows reminders section', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByLabel('Reminders', { exact: true })).toBeVisible();
  });

  test('switching back to Details tab shows the event form', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('tab', { name: /details/i }).click();
    await expect(page.getByRole('form', { name: /edit event/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Reminders tab — empty state
// ---------------------------------------------------------------------------

test.describe('Reminders tab — empty state', () => {
  test('shows "No reminders yet" when list is empty', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByText(/no reminders yet/i)).toBeVisible();
  });

  test('shows Add reminder button for owner of ACTIVE event', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByRole('button', { name: /add reminder/i })).toBeVisible();
  });

  test('hides Add reminder button for non-owner (read-only)', async ({ page }) => {
    await setup(page, {
      event: makeEvent({ ownerId: 'other-456' }),
      reminders: [],
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    // Readers cannot create
    await expect(page.getByRole('button', { name: /add reminder/i })).not.toBeVisible();
  });

  test('hides Add reminder button for CANCELLED event', async ({ page }) => {
    await setup(page, {
      event: makeEvent({ status: 'CANCELLED' }),
      reminders: [],
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByRole('button', { name: /add reminder/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Reminders tab — list display
// ---------------------------------------------------------------------------

test.describe('Reminders tab — list display', () => {
  test('shows reminder subject template', async ({ page }) => {
    await setup(page, { reminders: [makeReminder()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByRole('list', { name: 'Reminders list' }).getByText('Reminder: {{event_subject}}')).toBeVisible();
  });

  test('shows reminder status badge (SCHEDULED)', async ({ page }) => {
    await setup(page, { reminders: [makeReminder()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByRole('list', { name: 'Reminders list' }).getByLabel(/reminder status: scheduled/i)).toBeVisible();
  });

  test('shows reminder status badge (SENT)', async ({ page }) => {
    await setup(page, { reminders: [makeReminder({ status: 'SENT' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByRole('list', { name: 'Reminders list' }).getByLabel(/reminder status: sent/i)).toBeVisible();
  });

  test('shows recurrence badge for non-NEVER recurrence', async ({ page }) => {
    await setup(page, { reminders: [makeReminder({ recurrence: 'DAILY' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByLabel(/recurrence: daily/i)).toBeVisible();
  });

  test('does not show recurrence badge when recurrence is NEVER', async ({ page }) => {
    await setup(page, { reminders: [makeReminder({ recurrence: 'NEVER' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByLabel(/recurrence: never/i)).not.toBeVisible();
  });

  test('shows channels in reminder row', async ({ page }) => {
    await setup(page, { reminders: [makeReminder({ channels: ['EMAIL', 'SMS'] })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByText(/email/i)).toBeVisible();
  });

  test('shows occurrence count when > 0', async ({ page }) => {
    await setup(page, { reminders: [makeReminder({ occurrenceCount: 3 })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByText(/occurrences sent.*3|3.*occurrences sent/i)).toBeVisible();
  });

  test('shows reminder count in header', async ({ page }) => {
    await setup(page, { reminders: [makeReminder(), makeReminder({ id: 'rem-002', subjectTemplate: 'Second reminder' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByText(/reminders.*\(2\)/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Add reminder modal
// ---------------------------------------------------------------------------

test.describe('Reminders tab — add reminder modal', () => {
  test('opens Add reminder modal on button click', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    await expect(page.getByRole('dialog', { name: /add reminder/i })).toBeVisible();
  });

  test('modal has remind-at, subject, body, channels, recurrence fields', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    await expect(page.getByLabel(/remind at/i)).toBeVisible();
    await expect(page.getByLabel(/subject template/i)).toBeVisible();
    await expect(page.getByLabel(/body template/i)).toBeVisible();
    await expect(page.getByLabel(/email/i)).toBeVisible();
    await expect(page.getByLabel(/sms/i)).toBeVisible();
    await expect(page.getByLabel(/recurrence/i)).toBeVisible();
  });

  test('Cancel button closes the modal', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(page.getByRole('dialog', { name: /add reminder/i })).not.toBeVisible();
  });

  test('shows validation error when remind-at is empty', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    await page.getByLabel(/subject template/i).fill('Test subject');
    await page.getByLabel(/body template/i).fill('Test body');
    await page.getByLabel(/email/i).check();
    // Leave remind-at empty
    await page.getByRole('button', { name: /^add reminder$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/remind at.*required|required.*remind at/i);
  });

  test('shows validation error when subject template is empty', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    await page.getByLabel(/remind at/i).fill('2026-06-14T09:00');
    await page.getByLabel(/body template/i).fill('Test body');
    await page.getByLabel(/email/i).check();
    // Leave subject empty
    await page.getByRole('button', { name: /^add reminder$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/subject template.*required|required.*subject template/i);
  });

  test('shows validation error when no channel selected', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    await page.getByLabel(/remind at/i).fill('2026-06-14T09:00');
    await page.getByLabel(/subject template/i).fill('Test subject');
    await page.getByLabel(/body template/i).fill('Test body');
    // No channel selected
    await page.getByRole('button', { name: /^add reminder$/i }).click();
    await expect(page.getByRole('alert')).toContainText(/channel/i);
  });

  test('successfully submits and closes modal', async ({ page }) => {
    const newReminder = makeReminder();
    const postResponse = { success: true, data: { reminder: newReminder }, error: null };

    await setup(page, { reminders: [], postReminderResponse: postResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    await page.getByLabel(/remind at/i).fill('2026-06-14T09:00');
    await page.getByLabel(/subject template/i).fill('Reminder: {{event_subject}}');
    await page.getByLabel(/body template/i).fill('<p>Test body</p>');
    await page.getByLabel(/email/i).check();
    await page.getByRole('button', { name: /^add reminder$/i }).click();

    // Modal closes on success
    await expect(page.getByRole('dialog', { name: /add reminder/i })).not.toBeVisible();
  });

  test('shows API error when POST fails', async ({ page }) => {
    const postResponse = {
      success: false, data: null,
      error: { code: 'INVALID_PAYLOAD', message: 'remind_at must be in the future.' },
    };

    await setup(page, { reminders: [], postReminderResponse: postResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    await page.getByLabel(/remind at/i).fill('2026-06-14T09:00');
    await page.getByLabel(/subject template/i).fill('Test');
    await page.getByLabel(/body template/i).fill('<p>Test</p>');
    await page.getByLabel(/email/i).check();
    await page.getByRole('button', { name: /^add reminder$/i }).click();

    await expect(page.getByRole('alert')).toContainText(/remind_at must be in the future/i);
  });
});

// ---------------------------------------------------------------------------
// Edit reminder modal
// ---------------------------------------------------------------------------

test.describe('Reminders tab — edit reminder', () => {
  test('Edit button opens edit modal for SCHEDULED reminder', async ({ page }) => {
    await setup(page, { reminders: [makeReminder()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.getByRole('dialog', { name: /edit reminder/i })).toBeVisible();
  });

  test('edit modal pre-populates subject template', async ({ page }) => {
    await setup(page, { reminders: [makeReminder()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.getByLabel(/subject template/i)).toHaveValue('Reminder: {{event_subject}}');
  });

  test('edit modal pre-populates recurrence', async ({ page }) => {
    await setup(page, { reminders: [makeReminder({ recurrence: 'WEEKLY' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.locator('#rm-recurrence')).toHaveValue('WEEKLY');
  });

  test('Edit button is hidden for SENT reminder (non-editable)', async ({ page }) => {
    await setup(page, { reminders: [makeReminder({ status: 'SENT' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await expect(page.getByRole('button', { name: /^edit$/i })).not.toBeVisible();
  });

  test('successfully saves edit and closes modal', async ({ page }) => {
    const updated = makeReminder({ subjectTemplate: 'Updated: {{event_subject}}' });
    const patchResponse = { success: true, data: { reminder: updated }, error: null };

    await setup(page, { reminders: [makeReminder()], patchReminderResponse: patchResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).click();
    await page.getByLabel(/subject template/i).fill('Updated: {{event_subject}}');
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('dialog', { name: /edit reminder/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Cancel reminder
// ---------------------------------------------------------------------------

test.describe('Reminders tab — cancel reminder', () => {
  test('Cancel button shows confirmation dialog', async ({ page }) => {
    await setup(page, { reminders: [makeReminder()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /cancel reminder/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm cancel reminder/i })).toBeVisible();
  });

  test('Keep button dismisses the confirmation dialog', async ({ page }) => {
    await setup(page, { reminders: [makeReminder()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /cancel reminder/i }).click();
    await page.getByRole('button', { name: /^keep$/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm cancel reminder/i })).not.toBeVisible();
  });

  test('confirms cancel via DELETE and removes dialog', async ({ page }) => {
    const deleteResponse = { success: true, data: { deleted: true }, error: null };

    await setup(page, { reminders: [makeReminder()], deleteReminderResponse: deleteResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /cancel reminder/i }).click();
    await page.getByRole('button', { name: /^cancel reminder$/i }).click();
    await expect(page.getByRole('dialog', { name: /confirm cancel reminder/i })).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Occurrence preview
// ---------------------------------------------------------------------------

test.describe('Reminders tab — occurrence preview', () => {
  test('Preview occurrence button appears in edit modal', async ({ page }) => {
    await setup(page, { reminders: [makeReminder()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).click();
    await expect(page.getByRole('button', { name: /preview occurrence/i })).toBeVisible();
  });

  test('clicking Preview shows rendered subject and body', async ({ page }) => {
    const previewResponse = {
      success: true,
      data: {
        renderedSubject: 'Reminder: Annual Team Meeting',
        renderedBody: '<p>Hi John, reminder for Annual Team Meeting.</p>',
        nextRemindAt: '2026-06-14T09:00:00.000Z',
      },
      error: null,
    };

    await setup(page, { reminders: [makeReminder()], previewResponse });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /^edit$/i }).click();
    await page.getByRole('button', { name: /preview occurrence/i }).click();

    await expect(page.getByLabel(/occurrence preview/i)).toBeVisible();
    await expect(page.getByText('Reminder: Annual Team Meeting')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Recurrence options in select
// ---------------------------------------------------------------------------

test.describe('Reminders tab — recurrence select options', () => {
  test('recurrence select has all 11 options', async ({ page }) => {
    await setup(page, { reminders: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openRemindersTab(page);
    await page.getByRole('button', { name: /add reminder/i }).click();
    const options = await page.getByLabel(/recurrence/i).locator('option').allTextContents();
    expect(options.length).toBe(11);
    expect(options.some(o => /never/i.test(o))).toBe(true);
    expect(options.some(o => /yearly/i.test(o))).toBe(true);
    expect(options.some(o => /fortnightly/i.test(o))).toBe(true);
  });
});
