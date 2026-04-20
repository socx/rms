import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const LOGIN_URL = '/login';
const EVENTS_URL = '/events';
const API_LOGIN = '**/api/v1/auth/login';

/** Mock a successful login response from the API */
async function mockLoginSuccess(page, user = {}) {
  await page.route(API_LOGIN, route =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: {
          token: 'fake-jwt-token',
          user: {
            id: 'user-1',
            email: user.email ?? 'alice@example.com',
            firstname: 'Alice',
            lastname: 'Smith',
            timezone: 'UTC',
          },
        },
        error: null,
      }),
    })
  );
}

/** Mock an invalid-credentials error from the API */
async function mockLoginInvalidCredentials(page) {
  await page.route(API_LOGIN, route =>
    route.fulfill({
      status: 401,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' },
      }),
    })
  );
}

/** Mock an account-disabled error from the API */
async function mockLoginDisabled(page) {
  await page.route(API_LOGIN, route =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: { code: 'ACCOUNT_DISABLED', message: 'Account is not active.' },
      }),
    })
  );
}

// ---------------------------------------------------------------------------
// Page object
// ---------------------------------------------------------------------------

class LoginPageObject {
  constructor(page) {
    this.page = page;
    this.emailInput    = page.getByLabel('Email address');
    this.passwordInput = page.getByLabel('Password');
    this.submitButton  = page.getByRole('button', { name: /sign in/i });
  }

  async goto() {
    await this.page.goto(LOGIN_URL);
  }

  async fill(email, password) {
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
  }

  async submit() {
    await this.submitButton.click();
  }

  errorAlert() {
    return this.page.getByRole('alert');
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test.describe('Login page', () => {
  // ---- rendering ----

  test('renders the sign-in card with all key elements', async ({ page }) => {
    const lp = new LoginPageObject(page);
    await lp.goto();

    await expect(page).toHaveTitle(/RMS/i);
    await expect(page.getByRole('heading', { name: /sign in to your account/i })).toBeVisible();
    await expect(lp.emailInput).toBeVisible();
    await expect(lp.passwordInput).toBeVisible();
    await expect(lp.submitButton).toBeVisible();
    await expect(page.getByRole('link', { name: /forgot password/i })).toBeVisible();
  });

  // ---- client-side validation ----

  test('shows validation error when email is empty', async ({ page }) => {
    const lp = new LoginPageObject(page);
    await lp.goto();
    await lp.passwordInput.fill('password123');
    await lp.submit();

    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  });

  test('shows validation error when password is empty', async ({ page }) => {
    const lp = new LoginPageObject(page);
    await lp.goto();
    await lp.emailInput.fill('alice@example.com');
    await lp.submit();

    await expect(page.getByText(/password is required/i)).toBeVisible();
  });

  test('shows validation error when email format is invalid', async ({ page }) => {
    const lp = new LoginPageObject(page);
    await lp.goto();
    await lp.fill('not-an-email', 'password123');
    await lp.submit();

    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  });

  test('both fields are required simultaneously', async ({ page }) => {
    const lp = new LoginPageObject(page);
    await lp.goto();
    await lp.submit();

    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
    await expect(page.getByText(/password is required/i)).toBeVisible();
  });

  // ---- API success ----

  test('stores token in localStorage and redirects to /events on success', async ({ page }) => {
    await mockLoginSuccess(page);
    const lp = new LoginPageObject(page);
    await lp.goto();
    await lp.fill('alice@example.com', 'correct-password');
    await lp.submit();

    await page.waitForURL(`**${EVENTS_URL}`, { timeout: 5000 });
    expect(page.url()).toContain(EVENTS_URL);

    const token = await page.evaluate(() => localStorage.getItem('rms_token'));
    expect(token).toBe('fake-jwt-token');
  });

  test('sends correct JSON body to POST /api/v1/auth/login', async ({ page }) => {
    let capturedBody = null;
    await page.route(API_LOGIN, async route => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          data: { token: 't', user: { id: 'u1', email: 'bob@example.com', firstname: 'Bob', lastname: 'B', timezone: 'UTC' } },
          error: null,
        }),
      });
    });

    const lp = new LoginPageObject(page);
    await lp.goto();
    await lp.fill('bob@example.com', 'mysecret');
    await lp.submit();

    await page.waitForURL(`**${EVENTS_URL}`, { timeout: 5000 });
    expect(capturedBody).toEqual({ email: 'bob@example.com', password: 'mysecret' });
  });

  // ---- API errors ----

  test('shows error banner on invalid credentials', async ({ page }) => {
    await mockLoginInvalidCredentials(page);
    const lp = new LoginPageObject(page);
    await lp.goto();
    await lp.fill('alice@example.com', 'wrong-password');
    await lp.submit();

    await expect(lp.errorAlert()).toContainText(/email or password is incorrect/i);
    expect(page.url()).toContain(LOGIN_URL);
  });

  test('shows error banner on disabled account', async ({ page }) => {
    await mockLoginDisabled(page);
    const lp = new LoginPageObject(page);
    await lp.goto();
    await lp.fill('disabled@example.com', 'password123');
    await lp.submit();

    await expect(lp.errorAlert()).toContainText(/account is not active/i);
  });

  // ---- button state ----

  test('submit button is labelled "Sign in" by default', async ({ page }) => {
    const lp = new LoginPageObject(page);
    await lp.goto();
    await expect(lp.submitButton).toHaveText('Sign in');
  });

  // ---- auth redirect ----

  test('visiting /login when already logged in does not clear the token', async ({ page }) => {
    // Pre-seed a token
    await page.goto(LOGIN_URL);
    await page.evaluate(() => localStorage.setItem('rms_token', 'pre-existing'));
    await page.reload();

    const token = await page.evaluate(() => localStorage.getItem('rms_token'));
    expect(token).toBe('pre-existing');
  });
});
