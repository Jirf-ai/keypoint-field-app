// Dynamic Expo config. Keeps app.json as the source of truth and only adds the
// GitHub Pages base path when building for Pages (GITHUB_PAGES=true, set by the
// deploy-pages workflow). Every other export — including the Supabase-bucket /
// PWA path in deploy-web.ps1 — runs without it, so their asset paths are
// unaffected.
module.exports = ({ config }) => {
  if (process.env.GITHUB_PAGES === "true") {
    config.experiments = { ...(config.experiments || {}), baseUrl: "/keypoint-field-app" };
  }
  return config;
};
