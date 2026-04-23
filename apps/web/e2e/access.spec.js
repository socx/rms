import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID       = 'user-123';
const EVENT_ID      = 'evt-001';
const GRANT_USER_ID = 'user-456';
const GRANT_ID      = 'grant-001';

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

function makeGrant(overrides = {}) {
  return {
    id:          GRANT_ID,
    eventId:     EVENT_ID,
    userId:      GRANT_USER_ID,
    role:        'CONTRIBUTOR',
    grantedById: USER_ID,
    createdAt:   '2026-01-01T00:00:00.000Z',
    user: {
      id:        GRANT_USER_ID,
      firstname: 'Bob',
      lastname:  'Jones',
      email:     'bob@example.com',
    },
    ...overrides,
  };
}

/**
 * Sets up route mocks for the Access tab tests.
 */
async function setup(page, options = {}) {
  const {
    event                = makeEvent(),
    grants               = [],
    postGrantResponse    = null,
    patchGrantResponse   = null,
    deleteGrantResponse  = null,
    transferOwnerResponse = null,
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

  // GET / POST /events/:id/access
  await page.route(`**/api/v1/events/${EVENT_ID}/access`, async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { grants }, error: null }),
      });
    }
    if (method === 'POST' && postGrantResponse) {
      return route.fulfill({
        status: postGrantResponse.success ? 201 : (postGrantResponse.status ?? 400),
        contentType: 'application/json',
        body: JSON.stringify(postGrantResponse),
      });
    }
    return route.fallback();
  });

  // PATCH / DELETE /events/:id/access/:uid
  await page.route(`**/api/v1/events/${EVENT_ID}/access/${GRANT_USER_ID}`, async (route) => {
    const method = route.request().method();
    if (method === 'PATCH' && patchGrantResponse) {
      return route.fulfill({
        status: patchGrantResponse.success ? 200 : (patchGrantResponse.status ?? 400),
        contentType: 'application/json',
        body: JSON.stringify(patchGrantResponse),
      });
    }
    if (method === 'DELETE' && deleteGrantResponse) {
      return route.fulfill({
        status: deleteGrantResponse.success ? 200 : (deleteGrantResponse.status ?? 400),
        contentType: 'application/json',
        body: JSON.stringify(deleteGrantResponse),
      });
    }
    return route.fallback();
  });

  // PATCH /events/:id/owner
  await page.route(`**/api/v1/events/${EVENT_ID}/owner`, async (route) => {
    if (route.request().method() === 'PATCH' && transferOwnerResponse) {
      return route.fulfill({
        status: transferOwnerResponse.success ? 200 : (transferOwnerResponse.status ?? 403),
        contentType: 'application/json',
        body: JSON.stringify(transferOwnerResponse),
      });
    }
    return route.fallback();
  });
}

async function openAccessTab(page) {
  await page.getByRole('tab', { name: /^access$/i }).click();
}

// ---------------------------------------------------------------------------
// Tab navigation — visibility
// ---------------------------------------------------------------------------

test.describe('Event detail page — Access tab', () => {
  test('Access tab is visible in tab bar for event owner', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('tab', { name: /^access$/i })).toBeVisible();
  });

  test('Access tab is NOT visible for non-owner (contributor)', async ({ page }) => {
    await setup(page, { event: makeEvent({ ownerId: 'other-user-999' }) });
    await page.goto(`/events/${EVENT_ID}`);
    await expect(page.getByRole('tab', { name: /^access$/i })).not.toBeVisible();
  });

  test('clicking Access tab shows the Access section', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);
    await expect(page.getByLabel('Access')).toBeVisible();
  });

  test('switching back to Details tab hides Access section', async ({ page }) => {
    await setup(page);
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);
    await page.getByRole('tab', { name: /details/i }).click();
    await expect(page.getByLabel('Access')).not.toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

test.describe('Access tab — empty state', () => {
  test('shows empty message when there are no grants', async ({ page }) => {
    await setup(page, { grants: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await expect(page.getByText(/no access grants yet/i)).toBeVisible();
  });

  test('shows Grant access button for owner', async ({ page }) => {
    await setup(page, { grants: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await expect(page.getByRole('button', { name: /grant access/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Grant list display
// ---------------------------------------------------------------------------

test.describe('Access tab — grant list', () => {
  test('shows grantee name and email', async ({ page }) => {
    await setup(page, { grants: [makeGrant()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await expect(page.getByText('Bob Jones')).toBeVisible();
    await expect(page.getByText('bob@example.com')).toBeVisible();
  });

  test('shows CONTRIBUTOR role badge', async ({ page }) => {
    await setup(page, { grants: [makeGrant({ role: 'CONTRIBUTOR' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await expect(page.getByLabel('Role: CONTRIBUTOR')).toBeVisible();
  });

  test('shows READER role badge', async ({ page }) => {
    await setup(page, { grants: [makeGrant({ role: 'READER' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await expect(page.getByLabel('Role: READER')).toBeVisible();
  });

  test('shows Edit role and Revoke buttons for each grant', async ({ page }) => {
    await setup(page, { grants: [makeGrant()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await expect(page.getByRole('button', { name: /edit role for bob jones/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /revoke access for bob jones/i })).toBeVisible();
  });

  test('shows count in header when grants exist', async ({ page }) => {
    await setup(page, { grants: [makeGrant()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await expect(page.getByText('Access (1)')).toBeVisible();
  });

  test('shows multiple grants', async ({ page }) => {
    const grant2 = makeGrant({
      id:     'grant-002',
      userId: 'user-789',
      role:   'READER',
      user:   { id: 'user-789', firstname: 'Carol', lastname: 'White', email: 'carol@example.com' },
    });
    await setup(page, { grants: [makeGrant(), grant2] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await expect(page.getByText('Bob Jones')).toBeVisible();
    await expect(page.getByText('Carol White')).toBeVisible();
    await expect(page.getByText('Access (2)')).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Grant access modal
// ---------------------------------------------------------------------------

test.describe('Access tab — Grant access modal', () => {
  test('opens modal on button click', async ({ page }) => {
    await setup(page, { grants: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();

    await expect(page.getByRole('dialog', { name: /grant access/i })).toBeVisible();
  });

  test('closes modal on Cancel click', async ({ page }) => {
    await setup(page, { grants: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();
    await page.getByRole('button', { name: /cancel/i }).click();

    await expect(page.getByRole('dialog', { name: /grant access/i })).not.toBeVisible();
  });

  test('closes modal on backdrop click', async ({ page }) => {
    await setup(page, { grants: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();
    // click backdrop (outside dialog box)
    await page.mouse.click(10, 10);

    await expect(page.getByRole('dialog', { name: /grant access/i })).not.toBeVisible();
  });

  test('shows validation error when submitting empty user ID', async ({ page }) => {
    await setup(page, { grants: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();
    await page.getByRole('button', { name: /^grant access$/i }).click();

    await expect(page.getByRole('alert')).toContainText(/user id is required/i);
  });

  test('successfully grants access and closes modal', async ({ page }) => {
    const newGrant = makeGrant();
    await setup(page, {
      grants: [],
      postGrantResponse: { success: true, data: { grant: newGrant }, error: null },
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();
    await page.locator('#grant-user-id').fill(GRANT_USER_ID);
    await page.locator('#grant-role').selectOption('CONTRIBUTOR');
    await page.getByRole('button', { name: /^grant access$/i }).click();

    await expect(page.getByRole('dialog', { name: /grant access/i })).not.toBeVisible();
  });

  test('shows ACCESS_EXISTS error from API', async ({ page }) => {
    await setup(page, {
      grants: [],
      postGrantResponse: {
        success: false,
        status:  409,
        data:    null,
        error:   { code: 'ACCESS_EXISTS', message: 'User already has access.' },
      },
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();
    await page.locator('#grant-user-id').fill(GRANT_USER_ID);
    await page.getByRole('button', { name: /^grant access$/i }).click();

    await expect(page.getByRole('alert')).toContainText(/already has access/i);
  });

  test('shows USER_IS_OWNER error from API', async ({ page }) => {
    await setup(page, {
      grants: [],
      postGrantResponse: {
        success: false,
        status:  400,
        data:    null,
        error:   { code: 'USER_IS_OWNER', message: 'User is the event owner.' },
      },
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();
    await page.locator('#grant-user-id').fill(USER_ID);
    await page.getByRole('button', { name: /^grant access$/i }).click();

    await expect(page.getByRole('alert')).toContainText(/already the owner/i);
  });

  test('shows USER_NOT_FOUND error from API', async ({ page }) => {
    await setup(page, {
      grants: [],
      postGrantResponse: {
        success: false,
        status:  400,
        data:    null,
        error:   { code: 'USER_NOT_FOUND', message: 'User not found.' },
      },
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();
    await page.locator('#grant-user-id').fill('unknown-id');
    await page.getByRole('button', { name: /^grant access$/i }).click();

    await expect(page.getByRole('alert')).toContainText(/no active user found/i);
  });

  test('role select defaults to CONTRIBUTOR', async ({ page }) => {
    await setup(page, { grants: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();

    await expect(page.locator('#grant-role')).toHaveValue('CONTRIBUTOR');
  });

  test('can switch role to READER in modal', async ({ page }) => {
    await setup(page, { grants: [] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /grant access/i }).click();
    await page.locator('#grant-role').selectOption('READER');

    await expect(page.locator('#grant-role')).toHaveValue('READER');
  });
});

// ---------------------------------------------------------------------------
// Edit role modal
// ---------------------------------------------------------------------------

test.describe('Access tab — Edit role modal', () => {
  test('opens edit modal on Edit role button click', async ({ page }) => {
    await setup(page, { grants: [makeGrant()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /edit role for bob jones/i }).click();

    await expect(page.getByRole('dialog', { name: /edit access role/i })).toBeVisible();
  });

  test('edit modal shows grantee name', async ({ page }) => {
    await setup(page, { grants: [makeGrant()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /edit role for bob jones/i }).click();

    await expect(page.getByRole('dialog', { name: /edit access role/i })).toContainText('Bob Jones');
  });

  test('closes edit modal on Cancel', async ({ page }) => {
    await setup(page, { grants: [makeGrant()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /edit role for bob jones/i }).click();
    await page.getByRole('button', { name: /cancel/i }).click();

    await expect(page.getByRole('dialog', { name: /edit access role/i })).not.toBeVisible();
  });

  test('role select pre-filled with current role', async ({ page }) => {
    await setup(page, { grants: [makeGrant({ role: 'READER' })] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /edit role for bob jones/i }).click();

    await expect(page.locator('#edit-grant-role')).toHaveValue('READER');
  });

  test('successfully updates role and closes modal', async ({ page }) => {
    const updatedGrant = makeGrant({ role: 'READER' });
    await setup(page, {
      grants: [makeGrant()],
      patchGrantResponse: { success: true, data: { grant: updatedGrant }, error: null },
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /edit role for bob jones/i }).click();
    await page.locator('#edit-grant-role').selectOption('READER');
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('dialog', { name: /edit access role/i })).not.toBeVisible();
  });

  test('shows error when role update fails', async ({ page }) => {
    await setup(page, {
      grants: [makeGrant()],
      patchGrantResponse: {
        success: false,
        status:  400,
        data:    null,
        error:   { code: 'CANNOT_CHANGE_OWNER_ROLE', message: 'Cannot change the role of the event owner.' },
      },
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /edit role for bob jones/i }).click();
    await page.getByRole('button', { name: /save changes/i }).click();

    await expect(page.getByRole('alert')).toContainText(/cannot change/i);
  });
});

// ---------------------------------------------------------------------------
// Revoke access
// ---------------------------------------------------------------------------

test.describe('Access tab — Revoke access', () => {
  test('opens revoke confirmation dialog on Revoke click', async ({ page }) => {
    await setup(page, { grants: [makeGrant()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /revoke access for bob jones/i }).click();

    await expect(page.getByRole('dialog', { name: /confirm revoke access/i })).toBeVisible();
  });

  test('Keep button closes the revoke dialog without revoking', async ({ page }) => {
    await setup(page, { grants: [makeGrant()] });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /revoke access for bob jones/i }).click();
    await page.getByRole('button', { name: /^keep$/i }).click();

    await expect(page.getByRole('dialog', { name: /confirm revoke access/i })).not.toBeVisible();
    await expect(page.getByText('Bob Jones')).toBeVisible();
  });

  test('Revoke access button in dialog calls DELETE and closes', async ({ page }) => {
    await setup(page, {
      grants: [makeGrant()],
      deleteGrantResponse: {
        success: true,
        data:    { message: 'Access revoked.' },
        error:   null,
      },
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /revoke access for bob jones/i }).click();
    await page.getByRole('button', { name: /^revoke access$/i }).click();

    await expect(page.getByRole('dialog', { name: /confirm revoke access/i })).not.toBeVisible();
  });

  test('shows error in dialog when revoke fails', async ({ page }) => {
    await setup(page, {
      grants: [makeGrant()],
      deleteGrantResponse: {
        success: false,
        status:  400,
        data:    null,
        error:   { code: 'CANNOT_REVOKE_OWNER', message: 'Cannot revoke access for the event owner.' },
      },
    });
    await page.goto(`/events/${EVENT_ID}`);
    await openAccessTab(page);

    await page.getByRole('button', { name: /revoke access for bob jones/i }).click();
    await page.getByRole('button', { name: /^revoke access$/i }).click();

    await expect(page.getByRole('dialog', { name: /confirm revoke access/i })).toBeVisible();
    await expect(page.getByRole('alert')).toContainText(/cannot revoke/i);
  });
});
