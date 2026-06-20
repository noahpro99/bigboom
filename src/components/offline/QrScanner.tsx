import { useEffect, useRef, useState } from "react";
import { Camera, X, AlertTriangle } from "lucide-react";

/* Live camera QR scanner. Uses the device's rear camera (getUserMedia)
   and decodes frames with jsQR on a hidden canvas. Both jsQR and the
   camera APIs are browser-only, so everything runs inside effects and
   jsQR is imported dynamically to keep it out of the SSR bundle.

   Calls `onResult` with the decoded string the first time a code is
   found, then stops. Works fully offline once the page is cached. */
export function QrScanner({
  onResult,
  onClose,
}: {
  onResult: (text: string) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stream: MediaStream | null = null;
    let raf = 0;
    let stopped = false;

    async function start() {
      if (
        typeof navigator === "undefined" ||
        !navigator.mediaDevices?.getUserMedia
      ) {
        setError("Camera not available on this device.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: "environment" },
          audio: false,
        });
      } catch {
        setError("Camera permission denied. Enter the code by hand instead.");
        return;
      }
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true");
      await video.play().catch(() => {});

      const jsQRModule = await import("jsqr");
      const jsQR = jsQRModule.default;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d", { willReadFrequently: true });

      const tick = () => {
        if (stopped || !video || !canvas || !ctx) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
          const code = jsQR(img.data, img.width, img.height, {
            inversionAttempts: "dontInvert",
          });
          if (code && code.data) {
            stopped = true;
            onResult(code.data);
            return;
          }
        }
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    }

    start();
    return () => {
      stopped = true;
      cancelAnimationFrame(raf);
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, [onResult]);

  return (
    <div className="relative border border-rib bg-void/80 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 border-b border-rib text-[10px] font-mono uppercase tracking-[0.25em] text-bone-dim">
        <span className="flex items-center gap-1.5">
          <Camera size={12} /> Point at your partner's code
        </span>
        <button
          onClick={onClose}
          aria-label="Close scanner"
          className="text-bone-dim hover:text-bone"
        >
          <X size={14} />
        </button>
      </div>
      {error ? (
        <div className="p-4 text-crimson font-mono text-xs flex items-center gap-2">
          <AlertTriangle size={14} /> {error}
        </div>
      ) : (
        <div className="relative aspect-square bg-black">
          <video
            ref={videoRef}
            className="absolute inset-0 w-full h-full object-cover"
            muted
          />
          {/* Reticle */}
          <div className="absolute inset-8 border-2 border-phosphor/70 rounded-sm pointer-events-none" />
        </div>
      )}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  );
}
