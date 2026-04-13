// Re-export higher-level email helpers from the shared package so callers
// can import from `apps/api/src/services/email.js` without changing paths.
import { renderVerificationTemplate, enqueueVerificationEmail, buildVerificationPreview } from '../../../../packages/email/src/index.js';

export { renderVerificationTemplate, enqueueVerificationEmail, buildVerificationPreview };

export default { renderVerificationTemplate, enqueueVerificationEmail, buildVerificationPreview };
