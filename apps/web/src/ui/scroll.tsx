import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { CSSProperties, ReactNode, WheelEvent } from "react";
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

// Terminal scrolling: the wheel moves content by WHOLE LINES (no pixel scroll), and a
// unicode ░░█░ column shows position. `follow` pins to the tail (log-style).
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
  // whether we're pinned to the tail. `follow` auto-advances ONLY while this holds, so a wheel-up
  // detaches to read scrollback (before, follow ignored the wheel entirely → "can't scroll logs").
  const atBottom = useRef(true);
  const maxTop = Math.max(0, lines.length - visible);
  const at = Math.min(top, maxTop);

  const onWheel = useCallback(
    (e: WheelEvent<HTMLDivElement>) => {
      acc.current += e.deltaY;
      const moved = Math.trunc(acc.current / 18);
      if (moved !== 0) {
        acc.current -= moved * 18;
        setTop((t) => {
          const next = Math.max(0, Math.min(maxTop, Math.min(t, maxTop) + moved));
          atBottom.current = next >= maxTop;
          return next;
        });
      }
    },
    [maxTop],
  );

  // advance to the tail as new lines arrive, but only while the user is parked at the bottom
  useEffect(() => {
    if (follow && atBottom.current) setTop(maxTop);
  }, [follow, maxTop, lines.length]);

  const thumb = maxTop === 0 ? 0 : Math.round((at / maxTop) * (visible - 1));

  return (
    <div className="ink-scroll" style={style} onWheel={onWheel}>
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
