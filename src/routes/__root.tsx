import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { Toaster } from "@/components/ui/sonner";
import { supabase } from "@/integrations/supabase/client";
import { useWebCallReminder } from "@/hooks/use-web-call-reminder";
import { WebCallOverlay } from "@/components/voice/WebCallOverlay";

function NotFoundComponent() {
  return (
    <div className="grid min-h-svh place-items-center bg-background p-6 text-center">
      <div>
        <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl gradient-primary text-2xl font-black text-white">M</div>
        <h1 className="mt-4 text-2xl font-black">Page not found</h1>
        <p className="mt-1 text-sm text-muted-foreground">This page hasn't been built yet.</p>
        <a href="/" className="mt-4 inline-flex rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground">Go home</a>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => { reportLovableError(error, { boundary: "tanstack_root_error_component" }); }, [error]);
  return (
    <div className="grid min-h-svh place-items-center bg-background p-6 text-center">
      <div>
        <h1 className="text-lg font-bold">Something went wrong</h1>
        <p className="mt-1 text-sm text-muted-foreground">{error.message}</p>
        <button onClick={() => { router.invalidate(); reset(); }} className="mt-4 rounded-full bg-primary px-5 py-2 text-sm font-bold text-primary-foreground">Try again</button>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1, viewport-fit=cover" },
      { title: "Mnemora Sync AI — Your AI Learning Companion" },
      { name: "description", content: "Meet Sana, your AI study buddy. Plan, focus, revise, and grow with an adaptive learning coach in your pocket." },
      { name: "theme-color", content: "#6D4AFF" },
      { property: "og:title", content: "Mnemora Sync AI" },
      { property: "og:description", content: "Your AI study buddy for planning, revision, focus, and growth." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      { rel: "stylesheet", href: appCss },
      { rel: "icon", href: "/header-logo.png", type: "image/png" },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head><HeadContent /></head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function WebCallReminderWrapper() {
  const { queryClient } = Route.useRouteContext();
  const { isOverlayOpen, activeCallConfig, closeWebCall } = useWebCallReminder();

  return (
    <WebCallOverlay
      isOpen={isOverlayOpen}
      config={activeCallConfig}
      onClose={closeWebCall}
      onRescheduled={() => {
        queryClient.invalidateQueries({ queryKey: ["reminders"] });
      }}
    />
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();
  const router = useRouter();

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event) => {
      if (event !== "SIGNED_IN" && event !== "SIGNED_OUT" && event !== "USER_UPDATED") return;
      router.invalidate();
      if (event !== "SIGNED_OUT") queryClient.invalidateQueries();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  return (
    <QueryClientProvider client={queryClient}>
      <Outlet />
      <Toaster position="top-center" richColors />
      <WebCallReminderWrapper />
    </QueryClientProvider>
  );
}
