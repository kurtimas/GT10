import { defineConfig } from "vitest/config";
import path from "path";

const templateRoot = path.resolve(import.meta.dirname);

export default defineConfig({
  root: templateRoot,
  resolve: {
    alias: {
      "@shared": path.resolve(templateRoot, "../shared"),
      "@api": path.resolve(templateRoot, "api"),
      "@": path.resolve(templateRoot, "src"),
      "@contracts": path.resolve(templateRoot, "../shared/contracts"),
      "@db": path.resolve(templateRoot, "../shared/db"),
      "@assets": path.resolve(templateRoot, "attached_assets"),
    },
  },
  test: {
    environment: "node",
    include: [
      "../shared/contracts/**/*.test.ts",
      "../shared/api/**/*.test.ts",
      "api/**/*.test.ts",
      "api/**/*.spec.ts",
      "src/**/*.test.ts",
    ],
  },
});
