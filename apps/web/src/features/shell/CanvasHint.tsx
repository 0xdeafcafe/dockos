import { useState } from "react";
import { useTheme } from "../../theme/ThemeProvider.tsx";
import { supportsHtmlInCanvas } from "../../ui/crt/html-canvas-lab/htmlCanvasApi.ts";

const FLAG = "chrome://flags/#enable-experimental-web-platform-features";
const DISMISS_KEY = "dockos.canvashint.dismissed";

// One-line advisory strip shown whenever the GPU barrel-warp ISN'T the running path — i.e. the tube
// is on the flat fallback. Two cases:
//   · browser can't do HTML-in-Canvas → tell them the real warp exists + how to unlock it (copy the
//     flag; chrome:// can't be linked).
//   · browser CAN but GPU WARP is toggled off → offer to turn it on right here.
// Hidden when the warp is actually running (supported AND on), when the tube is OFF, or once
// dismissed (sticks). This is the discoverable "tell people about it" surface a Settings row misses.
export function CanvasHint() {
  const theme = useTheme();
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "1");
  const [copied, setCopied] = useState(false);
  const supported = supportsHtmlInCanvas();
  const warpActive = supported && theme.canvasWarp;
  if (dismissed || theme.crt === "off" || warpActive) return null;

  const copyFlag = () => {
    void navigator.clipboard?.writeText(FLAG);
    setCopied(true);
  };
  const dismiss = () => {
    localStorage.setItem(DISMISS_KEY, "1");
    setDismissed(true);
  };

  return (
    <div className="canvashint" role="note">
      <span className="canvashint__mark">⌁</span>
      {supported ? (
        <span className="canvashint__text">
          FLAT TUBE · the GPU barrel-warp is available but OFF —{" "}
          <button className="canvashint__flag" onClick={theme.toggleCanvasWarp}>
            [▦ ENABLE GPU WARP]
          </button>
        </span>
      ) : (
        <span className="canvashint__text">
          FLAT TUBE · a real GPU barrel-warp is available in Chrome — enable{" "}
          <button className="canvashint__flag" onClick={copyFlag} title="copy the flag URL to clipboard">
            {copied
              ? "COPIED ✓ — paste into a new tab"
              : "chrome://flags › EXPERIMENTAL WEB PLATFORM FEATURES"}
          </button>{" "}
          and reload.
        </span>
      )}
      <span className="canvashint__spacer" />
      <button className="canvashint__x" onClick={dismiss} title="dismiss — don't show again">
        [× DISMISS]
      </button>
    </div>
  );
}
