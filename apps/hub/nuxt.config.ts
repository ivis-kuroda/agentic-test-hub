// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  modules: ["@nuxt/ui"],
  css: ["~/assets/main.css"],
  future: { compatibilityVersion: 4 },
  devtools: { enabled: true },
  runtimeConfig: {
    // Directory the store reads and writes. Overridden per-deployment; the
    // demo suite is the default so a fresh checkout has something to show.
    specsRoot: process.env["SPECS_ROOT"] ?? "examples/demo-app/specs",
  },
});
