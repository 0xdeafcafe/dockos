import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, TouchEvent, WheelEvent } from "react";
import "./ink.css";

function useVisibleLines(): [RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(20);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      // oxlint-disable-next-line unicorn/prefer-number-coercion -- lineHeight resolves to "16.8px"; Number() would NaN
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 17;
      setVisible(Math.max(3, Math.floor(el.clientHeight / lh)));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, visible];
}

type RefObject<T> = { current: T };

// One glyph column, measured from the element's own resolved font. The mono stack varies by
// platform (SF Mono / Menlo / Consolas…), so the advance width can't be a constant.
function chWidth(el: HTMLElement): number {
  const s = getComputedStyle(el);
  const ctx = document.createElement("canvas").getContext("2d");
  if (!ctx) return 0;
  ctx.font = `${s.fontWeight} ${s.fontSize} ${s.fontFamily}`;
  return ctx.measureText("0").width;
}

// Terminal panning for a natively overflowing container: when the drag settles, land on a
// whole-column boundary so the grid never sits between cells. Costs nothing while the
// content fits (no scroll events fire).
export function useChSnap(ref: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let timer = 0;
    const onScroll = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        const ch = chWidth(el);
        if (ch > 0) el.scrollTo({ left: Math.round(el.scrollLeft / ch) * ch, behavior: "smooth" });
      }, 90);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      window.clearTimeout(timer);
    };
  }, [ref]);
}

// Terminal scrolling: wheel or touch drag moves content by WHOLE LINES (no pixel scroll), and
// a unicode ░░█░ column shows position. `follow` pins to the tail (log-style).
export function TermScroll({
  lines,
  follow = false,
  style,
}: {
  lines: ReactNode[];
  follow?: boolean;
  style?: CSSProperties;
}) {
  const [ref, visible] = useVisibleLines();
  const [top, setTop] = useState(0);
  const acc = useRef(0);
  // touch drag state: last finger Y + sub-line px remainder, live only during a gesture
  const touch = useRef<{ y: number; acc: number } | null>(null);
  // whether we're pinned to the tail. `follow` auto-advances ONLY while this holds, so a wheel-up
  // detaches to read scrollback (before, follow ignored the wheel entirely → "can't scroll logs").
  const atBottom = useRef(true);
  const maxTop = Math.max(0, lines.length - visible);
  const at = Math.min(top, maxTop);
  useChSnap(ref);

  const step = useCallback(
    (moved: number) => {
      setTop((t) => {
        const next = Math.max(0, Math.min(maxTop, Math.min(t, maxTop) + moved));
        atBottom.current = next >= maxTop;
        return next;
      });
    },
    [maxTop],
  );

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      acc.current += e.deltaY;
      const moved = Math.trunc(acc.current / 18);
      if (moved !== 0) {
        acc.current -= moved * 18;
        step(moved);
      }
    },
    [step],
  );

  // touch is the phone's wheel: accumulate drag px, emit whole-line steps at each line-height.
  // Native scrolling never engages vertically (.ink-scroll is touch-action: pan-x), so the rows
  // stay locked to the cell grid; horizontal pan stays native (and lands on columns via useChSnap).
  const onTouchStart = useCallback((e: TouchEvent<HTMLDivElement>) => {
    touch.current = { y: e.touches[0].clientY, acc: 0 };
  }, []);
  const onTouchMove = useCallback(
    (e: TouchEvent<HTMLDivElement>) => {
      const t = touch.current;
      if (!t) return;
      const lh = (ref.current && parseFloat(getComputedStyle(ref.current).lineHeight)) || 20;
      t.acc += t.y - e.touches[0].clientY; // drag up = content advances, terminal-style
      t.y = e.touches[0].clientY;
      const moved = Math.trunc(t.acc / lh);
      if (moved !== 0) {
        t.acc -= moved * lh;
        step(moved);
      }
    },
    [ref, step],
  );
  const onTouchEnd = useCallback(() => {
    touch.current = null;
  }, []);

  // advance to the tail as new lines arrive, but only while the user is parked at the bottom
  useEffect(() => {
    if (follow && atBottom.current) setTop(maxTop);
  }, [follow, maxTop, lines.length]);

  const thumb = maxTop === 0 ? 0 : Math.round((at / maxTop) * (visible - 1));

  return (
    <div
      className="ink-scroll"
      style={style}
      onWheel={onWheel}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={onTouchEnd}
    >
      <div ref={ref} className="ink-scroll__lines">
        {lines.slice(at, at + visible).map((line, i) => (
          // oxlint-disable-next-line react/no-array-index-key -- terminal rows ARE positional slots
          <div className="ink-scroll__line" key={at + i}>
            {line}
          </div>
        ))}
      </div>
      {maxTop > 0 ? <ScrollGutter visible={visible} thumb={thumb} /> : null}
    </div>
  );
}

function ScrollGutter({ visible, thumb }: { visible: number; thumb: number }) {
  return (
    <div className="ink-scroll__bar" aria-hidden>
      {Array.from({ length: visible }, (_, i) => (i === thumb ? "█" : "░")).join("\n")}
    </div>
  );
}
