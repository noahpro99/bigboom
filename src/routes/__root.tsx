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
          "Cooperative bomb defusal. Two players. One survives. Procedurally generated puzzles.",
      },
      { name: "theme-color", content: "#050a14" },
      // Open Graph + Twitter card so the icon also shows on link previews
      { property: "og:title", content: "BigBoom" },
      { property: "og:type", content: "website" },
      {
        property: "og:description",
        content: "Cooperative bomb defusal. Two players. One survives.",
      },
      { property: "og:image", content: "/images/icon.png" },
      { name: "twitter:card", content: "summary" },
      { name: "twitter:image", content: "/images/icon.png" },
    ],
    links: [
      { rel: "icon", type: "image/png", href: "/images/icon.png" },
      { rel: "apple-touch-icon", href: "/images/icon.png" },
    ],
  }),
  component: RootComponent,
});

function RootComponent() {
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
