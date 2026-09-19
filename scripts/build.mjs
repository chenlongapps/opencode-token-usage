import { execFileSync } from "node:child_process";
import { readFile, writeFile, unlink } from "node:fs/promises";
import { transformAsync } from "@babel/core";

execFileSync(process.execPath, ["node_modules/typescript/bin/tsc", "-p", "tsconfig.build.json"], { stdio: "inherit" });
const result = await transformAsync(await readFile("dist/tui.jsx", "utf8"), {
  filename: "tui.jsx",
  presets: [["babel-preset-solid", { generate: "universal", moduleName: "@opentui/solid" }]],
});
await writeFile("dist/tui.js", result.code + "\n");
await unlink("dist/tui.jsx");
