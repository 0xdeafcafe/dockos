import { z } from "zod";

// The signed-in operator, sourced from Authelia's forward-auth headers (Remote-User,
// Remote-Email, Remote-Name, Remote-Groups). When no identity is present the method raises
// kind "auth.missing" (or "auth.expired") — the boot sequence branches on that.
export const Operator = z.object({
  username: z.string(),
  email: z.string().nullable(),
  name: z.string().nullable(),
  groups: z.array(z.string()),
});
export type Operator = z.infer<typeof Operator>;

export const AuthSessionParams = z.object({});
export type AuthSessionParams = z.infer<typeof AuthSessionParams>;

export const AuthSessionResult = z.object({
  operator: Operator,
});
export type AuthSessionResult = z.infer<typeof AuthSessionResult>;

// Sign-out. The server has no body to act on beyond the request itself, so params are empty.
// The result is where the browser should navigate to complete the sign-out: in oidc mode that
// is the app's own /auth/logout (a GET that clears the docking session cookie server-side, then
// redirects on to the provider's end-session endpoint). null when there is nothing to clear
// (forward/dev mode own no docking session — you sign out at the identity provider itself).
export const AuthSignoutParams = z.object({});
export type AuthSignoutParams = z.infer<typeof AuthSignoutParams>;

export const AuthSignoutResult = z.object({
  redirectUrl: z.string().nullable(),
});
export type AuthSignoutResult = z.infer<typeof AuthSignoutResult>;
