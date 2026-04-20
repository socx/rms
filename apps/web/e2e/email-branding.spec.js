import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';
const USER_ID    = 'user-123';

const EXISTING_WRAPPER = {
  id:         'ew-001',
  ownerId:    USER_ID,
  wrapperHtml: '<!DOCTYPE html><html><body>{{body}}</body></html>',
  isActive:   true,
  createdAt:  '2026-01-01T00:00:00.000Z',
  updatedAt:  '2026-01-01T00:00:00.000Z',
};

const WRAPPER_URL = '**/api/v1/users/user-123/email-wrapper';

/**
 * Set up auth token and stub the /email-wrapper endpoint.
 *
 * options.getBody    – response for GET (null = 404 "not configured")
 * options.putBody    – response for PUT
 * options.patchBody  – response for PATCH
 * options.deleteBody – response for DELETE
 */
async function setup(page, options = {}) {
  const {
    getBody    = null,
    putBody    = null,
    patchBody  = null,
    deleteBody = null,
  } = options;

  await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);

  await page.route(WRAPPER_URL, async (route) => {
    const method = route.request().method();

    if (method === 'GET') {
      if (getBody === null) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Not found' } }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(getBody) });
    }

    if (method === 'PUT') {
      if (putBody) {
        return route.fulfill({
          status: putBody.success ? 200 : 422,
          contentType: 'application/json',
          body: JSON.stringify(putBody),
        });
      }
    }

    if (method === 'PATCH') {
      if (patchBody) {
        return route.fulfill({
          status: patchBody.success ? 200 : 422,
          contentType: 'application/json',
          body: JSON.stringify(patchBody),
        });
      }
    }

    if (method === 'DELETE') {
      if (deleteBody) {
        return route.fulfill({
          status: deleteBody.success ? 200 : 404,
          contentType: 'application/json',
          body: JSON.stringify(deleteBody),
        });
      }
    }

    await route.fallback();
  });
}

// Profile page stub helper
function stubProfile(page) {
  return page.route('**/api/v1/users/user-123', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { user: { id: USER_ID, firstname: 'Alice', lastname: 'S', email: 'a@b.com', timezone: 'UTC' } },
        error: null,
      }),
    })
  );
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test.describe('Email Branding page — navigation', () => {
  test('redirects to /login when no token is present', async ({ page }) => {
    await page.goto('/email-branding');
    await expect(page).toHaveURL(/\/login/);
  });

  test('is accessible at /email-branding when authenticated', async ({ page }) => {
    await setup(page);
    await page.goto('/email-branding');
    await expect(page.getByRole('heading', { name: /email branding/i, level: 1 })).toBeVisible();
  });

  test('"Back to profile" link navigates to /profile', async ({ page }) => {
    await setup(page);
    await stubProfile(page);
    await page.route('**/api/v1/users/user-123/api-keys', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { api_keys: [] }, error: null }) }));
    await page.goto('/email-branding');
    await page.getByRole('link', { name: /back to profile/i }).click();
    await expect(page).toHaveURL(/\/profile/);
  });

  test('"Email branding" link on profile navigates to /email-branding', async ({ page }) => {
    await setup(page);
    await stubProfile(page);
    await page.goto('/profile');
    await page.getByRole('link', { name: /email branding/i }).click();
    await expect(page).toHaveURL(/\/email-branding/);
  });
});

// ---------------------------------------------------------------------------
// Editor — no wrapper configured (404 state)
// ---------------------------------------------------------------------------

test.describe('Email Branding page — empty state', () => {
  test('shows the editor pre-filled with the default template', async ({ page }) => {
    await setup(page); // getBody=null → 404
    await page.goto('/email-branding');
    // The textarea should contain {{body}} from the default template
    const textarea = page.getByRole('textbox', { name: /html template/i });
    await expect(textarea).toBeVisible();
    await expect(textarea).toContainText('{{body}}');
  });

  test('does NOT show the "Remove branding" button when no wrapper exists', async ({ page }) => {
    await setup(page);
    await page.goto('/email-branding');
    await expect(page.getByRole('button', { name: /remove branding/i })).not.toBeVisible();
  });

  test('shows the live preview when template contains {{body}}', async ({ page }) => {
    await setup(page);
    await page.goto('/email-branding');
    // Preview iframe should be present
    const iframe = page.locator('iframe[title="Email preview"]');
    await expect(iframe).toBeVisible();
  });

  test('hides the live preview when {{body}} is removed', async ({ page }) => {
    await setup(page);
    await page.goto('/email-branding');
    const textarea = page.getByRole('textbox', { name: /html template/i });
    await textarea.fill('<html><body>No placeholder here</body></html>');
    await expect(page.locator('iframe[title="Email preview"]')).not.toBeVisible();
    await expect(page.getByText(/add the/i)).toBeVisible();
  });

  test('shows a warning when {{body}} placeholder is missing', async ({ page }) => {
    await setup(page);
    await page.goto('/email-branding');
    const textarea = page.getByRole('textbox', { name: /html template/i });
    await textarea.fill('<html><body>No placeholder</body></html>');
    await expect(page.getByText(/must include the/i)).toBeVisible();
  });

  test('"Save branding" button is disabled when {{body}} is missing', async ({ page }) => {
    await setup(page);
    await page.goto('/email-branding');
    const textarea = page.getByRole('textbox', { name: /html template/i });
    await textarea.fill('<html><body>No placeholder</body></html>');
    await expect(page.getByRole('button', { name: /save branding/i })).toBeDisabled();
  });
});

// ---------------------------------------------------------------------------
// Editor — existing wrapper (200 state)
// ---------------------------------------------------------------------------

test.describe('Email Branding page — existing wrapper', () => {
  const BODY = {
    success: true,
    data: { emailWrapper: EXISTING_WRAPPER },
    error: null,
  };

  test('populates textarea with existing wrapperHtml', async ({ page }) => {
    await setup(page, { getBody: BODY });
    await page.goto('/email-branding');
    const textarea = page.getByRole('textbox', { name: /html template/i });
    await expect(textarea).toContainText('{{body}}');
  });

  test('"Active" checkbox reflects isActive from server', async ({ page }) => {
    await setup(page, { getBody: BODY });
    await page.goto('/email-branding');
    const toggle = page.getByRole('checkbox', { name: /enable custom branding/i });
    await expect(toggle).toBeChecked();
  });

  test('shows "Remove branding" button when wrapper exists', async ({ page }) => {
    await setup(page, { getBody: BODY });
    await page.goto('/email-branding');
    await expect(page.getByRole('button', { name: /remove branding/i })).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// Save — success & error
// ---------------------------------------------------------------------------

test.describe('Email Branding page — save', () => {
  test('shows success banner after successful save', async ({ page }) => {
    const putResponse = {
      success: true,
      data: { emailWrapper: { ...EXISTING_WRAPPER, wrapperHtml: '<!DOCTYPE html><html><body>{{body}}</body></html>' } },
      error: null,
    };
    await setup(page, { putBody: putResponse });
    await page.goto('/email-branding');
    await page.getByRole('button', { name: /save branding/i }).click();
    await expect(page.getByText(/branding saved successfully/i)).toBeVisible();
  });

  test('sends correct HTML to the API on save', async ({ page }) => {
    let capturedBody = null;
    await setup(page); // GET → 404
    await page.route(WRAPPER_URL, async (route) => {
      if (route.request().method() === 'PUT') {
        capturedBody = JSON.parse(route.request().postData());
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { emailWrapper: EXISTING_WRAPPER }, error: null }),
        });
      }
      // Fallback to GET 404 for initial load
      return route.fulfill({
        status: 404, contentType: 'application/json',
        body: JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Not found' } }),
      });
    });

    await page.goto('/email-branding');
    await page.getByRole('button', { name: /save branding/i }).click();
    // body should contain wrapperHtml key
    await expect(page.getByText(/branding saved/i)).toBeVisible();
    expect(capturedBody).not.toBeNull();
    expect(capturedBody).toHaveProperty('wrapperHtml');
    expect(capturedBody.wrapperHtml).toContain('{{body}}');
  });

  test('shows API error message when save fails', async ({ page }) => {
    const errResponse = {
      success: false,
      data: null,
      error: { code: 'MISSING_BODY_PLACEHOLDER', message: 'Template must include {{body}}' },
    };
    // GET 404, then PUT fails
    await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);
    await page.route(WRAPPER_URL, async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        return route.fulfill({ status: 404, contentType: 'application/json',
          body: JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Not found' } }) });
      }
      if (method === 'PUT') {
        return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify(errResponse) });
      }
      await route.fallback();
    });

    await page.goto('/email-branding');
    // Manually clear placeholder so validation doesn't block (test the API-level error)
    // Use the default template which has {{body}} - just save it to trigger API error
    await page.getByRole('button', { name: /save branding/i }).click();
    await expect(page.getByText(/Template must include/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// "Insert default" button
// ---------------------------------------------------------------------------

test.describe('Email Branding page — insert default', () => {
  test('replaces textarea content with default template', async ({ page }) => {
    await setup(page);
    await page.goto('/email-branding');
    const textarea = page.getByRole('textbox', { name: /html template/i });
    await textarea.fill('<p>custom html</p>{{body}}');
    await page.getByRole('button', { name: /insert default/i }).click();
    await expect(textarea).toContainText('RMS Reminder');
  });
});

// ---------------------------------------------------------------------------
// Delete
// ---------------------------------------------------------------------------

test.describe('Email Branding page — delete', () => {
  const GET_BODY = { success: true, data: { emailWrapper: EXISTING_WRAPPER }, error: null };
  const DELETE_BODY = {
    success: true,
    data: { message: 'Custom email wrapper removed. System default will be used.' },
    error: null,
  };

  test('opens confirm modal when "Remove branding" is clicked', async ({ page }) => {
    await setup(page, { getBody: GET_BODY });
    await page.goto('/email-branding');
    await page.getByRole('button', { name: /remove branding/i }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByText(/remove custom branding/i)).toBeVisible();
  });

  test('"Cancel" closes the confirm modal', async ({ page }) => {
    await setup(page, { getBody: GET_BODY });
    await page.goto('/email-branding');
    await page.getByRole('button', { name: /remove branding/i }).click();
    await page.getByRole('button', { name: /cancel/i }).click();
    await expect(page.getByRole('dialog')).not.toBeVisible();
  });

  test('shows success banner after successful delete', async ({ page }) => {
    // stubs: GET wrapper → DELETE success → re-GET 404
    await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);
    let deleted = false;
    await page.route(WRAPPER_URL, async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        const body = deleted
          ? JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Not found' } })
          : JSON.stringify(GET_BODY);
        return route.fulfill({ status: deleted ? 404 : 200, contentType: 'application/json', body });
      }
      if (method === 'DELETE') {
        deleted = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DELETE_BODY) });
      }
      await route.fallback();
    });

    await page.goto('/email-branding');
    await page.getByRole('button', { name: /remove branding/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /remove branding/i }).click();
    await expect(page.getByText(/custom branding removed/i)).toBeVisible();
  });

  test('hides "Remove branding" button after successful delete', async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);
    let deleted = false;
    await page.route(WRAPPER_URL, async (route) => {
      const method = route.request().method();
      if (method === 'GET') {
        const body = deleted
          ? JSON.stringify({ success: false, data: null, error: { code: 'NOT_FOUND', message: 'Not found' } })
          : JSON.stringify(GET_BODY);
        return route.fulfill({ status: deleted ? 404 : 200, contentType: 'application/json', body });
      }
      if (method === 'DELETE') {
        deleted = true;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(DELETE_BODY) });
      }
      await route.fallback();
    });

    await page.goto('/email-branding');
    await page.getByRole('button', { name: /remove branding/i }).click();
    await page.getByRole('dialog').getByRole('button', { name: /remove branding/i }).click();
    // Wait for the confirm dialog to close before asserting the page button is gone
    await expect(page.getByRole('dialog')).not.toBeVisible();
    await expect(page.getByRole('button', { name: /remove branding/i })).not.toBeVisible();
  });
});
