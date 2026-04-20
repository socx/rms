import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// A structurally valid JWT whose payload is { sub: 'user-123', role: 'user' }
const FAKE_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEyMyIsInJvbGUiOiJ1c2VyIn0.fake';

const MOCK_USER = {
  id:            'user-123',
  firstname:     'Alice',
  lastname:      'Smith',
  email:         'alice@example.com',
  phone:         '+44 7700 900000',
  timezone:      'Europe/London',
  emailVerified: true,
  systemRole:    'USER',
  status:        'ACTIVE',
  createdAt:     '2026-01-01T00:00:00.000Z',
};

/** Set up routes for the profile page in one call to avoid handler chaining issues. */
async function setupProfile(page, {
  user             = MOCK_USER,
  patchStatus      = null,   // null = don't intercept PATCH
  patchBody        = null,
  cpStatus         = null,   // null = don't intercept change-password
  cpBody           = null,
} = {}) {
  await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);

  // Single handler covers GET and optionally PATCH on /users/user-123
  await page.route('**/api/v1/users/user-123', async (route) => {
    const method = route.request().method();
    if (method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { user }, error: null }),
      });
    } else if (method === 'PATCH' && patchStatus !== null) {
      await route.fulfill({
        status: patchStatus,
        contentType: 'application/json',
        body: JSON.stringify(patchBody),
      });
    } else {
      await route.fallback();
    }
  });

  if (cpStatus !== null) {
    await page.route('**/api/v1/users/user-123/change-password', route =>
      route.fulfill({
        status: cpStatus,
        contentType: 'application/json',
        body: JSON.stringify(cpBody),
      })
    );
  }
}

// Convenience shortcuts kept for readability in tests
async function loginAs(page, user = MOCK_USER) {
  return setupProfile(page, { user });
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

test.describe('Profile page — navigation', () => {
  test('redirects to /login when no token is present', async ({ page }) => {
    await page.goto('/profile');
    await expect(page).toHaveURL(/\/login/);
  });

  test('is accessible at /profile when authenticated', async ({ page }) => {
    await loginAs(page);
    await page.goto('/profile');
    await expect(page.getByRole('heading', { name: /your profile/i })).toBeVisible();
  });

  test('"Back to events" link returns to /events', async ({ page }) => {
    await loginAs(page);
    await page.goto('/profile');
    await page.getByRole('link', { name: /back to events/i }).click();
    await expect(page).toHaveURL(/\/events/);
  });

  test('"Edit profile" link on events page navigates to /profile', async ({ page }) => {
    await loginAs(page);
    // events page doesn't need API mock, just navigate
    await page.goto('/events');
    await page.getByRole('link', { name: /edit profile/i }).click();
    await expect(page).toHaveURL(/\/profile/);
  });
});

// ---------------------------------------------------------------------------
// Profile form — pre-fill & display
// ---------------------------------------------------------------------------

test.describe('Profile page — profile form', () => {
  test('pre-fills form fields with data fetched from the API', async ({ page }) => {
    await loginAs(page);
    await page.goto('/profile');
    await expect(page.getByLabel('First name')).toHaveValue('Alice');
    await expect(page.getByLabel('Last name')).toHaveValue('Smith');
    await expect(page.getByLabel('Email address')).toHaveValue('alice@example.com');
    await expect(page.getByLabel('Phone number (optional)')).toHaveValue('+44 7700 900000');
    await expect(page.getByLabel('Timezone')).toHaveValue('Europe/London');
  });

  test('shows validation error when first name is cleared', async ({ page }) => {
    await loginAs(page);
    await page.goto('/profile');
    await page.getByLabel('First name').fill('');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/first name is required/i)).toBeVisible();
  });

  test('shows validation error for invalid email format', async ({ page }) => {
    await loginAs(page);
    await page.goto('/profile');
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  });

  test('shows success banner after profile is saved', async ({ page }) => {
    await setupProfile(page, {
      patchStatus: 200,
      patchBody: { success: true, data: { user: MOCK_USER }, error: null },
    });
    await page.goto('/profile');
    await page.getByLabel('First name').fill('Alicia');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('status').first()).toContainText(/profile updated successfully/i);
  });

  test('sends correct PATCH body to the API', async ({ page }) => {
    let captured = null;
    await page.addInitScript((t) => localStorage.setItem('rms_token', t), FAKE_TOKEN);
    await page.route('**/api/v1/users/user-123', async (route) => {
      const method = route.request().method();
      if (method === 'PATCH') {
        captured = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { user: MOCK_USER }, error: null }),
        });
      } else if (method === 'GET') {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ success: true, data: { user: MOCK_USER }, error: null }),
        });
      } else {
        await route.fallback();
      }
    });

    await page.goto('/profile');
    await page.getByLabel('First name').fill('Bob');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('status').first()).toBeVisible();
    expect(captured?.firstname).toBe('Bob');
  });

  test('shows error banner when email is already in use', async ({ page }) => {
    await setupProfile(page, {
      patchStatus: 400,
      patchBody: { success: false, data: null, error: { code: 'EMAIL_EXISTS', message: 'That email address is already in use.' } },
    });
    await page.goto('/profile');
    await page.getByLabel('Email address').fill('taken@example.com');
    await page.getByRole('button', { name: /save changes/i }).click();
    await expect(page.getByRole('alert').first()).toContainText(/already in use/i);
  });
});

// ---------------------------------------------------------------------------
// Change password form
// ---------------------------------------------------------------------------

test.describe('Profile page — change password form', () => {
  test('shows validation error when current password is empty', async ({ page }) => {
    await loginAs(page);
    await page.goto('/profile');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.getByText(/current password is required/i)).toBeVisible();
  });

  test('shows validation error when new password is too short', async ({ page }) => {
    await loginAs(page);
    await page.goto('/profile');
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password', { exact: true }).fill('short');
    await page.getByLabel('Confirm new password').fill('short');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.getByText(/at least 8 characters/i)).toBeVisible();
  });

  test('shows validation error when new passwords do not match', async ({ page }) => {
    await loginAs(page);
    await page.goto('/profile');
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password', { exact: true }).fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('DifferentPass1!');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  test('shows success banner and clears fields after password change', async ({ page }) => {
    await setupProfile(page, {
      cpStatus: 200,
      cpBody: { success: true, data: { message: 'Password changed successfully.' }, error: null },
    });
    await page.goto('/profile');
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password', { exact: true }).fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('NewPass1!');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.getByRole('status').last()).toContainText(/password changed successfully/i);
    await expect(page.getByLabel('Current password')).toHaveValue('');
  });

  test('sends correct body to POST /change-password', async ({ page }) => {
    let captured = null;
    await setupProfile(page); // GET mock only
    await page.route('**/api/v1/users/user-123/change-password', async (route) => {
      captured = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'ok' }, error: null }),
      });
    });

    await page.goto('/profile');
    await page.getByLabel('Current password').fill('OldPass1!');
    await page.getByLabel('New password', { exact: true }).fill('NewPass99!');
    await page.getByLabel('Confirm new password').fill('NewPass99!');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.getByRole('status').last()).toBeVisible();
    expect(captured).toEqual({ currentPassword: 'OldPass1!', newPassword: 'NewPass99!' });
  });

  test('shows error banner when current password is incorrect', async ({ page }) => {
    await setupProfile(page, {
      cpStatus: 400,
      cpBody: { success: false, data: null, error: { code: 'INCORRECT_PASSWORD', message: 'Current password is incorrect.' } },
    });
    await page.goto('/profile');
    await page.getByLabel('Current password').fill('WrongPass1!');
    await page.getByLabel('New password', { exact: true }).fill('NewPass1!');
    await page.getByLabel('Confirm new password').fill('NewPass1!');
    await page.getByRole('button', { name: /change password/i }).click();
    await expect(page.getByRole('alert').last()).toContainText(/current password is incorrect/i);
  });
});
