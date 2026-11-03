// A stand-in for `ollama serve` in unit tests: listens where OLLAMA_HOST says and answers the few calls
// Axe makes (version, models, show, pull, generate, a plain chat reply). Started by the launcher test
// through a small shell wrapper, the way Axe starts the real one.
import { createServer } from "node:http"

const [host, port] = (process.env.OLLAMA_HOST ?? "127.0.0.1:11434").split(":")
const models = ["qwen2.5:7b"]

const server = createServer((req, res) => {
  let body = ""
  req.on("data", (c) => (body += c))
  req.on("end", () => {
    const json = (status, value) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value))
    if (req.url === "/api/version") return json(200, { version: "0.0.0-fake", keepAlive: process.env.OLLAMA_KEEP_ALIVE })
    if (req.url === "/api/tags") return json(200, { models: models.map((name) => ({ name, size: 4_700_000_000 })) })
    if (req.url === "/v1/models") return json(200, { data: models.map((id) => ({ id })) })
    if (req.url === "/api/show") return json(200, { capabilities: ["completion", "tools"] })
    if (req.url === "/api/generate") return json(200, { done: true })
    if (req.url === "/api/pull") {
      const { model } = JSON.parse(body)
      res.writeHead(200, { "content-type": "application/x-ndjson" })
      if (model === "nope:1b") return res.end(`${JSON.stringify({ error: "pull model manifest: file does not exist" })}\n`)
      for (const line of [
        { status: "pulling manifest" },
        { status: "pulling 2bada8a74506", total: 1000, completed: 250 },
        { status: "pulling 2bada8a74506", total: 1000, completed: 1000 },
        { status: "verifying sha256 digest" },
        { status: "success" },
      ])
        res.write(`${JSON.stringify(line)}\n`)
      models.push(model)
      return res.end()
    }
    if (req.url === "/v1/chat/completions") {
      res.writeHead(200, { "content-type": "text/event-stream" })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: "Started and answering." } }] })}\n\n`)
      return res.end("data: [DONE]\n\n")
    }
    res.writeHead(404).end()
  })
})
server.listen(Number(port), host)
process.on("SIGTERM", () => process.exit(0))
