import { $ } from "bun";

// Build with playwright as external (requires node_modules nearby)
await $`bun build src/index.ts --compile --outfile clawbrowser --external playwright --external playwright-core --external playwright-extra --external puppeteer-extra-plugin-stealth --external puppeteer-extra-plugin`;

console.log("\n✅ Built: ./clawbrowser (requires node_modules/ in same dir or NODE_PATH)");
console.log("To install: cp clawbrowser /usr/local/bin/ && ln -s $(pwd)/node_modules /usr/local/lib/clawbrowser-modules");
