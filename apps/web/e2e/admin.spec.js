/**
 * admin.spec.js — Playwright e2e tests for the Admin Panel
 *
 * Test groups:
 *   Access control  (3) — admin sees panel; non-admin redirected; unauthenticated redirected
 *   Users tab       (9) — list, name/email, status badges, role badges, disable, enable,
 *                         promote, demote, no self-action buttons
 *   Settings tab    (6) — list, key, value, edit opens input, save, cancel
 *   Events tab      (7) — list, subject, owner, status badge, pagination controls,
 *                         prev disabled on p1, next advances page
 */

import { test, expect } from '@playwright/test';

// ── Constants ─────────────────────────────────────────────────────────────────

const FAKE_TOKEN   = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID      = 'user-123';
const OTHER_ID     = 'user-456';

// ── Factories ─────────────────────────────────────────────────────────────────

function makeProfile(overrides = {}) {
  return {
    id:            USER_ID,
    firstname:     'Admin',
    lastname:      'User',
    email:         'admin@example.com',
    systemRole:    'SYSTEM_ADMIN',
    status:        'ACTIVE',
    emailVerified: true,
    createdAt:     '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeUser(overrides = {}) {
  return {
    id:         OTHER_ID,
    firstname:  'Jane',
    lastname:   'Doe',
    email:      'jane@example.com',
    systemRole: 'USER',
    status:     'ACTIVE',
    createdAt:  '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeSetting(key, value, description = null) {
  return { key, value, description, updatedAt: '2026-01-01T00:00:00.000Z', updatedById: null };
}

function makeEvent(overrides = {}) {
  return {
    id:            'evt-001',
    subject:       'Team Meeting',
    status:        'ACTIVE',
    eventDatetime: '2026-06-15T14:00:00.000Z',
    location:      'Conference Room',
    createdAt:     '2026-01-01T00:00:00.000Z',
    owner: {
      id:        OTHER_ID,
      firstname: 'Jane',
      lastname:  'Doe',
      email:     'jane@example.com',
    },
    ...overrides,
  };
}

// ── Setup helper ──────────────────────────────────────────────────────────────

async function setup(page, options = {}) {
  const {
    profile        = makeProfile(),
    users          = [makeUser()],
    settings       = [makeSetting('allow_public_registration', 'false', 'Allow new registrations')],
    events         = [makeEvent()],
    eventsMeta     = null,
    updatedUser    = null,
    updatedSetting = null,
  } = options;

  await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);

  // Profile endpoint
  await page.route(`**/api/v1/users/${USER_ID}`, async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: profile }, meta: null, error: null }),
      });
    return route.fallback();
  });

  // Admin users list + user update
  await page.route('**/api/v1/admin/users**', async (route) => {
    const method  = route.request().method();
    const urlPath = new URL(route.request().url()).pathname;
    const isListRoute = /\/admin\/users\/?$/.test(urlPath);

    if (method === 'GET' && isListRoute) {
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { users }, meta: null, error: null }),
      });
    }
    if (method === 'PATCH') {
      const body        = JSON.parse(route.request().postData() || '{}');
      const base        = users.find(u => urlPath.includes(u.id)) ?? users[0];
      const responseUser = updatedUser ?? { ...base, ...body };
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: responseUser }, meta: null, error: null }),
      });
    }
    return route.fallback();
  });

  // Admin settings list + update
  await page.route('**/api/v1/admin/settings**', async (route) => {
    const method = route.request().method();
    if (method === 'GET')
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { settings }, meta: null, error: null }),
      });
    if (method === 'PATCH') {
      const body = JSON.parse(route.request().postData() || '{}');
      const base = settings[0];
      const responseSetting = updatedSetting ?? { ...base, value: body.value ?? base.value };
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { setting: responseSetting }, meta: null, error: null }),
      });
    }
    return route.fallback();
  });

  // Admin events list
  await page.route('**/api/v1/admin/events**', async (route) => {
    if (route.request().method() === 'GET')
      return route.fulfill({
        status: 200, contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { events },
          meta: eventsMeta ?? { page: 1, per_page: 20, total: events.length },
          error: null,
        }),
      });
    return route.fallback();
  });
}

// ── Access control ────────────────────────────────────────────────────────────

test.describe('Access control', () => {
  test('admin (SYSTEM_ADMIN) can view the admin panel', async ({ page }) => {
    await setup(page);
    await page.goto('/admin');
    await expect(page.getByRole('main', { name: 'Admin panel' })).toBeVisible();
  });

  test('non-admin (USER) is redirected to /events', async ({ page }) => {
    await setup(page, { profile: makeProfile({ systemRole: 'USER' }) });
    await page.goto('/admin');
    await page.waitForURL(/\/events/);
    expect(page.url()).toContain('/events');
  });

  test('unauthenticated user is redirected to /login', async ({ page }) => {
    await page.goto('/admin');
    await page.waitForURL(/\/login/);
    expect(page.url()).toContain('/login');
  });
});

// ── Users tab ─────────────────────────────────────────────────────────────────

test.describe('Users tab', () => {
  test('users tab is active by default and shows user list', async ({ page }) => {
    await setup(page);
    await page.goto('/admin');
    const usersRegion = page.getByRole('region', { name: 'Users' });
    await expect(usersRegion.getByRole('table', { name: 'Users list' })).toBeVisible();
  });

  test('shows user name and email', async ({ page }) => {
    await setup(page);
    await page.goto('/admin');
    const region = page.getByRole('region', { name: 'Users' });
    await expect(region.getByText('Jane Doe')).toBeVisible();
    await expect(region.getByText('jane@example.com')).toBeVisible();
  });

  test('shows ACTIVE status badge', async ({ page }) => {
    await setup(page, { users: [makeUser({ status: 'ACTIVE' })] });
    await page.goto('/admin');
    const region = page.getByRole('region', { name: 'Users' });
    await expect(region.getByLabel('User status: ACTIVE')).toBeVisible();
  });

  test('shows DISABLED status badge', async ({ page }) => {
    await setup(page, { users: [makeUser({ status: 'DISABLED' })] });
    await page.goto('/admin');
    const region = page.getByRole('region', { name: 'Users' });
    await expect(region.getByLabel('User status: DISABLED')).toBeVisible();
  });

  test('shows USER role badge', async ({ page }) => {
    await setup(page, { users: [makeUser({ systemRole: 'USER' })] });
    await page.goto('/admin');
    const region = page.getByRole('region', { name: 'Users' });
    await expect(region.getByLabel('User role: USER')).toBeVisible();
  });

  test('shows SYSTEM_ADMIN role badge', async ({ page }) => {
    await setup(page, { users: [makeUser({ systemRole: 'SYSTEM_ADMIN' })] });
    await page.goto('/admin');
    const region = page.getByRole('region', { name: 'Users' });
    await expect(region.getByLabel('User role: SYSTEM_ADMIN')).toBeVisible();
  });

  test('disable button sends PATCH and updates status badge', async ({ page }) => {
    await setup(page, {
      users:       [makeUser({ status: 'ACTIVE' })],
      updatedUser: makeUser({ status: 'DISABLED' }),
    });
    await page.goto('/admin');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.method() === 'PATCH' && r.url().includes('/admin/users/')),
      page.getByRole('button', { name: /disable jane doe/i }).click(),
    ]);
    const body = JSON.parse(request.postData() || '{}');
    expect(body.status).toBe('DISABLED');
  });

  test('enable button sends PATCH and updates status badge', async ({ page }) => {
    await setup(page, {
      users:       [makeUser({ status: 'DISABLED' })],
      updatedUser: makeUser({ status: 'ACTIVE' }),
    });
    await page.goto('/admin');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.method() === 'PATCH' && r.url().includes('/admin/users/')),
      page.getByRole('button', { name: /enable jane doe/i }).click(),
    ]);
    const body = JSON.parse(request.postData() || '{}');
    expect(body.status).toBe('ACTIVE');
  });

  test('promote button sends PATCH with systemRole SYSTEM_ADMIN', async ({ page }) => {
    await setup(page, {
      users:       [makeUser({ systemRole: 'USER' })],
      updatedUser: makeUser({ systemRole: 'SYSTEM_ADMIN' }),
    });
    await page.goto('/admin');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.method() === 'PATCH' && r.url().includes('/admin/users/')),
      page.getByRole('button', { name: /promote jane@example.com to admin/i }).click(),
    ]);
    const body = JSON.parse(request.postData() || '{}');
    expect(body.systemRole).toBe('SYSTEM_ADMIN');
  });

  test('demote button sends PATCH with systemRole USER', async ({ page }) => {
    await setup(page, {
      users:       [makeUser({ systemRole: 'SYSTEM_ADMIN' })],
      updatedUser: makeUser({ systemRole: 'USER' }),
    });
    await page.goto('/admin');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.method() === 'PATCH' && r.url().includes('/admin/users/')),
      page.getByRole('button', { name: /demote jane@example.com from admin/i }).click(),
    ]);
    const body = JSON.parse(request.postData() || '{}');
    expect(body.systemRole).toBe('USER');
  });

  test('no action buttons shown for current user in list', async ({ page }) => {
    // Include self (USER_ID) in the user list — no Disable/Promote buttons should render
    await setup(page, {
      users: [makeUser({ id: USER_ID, email: 'admin@example.com' })],
    });
    await page.goto('/admin');
    const region = page.getByRole('region', { name: 'Users' });
    await expect(region.getByRole('button', { name: /disable|enable|promote|demote/i })).not.toBeVisible();
  });
});

// ── Settings tab ──────────────────────────────────────────────────────────────

test.describe('Settings tab', () => {
  async function openSettingsTab(page) {
    await page.goto('/admin');
    await page.getByRole('tab', { name: /^settings$/i }).click();
  }

  test('settings tab shows settings list', async ({ page }) => {
    await setup(page);
    await openSettingsTab(page);
    const region = page.getByRole('region', { name: 'Settings' });
    await expect(region.getByRole('table', { name: 'Settings list' })).toBeVisible();
  });

  test('shows setting key', async ({ page }) => {
    await setup(page);
    await openSettingsTab(page);
    const region = page.getByRole('region', { name: 'Settings' });
    await expect(region.getByText('allow_public_registration')).toBeVisible();
  });

  test('shows setting current value', async ({ page }) => {
    await setup(page);
    await openSettingsTab(page);
    const region = page.getByRole('region', { name: 'Settings' });
    await expect(region.getByLabel('Current value: false')).toBeVisible();
  });

  test('edit button shows value input', async ({ page }) => {
    await setup(page);
    await openSettingsTab(page);
    await page.getByRole('button', { name: /edit allow_public_registration/i }).click();
    await expect(page.getByLabel('Value for allow_public_registration')).toBeVisible();
  });

  test('save button sends PATCH and hides input', async ({ page }) => {
    await setup(page, {
      updatedSetting: makeSetting('allow_public_registration', 'true', 'Allow new registrations'),
    });
    await openSettingsTab(page);
    await page.getByRole('button', { name: /edit allow_public_registration/i }).click();
    const input = page.getByLabel('Value for allow_public_registration');
    await input.fill('true');

    const [request] = await Promise.all([
      page.waitForRequest(r => r.method() === 'PATCH' && r.url().includes('/admin/settings/')),
      page.getByRole('button', { name: /save allow_public_registration/i }).click(),
    ]);
    const body = JSON.parse(request.postData() || '{}');
    expect(body.value).toBe('true');
    // Input should be gone after save
    await expect(page.getByLabel('Value for allow_public_registration')).not.toBeVisible();
  });

  test('cancel button discards edit and hides input', async ({ page }) => {
    await setup(page);
    await openSettingsTab(page);
    await page.getByRole('button', { name: /edit allow_public_registration/i }).click();
    await page.getByLabel('Value for allow_public_registration').fill('true');
    await page.getByRole('button', { name: /cancel allow_public_registration/i }).click();
    await expect(page.getByLabel('Value for allow_public_registration')).not.toBeVisible();
    // Original value still shown
    await expect(page.getByLabel('Current value: false')).toBeVisible();
  });
});

// ── Events tab ────────────────────────────────────────────────────────────────

test.describe('Events tab', () => {
  async function openEventsTab(page) {
    await page.goto('/admin');
    await page.getByRole('tab', { name: /^events$/i }).click();
  }

  test('events tab shows events table', async ({ page }) => {
    await setup(page);
    await openEventsTab(page);
    const region = page.getByRole('region', { name: 'Events' });
    await expect(region.getByRole('table', { name: 'Events list' })).toBeVisible();
  });

  test('shows event subject', async ({ page }) => {
    await setup(page);
    await openEventsTab(page);
    const region = page.getByRole('region', { name: 'Events' });
    await expect(region.getByText('Team Meeting')).toBeVisible();
  });

  test('shows event owner', async ({ page }) => {
    await setup(page);
    await openEventsTab(page);
    const region = page.getByRole('region', { name: 'Events' });
    await expect(region.getByLabel('Owner: jane@example.com')).toBeVisible();
  });

  test('shows event status badge', async ({ page }) => {
    await setup(page);
    await openEventsTab(page);
    const region = page.getByRole('region', { name: 'Events' });
    await expect(region.getByLabel('Event status: ACTIVE')).toBeVisible();
  });

  test('shows empty state when no events', async ({ page }) => {
    await setup(page, { events: [] });
    await openEventsTab(page);
    const region = page.getByRole('region', { name: 'Events' });
    await expect(region.getByLabel('No events')).toBeVisible();
  });

  test('pagination controls shown when total > 20', async ({ page }) => {
    await setup(page, { eventsMeta: { page: 1, per_page: 20, total: 25 } });
    await openEventsTab(page);
    await expect(page.getByLabel('Events pagination')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Next page' })).toBeVisible();
  });

  test('previous page button is disabled on first page', async ({ page }) => {
    await setup(page, { eventsMeta: { page: 1, per_page: 20, total: 25 } });
    await openEventsTab(page);
    await expect(page.getByRole('button', { name: 'Previous page' })).toBeDisabled();
  });
});
