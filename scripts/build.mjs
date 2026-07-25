import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");
const clientSource = resolve(output, "src");
const clientFiles = ["app.js", "i18n.js", "styles.css", "totp.js", "vault.js"];

await rm(output, { recursive: true, force: true });
await mkdir(clientSource, { recursive: true });

await Promise.all([
  cp(resolve(root, "index.html"), resolve(output, "index.html")),
  cp(resolve(root, "public", "favicon.svg"), resolve(output, "favicon.svg")),
  ...clientFiles.map((file) =>
    cp(resolve(root, "src", file), resolve(clientSource, file)),
  ),
]);

console.log("Built OmniTool to dist/");
