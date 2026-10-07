// Prints the section of CHANGELOG.md for the version in package.json,
// which becomes the text of its GitHub release. Fails when there is no
// such section under a heading like "## 1.2.3 (2026-01-31)".
//
// With --check, prints nothing, and also fails when the working tree has
// changes that are not committed. `npm publish` runs this first, so that
// what is published is what the release tag will point at.
import {readFileSync} from "node:fs"
import {execFileSync} from "node:child_process"
import {fileURLToPath} from "node:url"

const root = new URL("../", import.meta.url)
const check = process.argv.includes("--check")

function fail(message) {
  console.error(message)
  process.exit(1)
}

const {version} = JSON.parse(readFileSync(new URL("package.json", root), "utf8"))
const lines = readFileSync(new URL("CHANGELOG.md", root), "utf8").split(/\r?\n/)

const start = lines.findIndex(line => {
  let heading = /^## (\S+) \(\d{4}-\d{2}-\d{2}\)$/.exec(line)
  return heading && heading[1] == version
})
if (start < 0) fail(`CHANGELOG.md has no section headed "## ${version} (YYYY-MM-DD)"`)

let end = lines.findIndex((line, i) => i > start && line.startsWith("## "))
const notes = lines.slice(start + 1, end < 0 ? lines.length : end).join("\n").trim()
if (!notes) fail(`The section of CHANGELOG.md for ${version} is empty`)

if (check) {
  let changes = execFileSync("git", ["status", "--porcelain"], {cwd: fileURLToPath(root), encoding: "utf8"})
  if (changes.trim()) fail("The working tree has changes that are not committed:\n" + changes)
} else {
  console.log(notes)
}
