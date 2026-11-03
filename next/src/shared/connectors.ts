import type { CatalogConnector } from "./types"

// The connector directory: brands' own remote MCP servers. "oauth" ones let any app register itself
// and sign in with the standard flow (axe-web packages/contracts connectors.ts checked these on
// 2026-10-16); GitHub takes a token you make; "soon" ones only let apps they have approved sign in.
// Shared so the window's mock engine shows the same directory.

export const CATALOG: CatalogConnector[] = [
  { id: "notion", name: "Notion", about: "Search, read and write your pages and databases.", category: "Work", url: "https://mcp.notion.com/mcp", auth: "oauth" },
  { id: "linear", name: "Linear", about: "Find, create and update issues and projects.", category: "Work", url: "https://mcp.linear.app/mcp", auth: "oauth" },
  {
    id: "github",
    name: "GitHub",
    about: "Repositories, issues and pull requests.",
    category: "Developer",
    url: "https://api.githubcopilot.com/mcp/",
    auth: "token",
    tokenHelp: { url: "https://github.com/settings/personal-access-tokens/new", label: "Make a token on GitHub" },
  },
  { id: "slack", name: "Slack", about: "Read and send messages in your channels.", category: "Work", url: "https://mcp.slack.com/mcp", auth: "soon" },
  { id: "canva", name: "Canva", about: "Find, make and export your designs.", category: "Design", url: "https://mcp.canva.com/mcp", auth: "oauth" },
  { id: "atlassian", name: "Atlassian", about: "Jira issues and Confluence pages.", category: "Work", url: "https://mcp.atlassian.com/v1/mcp", auth: "oauth" },
  { id: "figma", name: "Figma", about: "Read designs and components.", category: "Design", url: "https://mcp.figma.com/mcp", auth: "soon" },
  { id: "asana", name: "Asana", about: "Tasks, projects and goals.", category: "Work", url: "https://mcp.asana.com/v2/mcp", auth: "soon" },
  { id: "sentry", name: "Sentry", about: "Errors, issues and releases.", category: "Developer", url: "https://mcp.sentry.dev/mcp", auth: "oauth" },
  { id: "vercel", name: "Vercel", about: "Projects, deployments and logs.", category: "Developer", url: "https://mcp.vercel.com", auth: "oauth" },
  { id: "stripe", name: "Stripe", about: "Payments, customers and revenue.", category: "Payments", url: "https://mcp.stripe.com/", auth: "oauth" },
  { id: "intercom", name: "Intercom", about: "Conversations, contacts and help articles.", category: "Sales", url: "https://mcp.intercom.com/mcp", auth: "oauth" },
  { id: "webflow", name: "Webflow", about: "Pages, CMS content and your site.", category: "Marketing", url: "https://mcp.webflow.com/mcp", auth: "oauth" },
  { id: "huggingface", name: "Hugging Face", about: "Models, datasets, papers and Spaces.", category: "Developer", url: "https://huggingface.co/mcp", auth: "oauth" },
]
