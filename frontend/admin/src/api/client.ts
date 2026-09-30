import { createApiClient } from "@mti/shared";

export { apiErrorMessage } from "@mti/shared";

// Keep the token key stable — renaming it would log out every admin.
// mti_admin_user was a cached user object nobody read; it's deleted on sight.
export const SESSION_KEYS = { tokenKey: "mti_admin_token", legacyKeys: ["mti_admin_user"] };

export const api = createApiClient(SESSION_KEYS);
