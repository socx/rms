import { test, expect } from '@playwright/test';

// ---------------------------------------------------------------------------
// API stubs
// ---------------------------------------------------------------------------

const API_REGISTER = '**/api/v1/auth/register';

async function mockRegisterSuccess(page) {
  await page.route(API_REGISTER, route =>
    route.fulfill({
      status: 201,
      contentType: 'application/json',
      body: JSON.stringify({
        success: true,
        data: { message: 'Account created. Please check your email to verify your address.' },
        error: null,
      }),
    })
  );
}

async function mockRegisterEmailExists(page) {
  await page.route(API_REGISTER, route =>
    route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: { code: 'EMAIL_EXISTS', message: 'An account with that email already exists.' },
      }),
    })
  );
}

async function mockRegisterDisabled(page) {
  await page.route(API_REGISTER, route =>
    route.fulfill({
      status: 403,
      contentType: 'application/json',
      body: JSON.stringify({
        success: false,
        data: null,
        error: { code: 'REGISTRATION_DISABLED', message: 'Public registration is disabled.' },
      }),
    })
  );
}

// ---------------------------------------------------------------------------
// Page object
// ---------------------------------------------------------------------------

class RegisterPageObject {
  constructor(page) {
    this.page = page;
    this.firstnameInput      = page.getByLabel('First name');
    this.lastnameInput       = page.getByLabel('Last name');
    this.emailInput          = page.getByLabel('Email address');
    this.passwordInput       = page.getByLabel('Password', { exact: true });
    this.confirmInput        = page.getByLabel('Confirm password');
    this.submitButton        = page.getByRole('button', { name: /create account/i });
  }

  async goto() {
    await this.page.goto('/register');
  }

  async fillAll({ firstname = 'Alice', lastname = 'Smith', email = 'alice@example.com', password = 'password123', confirmPassword = 'password123' } = {}) {
    await this.firstnameInput.fill(firstname);
    await this.lastnameInput.fill(lastname);
    await this.emailInput.fill(email);
    await this.passwordInput.fill(password);
    await this.confirmInput.fill(confirmPassword);
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

test.describe('Register page', () => {
  // ---- navigation ----

  test('is reachable via /register', async ({ page }) => {
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
  });

  test('can be reached by clicking "Create one" on the login page', async ({ page }) => {
    await page.goto('/login');
    await page.getByRole('link', { name: /create one/i }).click();
    await expect(page).toHaveURL(/\/register/);
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
  });

  // ---- rendering ----

  test('renders all required fields and submit button', async ({ page }) => {
    const rp = new RegisterPageObject(page);
    await rp.goto();

    await expect(rp.firstnameInput).toBeVisible();
    await expect(rp.lastnameInput).toBeVisible();
    await expect(rp.emailInput).toBeVisible();
    await expect(rp.passwordInput).toBeVisible();
    await expect(rp.confirmInput).toBeVisible();
    await expect(rp.submitButton).toBeVisible();
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  // ---- client-side validation ----

  test('shows required errors when all fields are empty', async ({ page }) => {
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await rp.submit();

    await expect(page.getByText(/first name is required/i)).toBeVisible();
    await expect(page.getByText(/last name is required/i)).toBeVisible();
    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
    await expect(page.getByText(/password must be at least 8 characters/i)).toBeVisible();
    await expect(page.getByText(/please confirm your password/i)).toBeVisible();
  });

  test('shows error for invalid email format', async ({ page }) => {
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await rp.fillAll({ email: 'not-an-email' });
    await rp.submit();

    await expect(page.getByText(/enter a valid email address/i)).toBeVisible();
  });

  test('shows error when password is too short', async ({ page }) => {
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await rp.fillAll({ password: 'short', confirmPassword: 'short' });
    await rp.submit();

    await expect(page.getByText(/password must be at least 8 characters/i)).toBeVisible();
  });

  test('shows error when passwords do not match', async ({ page }) => {
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await rp.fillAll({ password: 'password123', confirmPassword: 'different456' });
    await rp.submit();

    await expect(page.getByText(/passwords do not match/i)).toBeVisible();
  });

  // ---- API success ----

  test('shows success confirmation and hides form after successful registration', async ({ page }) => {
    await mockRegisterSuccess(page);
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await rp.fillAll();
    await rp.submit();

    await expect(page.getByRole('status')).toContainText(/check your inbox/i);
    await expect(page.getByRole('heading', { name: /create your account/i })).not.toBeVisible();
    await expect(page.getByRole('link', { name: /sign in/i })).toBeVisible();
  });

  test('sends correct JSON body to POST /api/v1/auth/register', async ({ page }) => {
    let capturedBody = null;
    await page.route(API_REGISTER, async route => {
      capturedBody = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, data: { message: 'ok' }, error: null }),
      });
    });

    const rp = new RegisterPageObject(page);
    await rp.goto();
    await rp.fillAll({
      firstname: 'Bob',
      lastname: 'Jones',
      email: 'bob@example.com',
      password: 'securepass1',
      confirmPassword: 'securepass1',
    });
    await rp.submit();

    await expect(page.getByRole('status')).toBeVisible();
    expect(capturedBody).toMatchObject({
      firstname: 'Bob',
      lastname: 'Jones',
      email: 'bob@example.com',
      password: 'securepass1',
    });
    // confirmPassword must NOT be sent to the API
    expect(capturedBody).not.toHaveProperty('confirmPassword');
  });

  // ---- API errors ----

  test('shows error banner when email already exists', async ({ page }) => {
    await mockRegisterEmailExists(page);
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await rp.fillAll();
    await rp.submit();

    await expect(rp.errorAlert()).toContainText(/account with that email already exists/i);
    // form should still be visible so user can correct the email
    await expect(page.getByRole('heading', { name: /create your account/i })).toBeVisible();
  });

  test('shows error banner when registration is disabled', async ({ page }) => {
    await mockRegisterDisabled(page);
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await rp.fillAll();
    await rp.submit();

    await expect(rp.errorAlert()).toContainText(/registration is disabled/i);
  });

  // ---- navigation back to login ----

  test('"Sign in" link on register page navigates to /login', async ({ page }) => {
    const rp = new RegisterPageObject(page);
    await rp.goto();
    await page.getByRole('link', { name: /sign in/i }).click();
    await expect(page).toHaveURL(/\/login/);
  });
});
