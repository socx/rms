import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// API stubs
// ---------------------------------------------------------------------------

const API_VERIFY        = '**/api/v1/auth/verify-email**';
const API_RESEND        = '**/api/v1/auth/resend-verification';

async function mockVerifySuccess(page) {
  await page.route(API_VERIFY, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { message: 'Email verified successfully.' },
        error: null,
      }),
    })
  );
}

async function mockVerifyExpired(page) {
  await page.route(API_VERIFY, route =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: { code: 'TOKEN_EXPIRED', message: 'Verification token has expired.' },
      }),
    })
  );
}

async function mockVerifyUsed(page) {
  await page.route(API_VERIFY, route =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: { code: 'TOKEN_USED', message: 'This verification token has already been used.' },
      }),
    })
  );
}

async function mockVerifyInvalid(page) {
  await page.route(API_VERIFY, route =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: { code: 'INVALID_TOKEN', message: 'Verification token is invalid.' },
      }),
    })
  );
}

async function mockResendSuccess(page) {
  await page.route(API_RESEND, route =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { message: 'If the email exists and is unverified, a verification email was sent.' },
        error: null,
      }),
    })
  );
}

async function mockAlreadyVerified(page) {
  await page.route(API_RESEND, route =>
    route.fulfill({
      status: 400,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: { code: 'ALREADY_VERIFIED', message: 'Email address is already verified.' },
      }),
    })
  );
}

// ---------------------------------------------------------------------------
// Verify-email page
// ---------------------------------------------------------------------------

test.describe('Verify email page', () => {
  test('shows "invalid link" when no token query param is present', async ({ page }) => {
    await page.goto('/verify-email');
    await expect(page.getByRole('heading', { name: /invalid link/i })).toBeVisible();
    await expect(page.getByRole('link', { name: /resend verification email/i })).toBeVisible();
  });

  test('shows loading state momentarily while verifying', async ({ page }) => {
    // Delay the API response so we can observe the pending UI
    await page.route(API_VERIFY, async route => {
      await new Promise(r => setTimeout(r, 300));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'ok' }, error: null }),
      });
    });

    await page.goto('/verify-email?token=slow-token');
    await expect(page.getByRole('status')).toContainText(/verifying/i);
    // Wait for completion too
    await expect(page.getByRole('status')).toContainText(/verified/i, { timeout: 5000 });
  });

  test('shows success message and sign-in link after valid token', async ({ page }) => {
    await mockVerifySuccess(page);
    await page.goto('/verify-email?token=valid-token-abc');
    await expect(page.getByRole('status')).toContainText(/email has been verified/i);
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  test('calls the correct API URL with the token', async ({ page }) => {
    let capturedUrl = null;
    await page.route(API_VERIFY, async route => {
      capturedUrl = route.request().url();
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'ok' }, error: null }),
      });
    });

    await page.goto('/verify-email?token=my-special-token');
    await expect(page.getByRole('status')).toContainText(/verified/i, { timeout: 5000 });
    expect(capturedUrl).toContain('token=my-special-token');
  });

  test('shows expired error and "Resend" link when token is expired', async ({ page }) => {
    await mockVerifyExpired(page);
    await page.goto('/verify-email?token=expired-token');
    await expect(page.getByRole('alert')).toContainText(/expired/i);
    await expect(page.getByRole('link', { name: /resend verification email/i })).toBeVisible();
  });

  test('shows already-used error and "Resend" link when token was already used', async ({ page }) => {
    await mockVerifyUsed(page);
    await page.goto('/verify-email?token=used-token');
    await expect(page.getByRole('alert')).toContainText(/already been used/i);
    await expect(page.getByRole('link', { name: /resend verification email/i })).toBeVisible();
  });

  test('shows generic error with back-to-sign-in link for invalid token', async ({ page }) => {
    await mockVerifyInvalid(page);
    await page.goto('/verify-email?token=garbage');
    await expect(page.getByRole('alert')).toContainText(/invalid/i);
    await expect(page.getByRole('link', { name: /back to sign in/i })).toBeVisible();
    // Should NOT show resend link for a plain-invalid token
    await expect(page.getByRole('link', { name: /resend verification email/i })).not.toBeVisible();
  });

  test('"Resend" link after expired token navigates to /resend-verification', async ({ page }) => {
    await mockVerifyExpired(page);
    await page.goto('/verify-email?token=expired-token');
    await page.getByRole('link', { name: /resend verification email/i }).click();
    await expect(page).toHaveURL(/\/resend-verification/);
  });

  test('"Sign in" link after success navigates to /login', async ({ page }) => {
    await mockVerifySuccess(page);
    await page.goto('/verify-email?token=valid-token');
    await page.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});

// ---------------------------------------------------------------------------
// Resend verification page
// ---------------------------------------------------------------------------

test.describe('Resend verification page', () => {
  test('is reachable at /resend-verification', async ({ page }) => {
    await page.goto('/resend-verification');
    await expect(page.getByRole('heading', { name: /resend verification email/i })).toBeVisible();
  });

  test('can be reached via link on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /resend it/i }).click();
    await expect(page).toHaveURL(/\/resend-verification/);
    await expect(page.getByRole('heading', { name: /resend verification email/i })).toBeVisible();
  });

  test('can be reached via "Resend" link on verify-email expired error', async ({ page }) => {
    await mockVerifyExpired(page);
    await page.goto('/verify-email?token=expired');
    await page.getByRole('link', { name: /resend verification email/i }).click();
    await expect(page).toHaveURL(/\/resend-verification/);
  });

  test('shows validation error when email is empty', async ({ page }) => {
    await page.goto('/resend-verification');
    await page.getByRole('button', { name: /send verification email/i }).click();
    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  });

  test('shows validation error for invalid email format', async ({ page }) => {
    await page.goto('/resend-verification');
    await page.getByLabel('Email address').fill('not-an-email');
    await page.getByRole('button', { name: /send verification email/i }).click();
    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  });

  test('shows success banner after submitting a valid email', async ({ page }) => {
    await mockResendSuccess(page);
    await page.goto('/resend-verification');
    await page.getByLabel('Email address').fill('alice@example.com');
    await page.getByRole('button', { name: /send verification email/i }).click();
    await expect(page.getByRole('status')).toContainText(/check your inbox/i);
  });

  test('keeps form visible after success so user can re-submit', async ({ page }) => {
    await mockResendSuccess(page);
    await page.goto('/resend-verification');
    await page.getByLabel('Email address').fill('alice@example.com');
    await page.getByRole('button', { name: /send verification email/i }).click();
    await expect(page.getByRole('status')).toBeVisible();
    // form + email input should still be present
    await expect(page.getByLabel('Email address')).toBeVisible();
  });

  test('sends correct JSON body to POST /auth/resend-verification', async ({ page }) => {
    let capturedBody = null;
    await page.route(API_RESEND, async route => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'ok' }, error: null }),
      });
    });

    await page.goto('/resend-verification');
    await page.getByLabel('Email address').fill('bob@example.com');
    await page.getByRole('button', { name: /send verification email/i }).click();
    await expect(page.getByRole('status')).toBeVisible();
    expect(capturedBody).toEqual({ email: 'bob@example.com' });
  });

  test('shows error banner when email is already verified', async ({ page }) => {
    await mockAlreadyVerified(page);
    await page.goto('/resend-verification');
    await page.getByLabel('Email address').fill('verified@example.com');
    await page.getByRole('button', { name: /send verification email/i }).click();
    await expect(page.getByRole('alert')).toContainText(/already verified/i);
  });

  test('"Sign in" footer link navigates to /login', async ({ page }) => {
    await page.goto('/resend-verification');
    await page.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
