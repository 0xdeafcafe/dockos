// Demo build (GitHub Pages, dockos.forbes.red). The frontend-only bundle is built with
// VITE_DEMO=true; the server-backed production build leaves it unset, so `DEMO` folds to `false`
// and every branch guarded by it is dead — the real app stays byte-for-byte the same.
//
// This is the ONE place the flag and the fake-auth credentials live.
export const DEMO: boolean = import.meta.env.VITE_DEMO === "true";

// The single credential the sealed console accepts in the demo. Shown to the visitor as a hint on
// the sign-in screen, so anyone can get in; anything else fires the real ACCESS DENIED wall.
export const DEMO_OPERATOR = "guest";
export const DEMO_ACCESS_KEY = "overwatch";
