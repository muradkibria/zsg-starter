import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@digilite/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)) } },
  test: {
    include: ["test/**/*.test.ts"],
    setupFiles: ["test/setup-env.ts"],
  },
});
