import { useEffect, useRef, useState } from "react";

function format(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return h > 0 ? `${h}:${mmss}` : mmss;
}

/**
 * Remaining time until `deadline` (local-clock ms); calls onExpire once when it
 * hits zero. The ticking value is role="timer" (not announced every second);
 * a separate live region announces the last minute and the end.
 */
export function Countdown({ deadline, onExpire }: { deadline: number; onExpire: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const onExpireRef = useRef(onExpire);
  const firedRef = useRef(false);

  useEffect(() => {
    onExpireRef.current = onExpire;
  }, [onExpire]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(id);
  }, []);

  const remaining = deadline - now;

  useEffect(() => {
    if (remaining <= 0 && !firedRef.current) {
      firedRef.current = true;
      onExpireRef.current();
    }
  }, [remaining]);

  const urgent = remaining < 60_000;
  const announcement = remaining <= 0 ? "Время вышло." : urgent ? "Осталась одна минута." : "";

  return (
    <>
      <span
        role="timer"
        aria-label={`Оставшееся время: ${format(remaining)}`}
        title="Оставшееся время"
        className={`rounded-md px-2 py-0.5 font-mono text-sm font-medium tabular-nums ${
          urgent
            ? "bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-400"
            : "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300"
        }`}
      >
        <span aria-hidden="true">⏱ </span>
        {format(remaining)}
      </span>
      <span className="sr-only" aria-live="assertive">
        {announcement}
      </span>
    </>
  );
}
