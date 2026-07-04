import { useEffect, useRef, useState } from "react";
import { Box } from "../../ui/box.tsx";
import { Text } from "../../ui/text.tsx";
import { TuiInput } from "../../ui/input.tsx";
import { ActionBar } from "../../ui/actionbar.tsx";
import { DEMO_ACCESS_KEY, DEMO_OPERATOR } from "../../demo.ts";
import { BANNER_DOCKOS } from "./banners.ts";
import { DeniedScene } from "./SignIn.tsx";
import "./demo.css";

// DEMO ONLY (VITE_DEMO=true). The public GitHub Pages build has no OIDC and no backend, so the
// sealed console accepts one printed credential instead of bouncing to SSO. Type the hinted
// OPERATOR / ACCESS KEY → you're in (into the fully-mocked deck); type anything else → the exact
// ACCESS DENIED wall a real 401 raises. Rendered by App AFTER the boot cinematic, so the ritual is
// untouched. None of this exists in the server-backed build (App never mounts it when DEMO is off).

// The "what is this / run it for real" briefing that greets every visitor and stays re-openable.
// Reuses the shared .confirm modal shell (ink.css) — no new chrome.
function DemoAbout({ onClose }: { onClose: () => void }) {
  const btnRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    btnRef.current?.querySelector("button")?.focus();
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  return (
    <div className="confirm">
      <div className="confirm__dialog demo-about" ref={btnRef}>
        <Box title={<Text tone="accent">◈ DOCK/OS · LIVE DEMO</Text>} border="heavy" tone="accent">
          <div className="demo__gap"> </div>
          <div className="demo-about__body">
            <div>
              You are looking at a LIVE MOCK of DOCK/OS — a single-screen console for a self-hosted
              Docker fleet. Every pane, chart and action here runs on canned fixtures: nothing talks
              to a server, and nothing you do leaves your browser.
            </div>
            <div className="demo__gap"> </div>
            <div>To run it FOR REAL against your own engine, self-host it from source:</div>
            <div className="demo-about__url">github.com/0xdeafcafe/dockos</div>
            <div className="demo__gap"> </div>
            <div className="ink--dim">
              Sign in with the OPERATOR / ACCESS KEY printed on the console.
            </div>
          </div>
          <div className="demo__gap"> </div>
          <div className="demo-about__actions">
            <ActionBar items={[{ key: "↵", label: "ENTER THE DEMO", onRun: onClose }]} />
          </div>
          <div className="demo__gap"> </div>
        </Box>
      </div>
    </div>
  );
}

export function DemoSignIn({ onGranted }: { onGranted: () => void }) {
  const [operator, setOperator] = useState("");
  const [accessKey, setAccessKey] = useState("");
  const [denied, setDenied] = useState(false);
  const [about, setAbout] = useState(true);
  const opRef = useRef<HTMLInputElement>(null);

  // land the cursor on the OPERATOR field once the briefing clears (and after a bounce back)
  useEffect(() => {
    if (!about && !denied) opRef.current?.focus();
  }, [about, denied]);

  const submit = () => {
    if (operator.trim() === DEMO_OPERATOR && accessKey === DEMO_ACCESS_KEY) {
      onGranted();
      return;
    }
    setDenied(true);
  };

  // wrong credentials → the exact ACCESS DENIED cinematic the real gate fires. "VERIFY" returns you
  // to the console to retry (there's no SSO to bounce to in the demo); "REBOOT" reloads.
  if (denied) {
    return (
      <DeniedScene
        onAuth={() => {
          setDenied(false);
          setAccessKey("");
        }}
      />
    );
  }

  return (
    <div className="demo">
      {about ? <DemoAbout onClose={() => setAbout(false)} /> : null}
      <div className="demo__panel">
        <Box title={<Text tone="accent">◈ SEALED CONSOLE</Text>} border="double" tone="accent">
          <pre className="demo__logo">{BANNER_DOCKOS}</pre>
          <div className="demo__sub">DATA CONTAINMENT ENFORCER · REV 0.1 · DEMO</div>
          <div className="demo__gap"> </div>
          <div className="demo__field">
            <span className="demo__label">OPERATOR</span>
            <TuiInput
              value={operator}
              onChange={setOperator}
              inputRef={opRef}
              placeholder="username"
              onEnter={submit}
            />
          </div>
          <div className="demo__field">
            <span className="demo__label">ACCESS KEY</span>
            <TuiInput
              value={accessKey}
              onChange={setAccessKey}
              mask
              placeholder="access key"
              onEnter={submit}
            />
          </div>
          <div className="demo__gap"> </div>
          <div className="demo__hint">
            ▓ DEMO CONSOLE — OPERATOR: {DEMO_OPERATOR} · ACCESS KEY: {DEMO_ACCESS_KEY}
          </div>
          <div className="demo__gap"> </div>
          <div className="demo__actions">
            <ActionBar
              items={[
                { key: "↵", label: "AUTHORIZE", onRun: submit },
                { key: "?", label: "ABOUT THIS DEMO", onRun: () => setAbout(true) },
                { key: "R", label: "REBOOT", onRun: () => location.reload(), danger: true },
              ]}
            />
          </div>
        </Box>
      </div>
    </div>
  );
}
