import { useRef } from "react";
import type { KeyboardEvent, RefObject } from "react";
import { Cursor } from "./text.tsx";
import "./ink.css";

// A TUI text input: the real <input> is invisible (focus + keys only); what you see is
// the value as text with the blinking ▮ block cursor after it. `mask` renders every
// character as · (access keys); the real value never hits the DOM as text.
export function TuiInput({
  value,
  onChange,
  placeholder,
  inputRef,
  mask = false,
  onEnter,
  onFocusChange,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  inputRef?: RefObject<HTMLInputElement | null>;
  mask?: boolean;
  onEnter?: () => void;
  onFocusChange?: (focused: boolean) => void;
}) {
  const localRef = useRef<HTMLInputElement>(null);
  const ref = inputRef ?? localRef;
  const shown = mask ? "·".repeat(value.length) : value;
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" && onEnter) {
      e.preventDefault();
      onEnter();
    }
  };
  return (
    <span className="ink-input" onClick={() => ref.current?.focus()} role="presentation">
      <input
        ref={ref}
        className="ink-input__real"
        type={mask ? "password" : "text"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={onKeyDown}
        onFocus={() => onFocusChange?.(true)}
        onBlur={() => onFocusChange?.(false)}
        spellCheck={false}
        autoComplete="off"
      />
      <span className="ink-input__view">
        {value === "" && placeholder ? <span className="ink--dim">{placeholder}</span> : shown}
      </span>
      <Cursor />
    </span>
  );
}
