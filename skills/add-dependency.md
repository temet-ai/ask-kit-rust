Add a dependency to a crate without duplicating one the workspace already has

1. Look before adding: `await scripts.run("why", { crate: "<name>" })`. If it is in the tree,
   note its version and who uses it. A second version of a crate that is already present doubles
   its compile time and often its types; prefer the version already there when the new use allows.
2. Read the workspace's convention: `rust.rg("workspace.dependencies", { glob: "Cargo.toml" })`.
   When the workspace root has a `[workspace.dependencies]` table, a version lives there and a
   crate says `name = { workspace = true }`. Add a new dependency to the table first.
3. Features: ask for the ones the code uses (`--features`), and `--no-default-features` when the
   default set pulls a runtime or TLS stack the crate does not want. Read the crate's feature list
   with `cargo.run("info", "<name>")`.
4. Add it (needs act). Without a `[workspace.dependencies]` table:
   `cargo.run("add", "<name>", "-p", "<crate>", "--features", "<f>")`; dev-only takes `--dev`, build-script-only `--build`.
   With the table: put `<name> = { version = "...", features = [...] }` in the table with `rust.edit`, and
   `<name> = { workspace = true }` under the crate's `[dependencies]`. Read the diff of both files
   afterwards with `rust.git("diff", "--", "Cargo.toml", "<crate path>/Cargo.toml")`.
5. Confirm: `await scripts.run("check", { package: "<crate>" })`, then `await scripts.run("why", { crate: "<name>" })`
   shows the new version count. Report a second version as a cost.
6. A crate in the dependency of a published or part crate stays on crates.io and path crates only:
   do not add a path dependency on a sibling part crate (see `split-crate`).

In the answer: the line added to each Cargo.toml, the resolved version, the version count of the
crate in the tree, and whether the crate still compiles.
