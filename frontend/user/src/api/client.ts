import { createApiClient } from "@mti/shared";

export { apiErrorMessage } from "@mti/shared";

// Keep the token key stable — renaming it would log out every student.
// mti_student_user was a cached user object nobody read; it's deleted on sight.
export const SESSION_KEYS = { tokenKey: "mti_student_token", legacyKeys: ["mti_student_user"] };

export const api = createApiClient(SESSION_KEYS);
