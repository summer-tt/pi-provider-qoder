import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

/** Produce only the distribution manifest; the source/Pi manifest stays intact. */
export function magpieManifest(source) {
  return {
    name: source.name,
    version: source.version,
    description: "Qoder and Qoder CN OpenCode plugins for magpie",
    type: "module",
    license: source.license,
    main: "./dist/magpie.js",
    exports: "./dist/magpie.js",
    files: ["dist/magpie.js", "README.md"],
    keywords: ["opencode", "magpie", "qoder", "provider"],
    dependencies: { "@earendil-works/pi-ai": source.devDependencies["@earendil-works/pi-ai"] },
    repository: source.repository,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
  const target = resolve(process.argv[2] ?? "dist/magpie-package.json");
  await mkdir(resolve(target, ".."), { recursive: true });
  await writeFile(target, `${JSON.stringify(magpieManifest(source), null, 2)}\n`);
}
