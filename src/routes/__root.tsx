import { useEffect } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "../styles/app.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000,
      retry: 1,
    },
  },
});

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "BigBoom" },
      {
        name: "description",
        content:
          "Cooperative bomb defusal. Two players. One bomb. Procedurally generated puzzles.",
      },
      { name: "theme-color", content: "#050a14" },
      // PWA / installable + offline-capable
      { name: "mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      {
        name: "apple-mobile-web-app-status-bar-style",
        content: "black-translucent",
      },
      { name: "apple-mobile-web-app-title", content: "BigBoom" },
      // Open Graph + Twitter card so the icon also shows on link previews
      { property: "og:title", content: "BigBoom" },
      { property: "og:type", content: "website" },
      {
        property: "og:description",
        content: "Cooperative bomb defusal. Two players. One bomb.",
      },
      { property: "og:image", content: "/images/icon.png" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:image", content: "/images/icon.png" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/images/icon.png" },
      { rel: "apple-touch-icon", href: "/images/icon.png" },
      { rel: "manifest", href: "/manifest.webmanifest" },
    ],
  }),
  component: RootComponent,
});

/* Register the service worker once on the client. It precaches the app
   shell + assets so the PWA opens and plays offline after the first
   visit; failures are non-fatal (e.g. unsupported browser, http). */
function useServiceWorker() {
  useEffect(() => {
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) {
      return;
    }
    const register = () =>
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    if (document.readyState === "complete") register();
    else {
      window.addEventListener("load", register, { once: true });
      return () => window.removeEventListener("load", register);
    }
  }, []);
}

function RootComponent() {
  useServiceWorker();
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body className="bg-void text-bone min-h-screen antialiased">
        <QueryClientProvider client={queryClient}>
          <Outlet />
        </QueryClientProvider>
        <Scripts />
      </body>
    </html>
  );
}
