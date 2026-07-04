import { useEffect } from "react";
import { renderBlock } from "./blockfont.ts";
import "./slam.css";

// SUPERHOT word slam: a full-screen block word punches in for one beat — TERMINATED on a
// kill, REWIND on a restart — with a 1-frame color flash and decaying echo ghosts.
export function WordSlam({
  word,
  tone = "err",
  onDone,
}: {
  word: string;
  tone?: "err" | "accent";
  onDone: () => void;
}) {
  useEffect(() => {
    const t = setTimeout(onDone, 560);
    return () => clearTimeout(t);
  }, [onDone]);
  return (
    <div className={`slam slam--${tone}`} aria-hidden>
      <pre className="slam__word">{renderBlock(word)}</pre>
    </div>
  );
}
