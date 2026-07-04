import { useEffect, useRef } from "react";
import { Box } from "../../ui/box.tsx";
import { Text } from "../../ui/text.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { keyOwnedByWidget } from "../../ui/focus.ts";
import { BANNER_ACCESS, BANNER_DENIED } from "./banners.ts";
import "./signin.css";

// The sealed console. Real auth is OIDC, so there is no local password to type — a credentials
// form here was pure theatre (it always "failed" and bounced you to SSO anyway) and, layered
// behind a noisy wall, was the unreadable overlay mess. So this is ONE clean panel: the ACCESS /
// DENIED slab in a heavy red frame over a solid black field, a terse verdict, and the only two
// real actions — VERIFY VIA SSO (redirect to Authelia) and REBOOT. Big block glyphs stay legible
// under the CRT barrel; no hex noise, no tear, no chromatic smear to fight the text.
export function DeniedScene({ onAuth }: { onAuth: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);

  // land focus on VERIFY so ↵ / arrows drive the actions immediately
  useEffect(() => {
    panelRef.current?.querySelector("button")?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (keyOwnedByWidget(e)) return;
      const k = e.key.toLowerCase();
      // one configured method (SSO) — a single clear action, plus reboot
      if (e.key === "Enter" || k === "a") onAuth();
      else if (k === "r") location.reload();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onAuth]);

  return (
    <div className="denied">
      {/* whole-page red crash on entry — hard-cut inverse flashes + a tearing band that then
          clears, so the "uh oh" lands big but settles to a readable panel */}
      <div className="denied__crash" aria-hidden />
      <div className="denied__panel" ref={panelRef}>
        <Box title={<Text tone="err">✖ SECURITY</Text>} border="heavy" tone="err">
          <pre className="denied__banner">{BANNER_ACCESS}</pre>
          <div className="denied__gap"> </div>
          <pre className="denied__banner">{BANNER_DENIED}</pre>
          <div className="denied__gap"> </div>
          <div className="denied__msg">AUTHORITY REVOKED · CONSOLE SEALED</div>
          <div className="denied__msg denied__msg--dim">
            session expired or missing · single sign-on required
          </div>
          <div className="denied__gap"> </div>
          <div className="denied__actions">
            <ActionBar
              items={[
                { key: "↵", label: "VERIFY VIA SSO", onRun: onAuth },
                { key: "R", label: "REBOOT", onRun: () => location.reload(), danger: true },
              ]}
            />
          </div>
        </Box>
      </div>
    </div>
  );
}
