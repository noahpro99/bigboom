import { useEffect, useRef } from "react";

/* Renders `value` as a QR code onto a canvas. The `qrcode` library is
   imported dynamically inside the effect so it never runs during SSR
   (it's a browser-only concern) and stays out of the server bundle. */
export function QrCode({
  value,
  size = 220,
}: {
  value: string;
  size?: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const QR = await import("qrcode");
      if (cancelled || !canvasRef.current) return;
      await QR.toCanvas(canvasRef.current, value, {
        width: size,
        margin: 1,
        errorCorrectionLevel: "M",
        color: {
          // Light "phosphor" code on the bomb's dark chassis.
          dark: "#050a14ff",
          light: "#e9f0e7ff",
        },
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [value, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      className="rounded-sm border border-rib bg-bone"
      style={{ width: size, height: size }}
      aria-label="Match QR code"
    />
  );
}
