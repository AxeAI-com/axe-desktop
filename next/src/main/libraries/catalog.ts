import type { CatalogConnector } from "@shared/types"
import { CATALOG } from "@shared/connectors"

export { CATALOG }

/** Tests point the directory at a fake server (AXE_TEST_CONNECTOR="Name|url"). */
export function catalog(): CatalogConnector[] {
  const test = process.env.AXE_TEST_CONNECTOR
  if (!test) return CATALOG
  const [name, url] = test.split("|")
  if (!name || !url) return CATALOG
  return [{ id: "test", name, about: "A connector on this computer for tests.", category: "Work", url, auth: "oauth" }, ...CATALOG]
}
