import { defineConfig as lovableConfig } from "@lovable.dev/vite-tanstack-config";
import { defineConfig } from "vite";

export default defineConfig(async (env) => {
  const config = await (await lovableConfig({
    tanstackStart: {
      // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
      // nitro/vite builds from this
      server: { entry: "server" },
    },
  }))(env);

  if (config.plugins) {
    config.plugins = config.plugins.filter(
      (p: any) => !p || (p.name !== "vite-tsconfig-paths" && p.name !== "tsconfig-paths")
    );
  }

  return config;
});
