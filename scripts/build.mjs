import { cp, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const output = resolve(root, "dist");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

await Promise.all([
  cp(resolve(root, "index.html"), resolve(output, "index.html")),
  cp(resolve(root, "src"), resolve(output, "src"), { recursive: true }),
  cp(resolve(root, "public"), output, { recursive: true }),
]);

console.log("Built OmniTool to dist/");
