import esbuild from "esbuild";
import process from "node:process";

const isWatch = process.argv.includes("--watch");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "main.js",
  format: "cjs",
  platform: "node",
  target: "es2020",
  sourcemap: "inline",
  external: ["obsidian", "electron", "@codemirror/*"],
  logLevel: "info"
});

if (isWatch) {
  await context.watch();
  console.log("Watching for changes...");
} else {
  await context.rebuild();
  await context.dispose();
}
