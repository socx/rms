import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID = 'user-123';

function makeKey(overrides = {}) {
  return {
    id:           'key-abc-001',
    key_prefix:   'rms_9f3a',
    name:         'My integration',
    status:       'active',
    scopes:       [],
    expires_at:   null,
    last_used_at: null,
    created_at:   '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

const MOCK_KEYS = [
  makeKey({ id: 'key-001', name: 'Production key',   scopes: ['events:read', 'events:write'] }),
  makeKey({ id: 'key-002', name: 'Read-only key',    scopes: ['users:read'], expires_at: '2027-01-01T00:00:00.000Z' }),
  makeKey({ id: 'key-003', name: 'Revoked key',      status: 'revoked', scopes: [] }),
];

/**
 * Set up auth token + a unified route handler for /users/user-123/api-keys*.
 *
 * options.listBody    – response for GET /api-keys
 * options.createBody  – response for POST /api-keys  (null = don't stub)
 * options.patchBody   – response for PATCH /api-keys/:kid
 * options.revokeBody  – response for POST /api-keys/:kid/revoke
 * options.scopesBody  – response for PUT /api-keys/:kid/scopes
 */
async function setup(page, options = {}) {
  const {
    listBody   = { success: true, data: { api_keys: MOCK_KEYS }, error: null },
    createBody = null,
    patchBody  = null,
    revokeBody = null,
    scopesBody = null,
  } = options;

  await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);

  await page.route('**/api/v1/users/user-123/api-keys/**', async (route) => {
    const method = route.request().method();
    const url    = route.request().url();

    // POST …/:kid/revoke
    if (method === 'POST' && url.includes('/revoke')) {
      if (revokeBody) return route.fulfill({ status: revokeBody.success ? 200 : 409, contentType: 'application/json', body: JSON.stringify(revokeBody) });
    }
    // PUT  …/:kid/scopes
    if (method === 'PUT' && url.includes('/scopes')) {
      if (scopesBody) return route.fulfill({ status: scopesBody.success ? 200 : 422, contentType: 'application/json', body: JSON.stringify(scopesBody) });
    }
    // PATCH …/:kid
    if (method === 'PATCH') {
      if (patchBody) return route.fulfill({ status: patchBody.success ? 200 : 422, contentType: 'application/json', body: JSON.stringify(patchBody) });
    }
    await route.fallback();
  });

  await page.route('**/api/v1/users/user-123/api-keys', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(listBody) });
    }
    if (method === 'POST' && createBody) {
      return route.fulfill({ status: createBody.success ? 201 : 409, contentType: 'application/json', body: JSON.stringify(createBody) });
    }
    await route.fallback();
  });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test.describe('API Keys page — navigation', () => {
  test('redirects to /login when no token is present', async ({ page }) => {
    await page.goto('/api-keys');
    await expect(page).toHaveURL(/\/login/);
  });

  test('is accessible at /api-keys when authenticated', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await expect(page.getByRole('heading', { name: /api keys/i, level: 1 })).toBeVisible();
  });

  test('"Back to profile" link navigates to /profile', async ({ page }) => {
    // Also mock the profile endpoint so ProfilePage doesn't error
    await setup(page);
    await page.route('**/api/v1/users/user-123', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: { id: USER_ID, firstname: 'Alice', lastname: 'S', email: 'a@b.com', timezone: 'UTC' } }, error: null }) }));
    await page.goto('/api-keys');
    await page.getByRole('link', { name: /back to profile/i }).click();
    await expect(page).toHaveURL(/\/profile/);
  });

  test('"Manage API keys" link on profile navigates to /api-keys', async ({ page }) => {
    await setup(page);
    await page.route('**/api/v1/users/user-123', route =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user: { id: USER_ID, firstname: 'Alice', lastname: 'S', email: 'a@b.com', timezone: 'UTC' } }, error: null }) }));
    await page.goto('/profile');
    await page.getByRole('link', { name: /manage api keys/i }).click();
    await expect(page).toHaveURL(/\/api-keys/);
  });
});

// ---------------------------------------------------------------------------
// Key list
// ---------------------------------------------------------------------------

test.describe('API Keys page — listing', () => {
  test('shows all key names in the table', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await expect(page.getByText('Production key')).toBeVisible();
    await expect(page.getByText('Read-only key')).toBeVisible();
    await expect(page.getByText('Revoked key')).toBeVisible();
  });

  test('shows key prefix in the table', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    // all three keys share the same prefix in the mock
    await expect(page.getByText(/^rms_/).first()).toBeVisible();
    const prefixes = await page.getByText(/^rms_/).all();
    expect(prefixes.length).toBeGreaterThanOrEqual(1);
  });

  test('shows "No API keys yet" when list is empty', async ({ page }) => {
    await setup(page, { listBody: { success: true, data: { api_keys: [] }, error: null } });
    await page.goto('/api-keys');
    await expect(page.getByText(/no api keys yet/i)).toBeVisible();
  });

  test('revoked key row has no Edit/Revoke buttons', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    // The Revoked key row should NOT contain an Edit button
    await expect(page.getByRole('button', { name: /edit revoked key/i })).not.toBeVisible();
  });

  test('active key rows show Edit and Revoke buttons', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await expect(page.getByRole('button', { name: /edit production key/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /revoke production key/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Create key modal
// ---------------------------------------------------------------------------

test.describe('API Keys page — create', () => {
  test('opens create modal when "Create key" is clicked', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /create key/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('heading', { name: /create api key/i })).toBeVisible();
  });

  test('shows validation error when name is empty', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /create key/i }).click();
    await page.getByRole('button', { name: /create key/i, exact: true }).last().click();
    await expect(page.getByText(/name is required/i)).toBeVisible();
  });

  test('closes modal on Cancel', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /create key/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('closes modal on Escape', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /create key/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('shows raw key after successful creation', async ({ page }) => {
    await setup(page, {
      createBody: {
        success: true,
        data: {
          api_key: {
            ...makeKey({ id: 'new-001', name: 'Webhook key' }),
            raw_key: 'rms_' + 'a'.repeat(64),
          },
        },
        error: null,
      },
    });
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /create key/i }).click();
    await page.getByLabel('Name').fill('Webhook key');
    await page.getByRole('button', { name: /create key/i, exact: true }).last().click();
    await expect(page.getByText(/copy your key now/i)).toBeVisible();
    await expect(page.getByRole('textbox', { name: /raw api key/i })).toHaveValue(/^rms_/);
  });

  test('sends correct JSON body to POST /api-keys', async ({ page }) => {
    let captured = null;

    await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);
    await page.route('**/api/v1/users/user-123/api-keys', async (route) => {
      if (route.request().method() === 'GET') {
        return route.fulfill({ status: 200, contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { api_keys: [] }, error: null }) });
      }
      if (route.request().method() === 'POST') {
        captured = JSON.parse(route.request().postData() ?? '{}');
        return route.fulfill({
          status: 201, contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { api_key: { ...makeKey({ name: 'Test' }), raw_key: 'rms_' + 'b'.repeat(64) } }, error: null }),
        });
      }
      await route.fallback();
    });

    await page.goto('/api-keys');
    await page.getByRole('button', { name: /create key/i }).click();
    await page.getByLabel('Name').fill('Test');
    await page.getByLabel('events:read').check();
    await page.getByRole('button', { name: /create key/i, exact: true }).last().click();
    await expect(page.getByText(/copy your key now/i)).toBeVisible();

    expect(captured?.name).toBe('Test');
    expect(captured?.scopes).toContain('events:read');
  });

  test('shows error banner when key limit is reached', async ({ page }) => {
    await setup(page, {
      createBody: {
        success: false,
        data: null,
        error: { code: 'KEY_LIMIT_REACHED', message: 'Maximum 10 active API keys per user.' },
      },
    });
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /create key/i }).click();
    await page.getByLabel('Name').fill('Extra key');
    await page.getByRole('button', { name: /create key/i, exact: true }).last().click();
    await expect(page.getByRole('alert')).toContainText(/maximum 10/i);
  });
});

// ---------------------------------------------------------------------------
// Edit key modal
// ---------------------------------------------------------------------------

test.describe('API Keys page — edit', () => {
  test('opens edit modal with pre-filled name', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /edit production key/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByLabel('Name')).toHaveValue('Production key');
  });

  test('shows validation error on empty name in edit modal', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /edit production key/i }).click();
    await page.getByLabel('Name').fill('');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/name is required/i)).toBeVisible();
  });

  test('shows success banner after saving changes', async ({ page }) => {
    await setup(page, {
      patchBody: { success: true, data: { api_key: makeKey({ id: 'key-001', name: 'Updated key' }) }, error: null },
      scopesBody: { success: true, data: { scopes: ['events:read'] }, error: null },
    });
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /edit production key/i }).click();
    await page.getByLabel('Name').fill('Updated key');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('status')).toContainText(/key updated successfully/i);
  });

  test('pre-checks existing scopes in edit modal', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /edit production key/i }).click();
    await expect(page.getByLabel('events:read')).toBeChecked();
    await expect(page.getByLabel('events:write')).toBeChecked();
    await expect(page.getByLabel('users:read')).not.toBeChecked();
  });
});

// ---------------------------------------------------------------------------
// Revoke key
// ---------------------------------------------------------------------------

test.describe('API Keys page — revoke', () => {
  test('opens revoke confirm dialog', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /revoke production key/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/are you sure/i)).toBeVisible();
  });

  test('shows success message after revoking', async ({ page }) => {
    await setup(page, {
      revokeBody: {
        success: true,
        data: { api_key: makeKey({ id: 'key-001', name: 'Production key', status: 'revoked' }) },
        error: null,
      },
    });
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /revoke production key/i }).click();
    await page.getByRole('button', { name: /confirm revoke production key/i }).click();
    await expect(page.getByRole('status')).toContainText(/has been revoked/i);
  });

  test('Cancel closes the revoke dialog', async ({ page }) => {
    await setup(page);
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /revoke production key/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('shows error banner when key already revoked (409)', async ({ page }) => {
    await setup(page, {
      revokeBody: {
        success: false,
        data: null,
        error: { code: 'KEY_ALREADY_REVOKED', message: 'This API key is already revoked.' },
      },
    });
    await page.goto('/api-keys');
    await page.getByRole('button', { name: /revoke production key/i }).click();
    await page.getByRole('button', { name: /confirm revoke production key/i }).click();
    await expect(page.getByRole('alert')).toContainText(/already revoked/i);
  });
});
