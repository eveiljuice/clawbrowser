<div align="center">

# 🦀 ClawBrowser

**The true browser for your agents.**

Give any AI agent full browser power through a single CLI command.
No SDKs. No cloud APIs. No code to write. Just `exec` and go.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

</div>

---

## The Problem

AI agents live in the terminal. They can read files, run commands, call APIs — but they can't browse the web like a human. Existing solutions are either:

- **SDKs** you import into code (Playwright, Puppeteer, Browser Use)
- **Cloud services** you pay for (Browserbase, Hyperbrowser)
- **MCP servers** that need specific infrastructure
- **Text browsers** that can't handle JavaScript or SPAs

None of them give an agent what it actually needs: **one shell command → browser result in stdout**.

## The Solution

ClawBrowser is `curl` for the modern web. Headless Chrome under the hood, DevTools at your fingertips, clean output piped to stdout.

```bash
# Read any page as markdown
clawbrowser get https://news.ycombinator.com

# Full DevTools inspection — DOM, network, console, performance, accessibility
clawbrowser inspect https://app.example.com --all

# Execute JavaScript on any page
clawbrowser exec https://site.com "document.querySelectorAll('.item').length"

# Interactive session — fill forms, click buttons, navigate
clawbrowser session https://github.com/login
```

Any agent that can call `exec()` now has a full browser.

## Install

```bash
git clone https://github.com/eveiljuice/clawbrowser.git
cd clawbrowser
bun install
npx playwright install chromium
```

## Commands

### `get` — Read the web

Fetches a page, extracts the main content (strips navigation, ads, boilerplate), and outputs clean markdown.

```bash
clawbrowser get https://example.com                     # Markdown (default)
clawbrowser get https://example.com --format json       # Structured JSON
clawbrowser get https://example.com --format text       # Plain text
clawbrowser get https://example.com --selector "main"   # Specific element only
clawbrowser get https://spa.app --wait-for ".loaded"    # Wait for dynamic content
```

Uses [Mozilla Readability](https://github.com/mozilla/readability) (same as Firefox Reader View) + [Turndown](https://github.com/mixmark-io/turndown) for HTML→Markdown.

### `inspect` — DevTools for agents

The killer feature. Gives agents access to everything Chrome DevTools offers — through a single command.

```bash
# Everything at once
clawbrowser inspect https://github.com

# Pick what you need
clawbrowser inspect https://github.com --dom           # Page structure: headings, links, forms, meta
clawbrowser inspect https://github.com --dom "nav a"   # Query specific elements
clawbrowser inspect https://github.com --network       # All network requests with status, type, size
clawbrowser inspect https://github.com --console       # Console output, errors, warnings
clawbrowser inspect https://github.com --storage       # Cookies + localStorage + sessionStorage
clawbrowser inspect https://github.com --perf          # TTFB, DOM ready, FCP, load time, memory
clawbrowser inspect https://github.com --a11y          # Accessibility tree via CDP
clawbrowser inspect https://github.com --headers       # Response headers
clawbrowser inspect https://github.com --css "h1"      # Computed styles for any element

# Combine flags
clawbrowser inspect https://app.com --network --console --perf
```

Output is always JSON — pipe it through `jq`, feed it to your LLM, or parse it programmatically.

### `exec` — Run JavaScript

Execute any JS expression on a fully rendered page and get the result.

```bash
clawbrowser exec https://example.com "document.title"
clawbrowser exec https://example.com "document.querySelectorAll('a').length"
clawbrowser exec https://app.com "[...document.querySelectorAll('.price')].map(e => e.textContent)"
```

### `session` — Interactive REPL

For multi-step workflows: login, navigate, fill forms, extract data.

```bash
$ clawbrowser session https://github.com/login
[github.com]> fill "#login_field" "user@mail.com"
ok
[github.com]> fill "#password" "secret"
ok
[github.com]> click "[name=commit]"
→ https://github.com/
[github.com]> extract
# GitHub
Welcome back...
[github.com]> dom "nav a"
[{"tag":"a","text":"Dashboard",...}]
[github.com]> network on
network logging ON
[github.com]> nav https://github.com/notifications
  → GET https://github.com/notifications
→ https://github.com/notifications
[github.com]> cookies save session.json
saved 12 cookies → session.json
[github.com]> quit
```

Full command list: `nav`, `back`, `forward`, `reload`, `fill`, `click`, `type`, `select`, `extract`, `dom`, `js`, `screenshot`, `cookies`, `storage`, `network on/off`, `console on/off`, `url`, `title`, `help`, `quit`.

## Agent Integration

ClawBrowser is designed to be called from any AI agent via shell exec:

```python
# Python agent
import subprocess
result = subprocess.run(["clawbrowser", "get", "https://docs.python.org"], capture_output=True, text=True)
page_content = result.stdout  # Clean markdown
```

```typescript
// TypeScript agent
const { stdout } = await exec("clawbrowser inspect https://app.com --network --console");
const data = JSON.parse(stdout);
console.log(`${data.network.total} requests, ${data.console.errors.length} errors`);
```

```bash
# Any agent with shell access
clawbrowser get https://article.com | llm "summarize this article"
clawbrowser inspect https://mysite.com --console | jq '.console.errors'
clawbrowser inspect https://site.com --dom | jq '.dom.links[].href'
```

## Why Not X?

| Tool | Type | Agent-friendly? | Full browser? |
|------|------|----------------|---------------|
| curl/wget | CLI | ✅ stdout | ❌ No JS |
| Playwright/Puppeteer | SDK | ❌ Need code | ✅ Yes |
| Browser Use | Python lib | ❌ Python only | ✅ Yes |
| Browserbase | Cloud API | ❌ Need account | ✅ Yes |
| Firecrawl | API | ❌ Need API key | ❌ Scraper |
| **ClawBrowser** | **CLI** | **✅ Just exec** | **✅ Full Chrome** |

## Options

All commands support:

| Flag | Description | Default |
|------|-------------|---------|
| `--timeout <ms>` | Navigation timeout | 30000 |
| `--proxy <url>` | Proxy server | — |
| `--wait-for <selector>` | Wait for element before proceeding | — |

## Stack

- **Runtime:** [Bun](https://bun.sh)
- **Browser engine:** [Playwright](https://playwright.dev) + Chromium
- **Content extraction:** [Mozilla Readability](https://github.com/mozilla/readability) + [Turndown](https://github.com/mixmark-io/turndown)
- **CLI framework:** [Commander](https://github.com/tj/commander.js)
- **DevTools access:** Chrome DevTools Protocol (CDP)

## Roadmap

- [ ] `bun build --compile` → single binary distribution
- [ ] Stealth mode (anti-bot detection bypass)
- [ ] Cookie persistence between commands
- [ ] Proxy rotation support
- [ ] CAPTCHA solver integration
- [ ] Parallel tab management
- [ ] MCP server mode
- [ ] `clawbrowser pipe` — chain commands Unix-style

## License

MIT

---

<div align="center">
<i>Built for agents, by agents. 🦀</i>
</div>
