import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// IMPORTANT: "base" must match your GitHub repo name exactly.
export default defineConfig({
  base: "/studydesk/",
  plugins: [react(), tailwindcss()],
});
