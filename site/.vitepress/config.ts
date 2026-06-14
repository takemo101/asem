import { defineConfig } from "vitepress";

export default defineConfig({
  title: "asem",
  description: "Local agent Session manager",
  lang: "en-US",
  base: "/asem/",
  lastUpdated: true,
  cleanUrls: true,
  srcDir: ".",
  outDir: ".vitepress/dist",
  cacheDir: ".vitepress/cache",
  head: [["meta", { name: "theme-color", content: "#2563eb" }]],
  themeConfig: {
    nav: [
      { text: "Quickstart", link: "/quickstart" },
      { text: "Install", link: "/install" },
      { text: "Concepts", link: "/concepts" },
      { text: "CLI", link: "/cli" },
      { text: "TUI", link: "/tui" },
      { text: "MCP & Skills", link: "/mcp-and-skills" },
      { text: "GitHub", link: "https://github.com/takemo101/asem" },
    ],
    sidebar: {
      "/": [
        {
          text: "Getting Started",
          items: [
            { text: "Quickstart", link: "/quickstart" },
            { text: "Install", link: "/install" },
            { text: "Concepts", link: "/concepts" },
          ],
        },
        {
          text: "Usage",
          items: [
            { text: "CLI", link: "/cli" },
            { text: "TUI", link: "/tui" },
            { text: "Agent Profiles", link: "/agent-profiles" },
            { text: "Config", link: "/config" },
          ],
        },
        {
          text: "Agent Integration",
          items: [{ text: "MCP & Skills", link: "/mcp-and-skills" }],
        },
        {
          text: "Project",
          items: [{ text: "Developer Docs", link: "/developer-docs" }],
        },
      ],
    },
    socialLinks: [
      { icon: "github", link: "https://github.com/takemo101/asem" },
    ],
    editLink: {
      pattern: "https://github.com/takemo101/asem/edit/main/site/:path",
      text: "Edit this page on GitHub",
    },
    footer: {
      message: "Released under the MIT License.",
      copyright: "© 2026 takemo101",
    },
    search: { provider: "local" },
  },
});
