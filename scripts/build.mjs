import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import { magpieManifest } from "./magpie-manifest.mjs";

await Promise.all([
  build({
    entryPoints: ["src/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: "dist/index.js",
    external: ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent", "@earendil-works/pi-ai/compat"],
  }),
  build({
    entryPoints: ["src/magpie/index.ts"],
    bundle: true,
    platform: "node",
    format: "esm",
    outfile: "dist/magpie.js",
    external: ["@earendil-works/pi-ai", "@earendil-works/pi-coding-agent"],
    metafile: true,
  }).then((result) => {
    if (
      Object.values(result.metafile.outputs).some((output) =>
        output.imports.some((entry) => entry.path.includes("pi-coding-agent")),
      )
    )
      throw new Error("magpie build includes coding-agent");
  }),
]);

const source = JSON.parse(await readFile("package.json", "utf8"));
await writeFile("dist/magpie-package.json", `${JSON.stringify(magpieManifest(source), null, 2)}\n`);
