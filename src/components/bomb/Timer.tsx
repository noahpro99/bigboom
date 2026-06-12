interface TimerProps {
  seconds: number;
  status: string;
}

export function Timer({ seconds, status }: TimerProps) {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  const display = `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;

  const urgent = seconds <= 30 && status === "active";
  const warn = seconds <= 60 && !urgent && status === "active";
  const glow = urgent
    ? "led-glow-red"
    : warn
    ? "led-glow-amber"
    : "led-glow-green";

  return (
    <div className="relative inline-flex items-center px-6 py-2.5 bg-black/85 border border-steel/60 rounded-sm select-none">
      <div
        className="absolute inset-0 pointer-events-none rounded-sm"
        style={{ boxShadow: "inset 0 2px 6px rgba(0,0,0,0.85)" }}
      />
      <div className={`led-timer text-5xl ${glow} relative`}>{display}</div>
    </div>
  );
}
