import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN  = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID     = 'user-123';
const EVENT_ID    = 'evt-001';
const REMINDER_ID = 'rem-001';
const REPORT_ID   = 'rpt-001';

function makeEvent(overrides = {}) {
  return {
    id:            EVENT_ID,
    ownerId:       USER_ID,
    subject:       'Annual Kickoff',
    eventDatetime: '2026-06-15T09:00:00.000Z',
    eventTimezone: 'UTC',
    status:        'ACTIVE',
    createdAt:     '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReminder(overrides = {}) {
  return {
    id:              REMINDER_ID,
    eventId:         EVENT_ID,
    subjectTemplate: 'Reminder: {{event_subject}}',
    bodyTemplate:    '<p>Hi {{subscriber_firstname}}.</p>',
    channels:        ['email'],
    recurrence:      'NEVER',
    status:          'SENT',
    occurrenceCount: 2,
    remindAt:        '2026-06-14T09:00:00.000Z',
    createdAt:       '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeReport(overrides = {}) {
  return {
    id:               REPORT_ID,
    reminderId:       REMINDER_ID,
    occurrenceNumber: 1,
    totalDispatches:  10,
    totalSent:        8,
    totalFailed:      2,
    totalSkipped:     0,
    failureDetails:   [{ email: 'fail@example.com', reason: 'SMTP timeout', channel: 'EMAIL' }],
    reportSentToOwner: true,
    reportSentAt:     '2026-06-14T09:05:00.000Z',
    createdAt:        '2026-06-14T09:01:00.000Z',
    ...overrides,
  };
}

/**
 * Sets up route mocks and localStorage token for Reports tab tests.
 */
async function setup(page, options = {}) {
  const {
    event              = makeEvent(),
    reminders          = [],
    reports            = [],
    reportsPagination  = null,
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
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { reminders }, error: null }),
      });
    }
    return route.fallback();
  });

  // GET /events/:id/reminders/:rid/report  (** suffix matches ?page=n&per_page=n query params)
  const pag = reportsPagination ?? { page: 1, per_page: 20, total: reports.length };
  await page.route(`**/api/v1/events/${EVENT_ID}/reminders/${REMINDER_ID}/report**`, async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data:    { reports },
          meta:    pag,
          error:   null,
        }),
      });
    }
    return route.fallback();
  });

  // GET /events/:id/access (needed by EventDetailPage for grant list)
  await page.route(`**/api/v1/events/${EVENT_ID}/access`, async (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { grants: [] }, error: null }),
      });
    }
    return route.fallback();
  });
}

async function openReportsTab(page) {
  await page.goto(`/events/${EVENT_ID}`);
  await page.getByRole('tab', { name: /^reports$/i }).click();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Reports tab', () => {

  // ── Tab visibility ──────────────────────────────────────────────────────

  test.describe('Tab visibility', () => {
    test('Reports tab is visible for owner', async ({ page }) => {
      await setup(page, { event: makeEvent() });
      await page.goto(`/events/${EVENT_ID}`);
      await expect(page.getByRole('tab', { name: /^reports$/i })).toBeVisible();
    });

    test('Reports tab is visible for contributor', async ({ page }) => {
      await setup(page, {
        event: makeEvent({ ownerId: 'other-user', myRole: 'CONTRIBUTOR' }),
      });
      await page.goto(`/events/${EVENT_ID}`);
      await expect(page.getByRole('tab', { name: /^reports$/i })).toBeVisible();
    });

    test('Reports tab is visible for reader', async ({ page }) => {
      await setup(page, {
        event: makeEvent({ ownerId: 'other-user', myRole: 'READER' }),
      });
      await page.goto(`/events/${EVENT_ID}`);
      await expect(page.getByRole('tab', { name: /^reports$/i })).toBeVisible();
    });
  });

  // ── Empty state (no reminders) ──────────────────────────────────────────

  test.describe('Empty state', () => {
    test('shows empty state when no reminders exist', async ({ page }) => {
      await setup(page, { reminders: [] });
      await openReportsTab(page);
      await expect(page.getByLabel('No reminders')).toBeVisible();
    });

    test('shows hint to add reminders first', async ({ page }) => {
      await setup(page, { reminders: [] });
      await openReportsTab(page);
      await expect(page.getByText(/Add reminders first/i)).toBeVisible();
    });
  });

  // ── Reminder list ───────────────────────────────────────────────────────

  test.describe('Reminder list', () => {
    test('shows reminder subject template', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()] });
      await openReportsTab(page);
      // Scope to the Reports region to avoid matching the same text in the hidden Reminders tab
      const region = page.getByRole('region', { name: 'Reports' });
      await expect(region.getByText('Reminder: {{event_subject}}')).toBeVisible();
    });

    test('shows reminder status badge', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()] });
      await openReportsTab(page);
      const region = page.getByRole('region', { name: 'Reports' });
      await expect(region.getByLabel('Reminder status: SENT')).toBeVisible();
    });

    test('shows occurrence count', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()] });
      await openReportsTab(page);
      await expect(page.getByText('2 occurrences')).toBeVisible();
    });

    test('shows singular "occurrence" for count of 1', async ({ page }) => {
      await setup(page, { reminders: [makeReminder({ occurrenceCount: 1 })] });
      await openReportsTab(page);
      await expect(page.getByText('1 occurrence')).toBeVisible();
    });

    test('shows multiple reminders', async ({ page }) => {
      await setup(page, {
        reminders: [
          makeReminder({ id: 'rem-001', subjectTemplate: 'First reminder' }),
          makeReminder({ id: 'rem-002', subjectTemplate: 'Second reminder' }),
        ],
      });
      await openReportsTab(page);
      const region = page.getByRole('region', { name: 'Reports' });
      await expect(region.getByText('First reminder')).toBeVisible();
      await expect(region.getByText('Second reminder')).toBeVisible();
    });
  });

  // ── Reports panel (accordion) ───────────────────────────────────────────

  test.describe('Reports panel', () => {
    test('clicking reminder accordion loads reports panel', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [] });
      await openReportsTab(page);
      const btn = page.getByLabel(/toggle reports for Reminder: \{\{event_subject\}\}/i);
      await btn.click();
      await expect(page.getByLabel('No reports')).toBeVisible();
    });

    test('shows "No reports yet" when reports list is empty', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [] });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByText(/No reports yet/i)).toBeVisible();
    });

    test('shows occurrence reports table when reports exist', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [makeReport()] });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByRole('table', { name: 'Occurrence reports' })).toBeVisible();
    });

    test('shows occurrence number in table row', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [makeReport()] });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByText('#1')).toBeVisible();
    });

    test('shows sent count in table row', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [makeReport({ totalSent: 8 })] });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      const table = page.getByRole('table', { name: 'Occurrence reports' });
      await expect(table.getByRole('row').nth(1).getByText('8')).toBeVisible();
    });

    test('shows failed count in table row', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [makeReport({ totalFailed: 2 })] });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      const table = page.getByRole('table', { name: 'Occurrence reports' });
      await expect(table.getByRole('row').nth(1).getByText('2', { exact: true })).toBeVisible();
    });

    test('accordion closes on second click', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [makeReport()] });
      await openReportsTab(page);
      const btn = page.getByLabel(/toggle reports/i);
      await btn.click();
      await expect(page.getByRole('table', { name: 'Occurrence reports' })).toBeVisible();
      await btn.click();
      await expect(page.getByRole('table', { name: 'Occurrence reports' })).not.toBeVisible();
    });
  });

  // ── Failure details ─────────────────────────────────────────────────────

  test.describe('Failure details', () => {
    test('shows "Show details" button when failures exist', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [makeReport()] });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByLabel(/show failure details for occurrence 1/i)).toBeVisible();
    });

    test('does not show "Show details" button when no failures', async ({ page }) => {
      await setup(page, {
        reminders: [makeReminder()],
        reports: [makeReport({ totalFailed: 0, failureDetails: null })],
      });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByLabel(/show failure details/i)).not.toBeVisible();
    });

    test('expands failure details on click', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [makeReport()] });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await page.getByLabel(/show failure details for occurrence 1/i).click();
      await expect(page.getByText('Failure details')).toBeVisible();
    });

    test('collapses failure details on second click', async ({ page }) => {
      await setup(page, { reminders: [makeReminder()], reports: [makeReport()] });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await page.getByLabel(/show failure details for occurrence 1/i).click();
      await page.getByLabel(/hide failure details for occurrence 1/i).click();
      await expect(page.getByText('Failure details')).not.toBeVisible();
    });
  });

  // ── Owner notification ──────────────────────────────────────────────────

  test.describe('Owner notification badge', () => {
    test('shows "Sent" timestamp when reportSentToOwner is true', async ({ page }) => {
      await setup(page, {
        reminders: [makeReminder()],
        reports:   [makeReport({ reportSentToOwner: true, reportSentAt: '2026-06-14T09:05:00.000Z' })],
      });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByText(/^Sent /)).toBeVisible();
    });

    test('shows "Not sent" when reportSentToOwner is false', async ({ page }) => {
      await setup(page, {
        reminders: [makeReminder()],
        reports:   [makeReport({ reportSentToOwner: false, reportSentAt: null })],
      });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByText('Not sent')).toBeVisible();
    });
  });

  // ── Pagination ──────────────────────────────────────────────────────────

  test.describe('Pagination', () => {
    test('shows pagination controls when there are multiple pages', async ({ page }) => {
      await setup(page, {
        reminders:         [makeReminder()],
        reports:           [makeReport()],
        // total:25 with component's hardcoded perPage:20 → Math.ceil(25/20)=2 pages
        reportsPagination: { page: 1, per_page: 20, total: 25 },
      });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByLabel('Next page')).toBeVisible();
      await expect(page.getByLabel('Previous page')).toBeVisible();
    });

    test('Previous page button is disabled on page 1', async ({ page }) => {
      await setup(page, {
        reminders:         [makeReminder()],
        reports:           [makeReport()],
        reportsPagination: { page: 1, per_page: 20, total: 25 },
      });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByLabel('Previous page')).toBeDisabled();
    });

    test('does not show pagination when all results fit on one page', async ({ page }) => {
      await setup(page, {
        reminders: [makeReminder()],
        reports:   [makeReport()],
        reportsPagination: { page: 1, per_page: 20, total: 1 },
      });
      await openReportsTab(page);
      await page.getByLabel(/toggle reports/i).click();
      await expect(page.getByLabel('Next page')).not.toBeVisible();
    });
  });
});
