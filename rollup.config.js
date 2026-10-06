import typescript from "@rollup/plugin-typescript"
import {lezer} from "@lezer/generator/rollup"
import {copyFileSync} from "fs"

// TypeScript reads a .d.ts file in this package as an ES module, so the
// CommonJS build needs the declarations under a .d.cts name.
const cjsTypes = {
  name: "cjs-types",
  // Also called, with the error, when the build failed.
  closeBundle(error) { if (!error) copyFileSync("dist/index.d.ts", "dist/index.d.cts") }
}

export default {
  input: "src/index.ts",
  external: id => id != "tslib" && !/^(\.?\/|\w:)/.test(id),
  output: [
    {file: "dist/index.cjs", format: "cjs"},
    {dir: "./dist", format: "es"}
  ],
  plugins: [lezer(), typescript(), cjsTypes]
}
