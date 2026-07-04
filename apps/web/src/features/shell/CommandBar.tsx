import { useEffect, useRef, useState } from "react";
import { Cursor } from "../../ui/text.tsx";
import type { Command } from "../palette/Palette.tsx";
import "./commandbar.css";

interface Reply {
  text: string;
  err: boolean;
}

function findMatches(q: string, commands: Command[]): Command[] {
  const s = q.trim().toLowerCase();
  if (s === "") return [];
  return commands.filter((c) => `${c.label} ${c.hint}`.toLowerCase().includes(s));
}

// The machine answers in its own voice: terse, institutional, useful.
function execute(q: string, commands: Command[]): Reply {
  const hit = findMatches(q, commands)[0];
  if (hit) {
    hit.run();
    return { text: `EXECUTED · ${hit.label}`, err: false };
  }
  if (q === "help") {
    const names = commands.map((c) => c.label.split(":")[0]?.trim()).join(" · ");
    return { text: `AVAILABLE: ${names}`, err: false };
  }
  return { text: `UNABLE TO COMPLY · UNKNOWN DIRECTIVE "${q.toUpperCase()}"`, err: true };
}

// The ship's command line — always present, always blinking. ":" focuses it; the deck
// answers while you type: a ghost of the best match rides the cursor (TAB accepts),
// a hint strip lists the rest, ↑/↓ walk history, ENTER executes.
function useCommandLine(
  commands: Command[],
  active: boolean,
  onActiveChange: (a: boolean) => void,
) {
  const [value, setValue] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  const [hist, setHist] = useState<string[]>([]);
  const [histAt, setHistAt] = useState<number | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (active) inputRef.current?.focus();
    else inputRef.current?.blur();
  }, [active]);

  useEffect(() => {
    if (!reply) return;
    const t = setTimeout(() => setReply(null), 3200);
    return () => clearTimeout(t);
  }, [reply]);

  const matches = findMatches(value, commands);
  const best = matches[0] ?? null;

  const submit = () => {
    const q = value.trim().toLowerCase();
    if (q === "") return;
    setReply(execute(q, commands));
    setHist((h) => [...h.slice(-19), q]);
    setHistAt(null);
    setValue("");
    onActiveChange(false);
  };

  const complete = () => {
    if (best) setValue(best.label.toLowerCase());
  };

  const walkHist = (dir: -1 | 1) => {
    if (hist.length === 0) return;
    const at =
      histAt === null
        ? dir === -1
          ? hist.length - 1
          : null
        : Math.max(0, Math.min(hist.length - 1, histAt + dir));
    if (at === null || (histAt !== null && dir === 1 && histAt === hist.length - 1)) {
      setHistAt(null);
      setValue("");
      return;
    }
    setHistAt(at);
    setValue(hist[at] ?? "");
  };

  return { value, setValue, reply, inputRef, submit, complete, walkHist, matches, best };
}

export function CommandBar({
  commands,
  active,
  onActiveChange,
}: {
  commands: Command[];
  active: boolean;
  onActiveChange: (a: boolean) => void;
}) {
  const { value, setValue, reply, inputRef, submit, complete, walkHist, matches, best } =
    useCommandLine(commands, active, onActiveChange);

  return (
    <div className="cmdbar" onClick={() => onActiveChange(true)} role="presentation">
      {active && matches.length > 0 ? (
        <div className="cmdbar__hint">
          ▸{" "}
          {matches
            .slice(0, 4)
            .map((m) => m.label)
            .join("  ·  ")}
          {matches.length > 4 ? `  · +${matches.length - 4}` : ""}
        </div>
      ) : null}
      <span className="cmdbar__prompt"> deck&gt; </span>
      <span className="cmdbar__field">
        <input
          ref={inputRef}
          className="cmdbar__real"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={() => onActiveChange(true)}
          onBlur={() => onActiveChange(false)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submit();
            else if (e.key === "Escape") onActiveChange(false);
            else if (e.key === "Tab") {
              e.preventDefault();
              complete();
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              walkHist(-1);
            } else if (e.key === "ArrowDown") {
              e.preventDefault();
              walkHist(1);
            }
            e.stopPropagation();
          }}
          spellCheck={false}
          autoComplete="off"
        />
        <span className="cmdbar__view">
          {value === "" && !active ? (
            <span className="ink--dim">type : to command the deck</span>
          ) : (
            value
          )}
        </span>
        <Cursor />
        {active && value !== "" && best ? (
          <span className="cmdbar__ghost"> ⇥ {best.label}</span>
        ) : null}
      </span>
      {reply ? (
        <span className={reply.err ? "cmdbar__err" : "cmdbar__ok"}>{reply.text}</span>
      ) : null}
    </div>
  );
}
