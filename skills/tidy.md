Format and apply automatic fixes (cargo fmt, cargo fix, clippy --fix) without rewriting other people's files

1. Read the state first: `rust.git("status", "--short")`. Files changed by someone else stay as
   they are: cargo's fixers refuse a dirty tree unless told otherwise, and that refusal is a signal.
   Pass `--allow-dirty` only when every changed file is yours or the request says to.
2. Narrow the run to the crate named: `cargo.run("fmt", "-p", "<crate>")`;
   `cargo.run("fix", "--allow-dirty", "-p", "<crate>")` only after step 1;
   `cargo.run("clippy", "--fix", "--allow-dirty", "-p", "<crate>", "--all-targets")`.
   The default is `--check` first: `cargo.run("fmt", "--check", "-p", "<crate>")` lists what would change.
3. After it, `rust.git("diff", "--stat")` lists the files it touched. A file outside the crate, or
   one you did not expect, is reported, not kept silently: restore it with `rust.git("restore", file)`
   when it was not part of the request and was clean before.
4. Run `await scripts.run("check", { package: "<crate>", clippy: true })`. `cargo fix` and
   `clippy --fix` can leave a crate that no longer compiles under some feature or target: check with
   `allFeatures: true` when the crate has features.
5. Lints that need a decision (`byCode` with no `MachineApplicable` fix) are listed in the answer, not
   silenced with `#[allow]`, unless the request asks for the allow.

In the answer: the files changed, the clippy and check counts after, and what remains.
