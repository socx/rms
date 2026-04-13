@rms/email

Shared email helper utilities for RMS.

Exports
- `renderVerificationTemplate(user, rawToken)` — returns `{ subject, html, verifyUrl }`.
- `enqueueVerificationEmail(enqueueFn, user, rawToken)` — DB-agnostic function; `enqueueFn` should accept a single object `{ userId, to, subject, bodyHtml }` and persist it (returns a Promise).
- `buildVerificationPreview(user, rawToken)` — returns a preview object useful for dev UI or tests.

Usage (in API):

```js
import { enqueueVerificationEmail } from '@rms/email';

// Provide an enqueue function (e.g. Prisma-backed)
await enqueueVerificationEmail(prismaEnqueue, user, rawToken);
```

Notes
- This package intentionally does not depend on a specific database or logger; callers should inject persistence and logging.
