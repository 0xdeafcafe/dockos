import { useEffect, useState } from "react";
import type { CSSProperties } from "react";
import { CrtCanvasWarp } from "./HtmlCanvasWarp";
import { supportsGlElementUpload, supportsHtmlInCanvas } from "./htmlCanvasApi";

// Standalone eyeball harness. NOT wired into App.tsx. Mount it manually to inspect the warp in
// Chrome Canary with chrome://flags/#canvas-draw-element enabled:
//
//   import { HtmlCanvasLabDemo } from "./ui/crt/html-canvas-lab/Demo";
//   root.render(<HtmlCanvasLabDemo />);
//
// It exercises the three things that matter for a live-DOM warp: continuous content change
// (a ticking clock → forces per-frame re-upload), real interaction (a <button> counter), and
// selectable text — all viewed through the shader, plus a live curvature slider.

const PANEL: CSSProperties = {
  fontFamily: "ui-monospace, monospace",
  color: "#9effa0",
  background: "#0a140a",
  padding: "24px 28px",
  width: 360,
  lineHeight: 1.6,
  border: "1px solid #1f3a1f",
};
const BTN: CSSProperties = {
  font: "inherit",
  color: "#0a140a",
  background: "#9effa0",
  border: "none",
  padding: "6px 14px",
  cursor: "pointer",
};

function ClockLine() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return <div>CLOCK &gt; {now.toLocaleTimeString()}</div>;
}

function DemoContent({ count, onInc }: { count: number; onInc: () => void }) {
  return (
    <div style={PANEL}>
      <div>== HTML-IN-CANVAS CRT LAB ==</div>
      <ClockLine />
      <div style={{ margin: "12px 0" }}>
        <button type="button" style={BTN} onClick={onInc}>
          INCREMENT
        </button>{" "}
        count = {count}
      </div>
      <p style={{ userSelect: "text" }}>
        Select this text with the mouse to check whether selection survives the warp. Right-click,
        copy, and caret placement should all hit the live DOM beneath the shader.
      </p>
    </div>
  );
}

export function HtmlCanvasLabDemo() {
  const [count, setCount] = useState(0);
  const [curvature, setCurvature] = useState(-0.1);
  const apiOk = supportsHtmlInCanvas();
  const glOk = supportsGlElementUpload();

  return (
    <div style={{ padding: 32, background: "#050805", minHeight: "100vh" }}>
      <div style={{ color: "#5a7a5a", fontFamily: "monospace", marginBottom: 16 }}>
        drawElementImage: {apiOk ? "yes" : "no"} · texElementImage2D: {glOk ? "yes" : "no"}
        {!glOk && " · (no warp path — showing plain DOM fallback)"}
      </div>

      <CrtCanvasWarp curvature={curvature} renderScale={1.5}>
        <DemoContent count={count} onInc={() => setCount((c) => c + 1)} />
      </CrtCanvasWarp>

      <label style={{ display: "block", marginTop: 24, color: "#9effa0", fontFamily: "monospace" }}>
        curvature {curvature.toFixed(2)}
        <input
          type="range"
          min={-0.6}
          max={0.6}
          step={0.01}
          value={curvature}
          onChange={(e) => setCurvature(Number(e.target.value))}
          style={{ display: "block", width: 360 }}
        />
      </label>
    </div>
  );
}
