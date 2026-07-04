import { createContext, useContext, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useSound } from "../sound/SoundProvider.tsx";
import { ErrorDialog } from "./ErrorDialog.tsx";
import type { ClientError } from "./types.ts";

interface ErrorApi {
  raise: (e: ClientError) => void;
}

const ErrorContext = createContext<ErrorApi | null>(null);

export function ErrorProvider({ children }: { children: ReactNode }) {
  const [err, setErr] = useState<ClientError | null>(null);
  const sound = useSound();

  const api = useMemo<ErrorApi>(
    () => ({
      raise: (e) => {
        sound.play("error");
        setErr(e);
      },
    }),
    [sound],
  );

  return (
    <ErrorContext value={api}>
      {children}
      {err ? (
        <ErrorDialog error={err} onDismiss={() => setErr(null)} onRetry={() => setErr(null)} />
      ) : null}
    </ErrorContext>
  );
}

export function useError(): ErrorApi {
  const ctx = useContext(ErrorContext);
  if (!ctx) throw new Error("useError used outside ErrorProvider");
  return ctx;
}
