Fix compile errors from the compiler's own diagnostics, then prove the crate builds

1. Get the errors once: `const c = await scripts.run("check", { package: "<crate>" })`. When no
   crate was named, run it without `package` and fix the crate at the top of `c.packages` first:
   an error in a crate that others depend on hides errors in the crates above it.
2. Work through `c.packages[0].diagnostics` in order. For each error read the code around
   `file:line` with `rust.read(file, { from: line - 15, to: line + 15 })`, together with the
   `label`, `help` and `fix`.
3. When the diagnostic has a `fix` with `applicability: "MachineApplicable"` and the change is what
   the code means, apply it with `rust.edit(file, from, to)`. Use the `source` line as the text to
   replace. Do not take a suggestion that only silences the compiler: `.clone()` added to satisfy a
   borrow, `unwrap()` added to satisfy a `Result`, `as _` on a type mismatch. Say what the type
   mismatch is and fix the type.
4. Common codes:
   - E0308 mismatched types: read the function's signature and the value's origin; change the one
     that is wrong. E0599 no method: the trait is not imported (`use`), or the type is not what
     you think. E0432 and E0433 unresolved import or path: the crate is not in `Cargo.toml` (see
     `add-dependency`) or the item moved: `rust.rg` for its definition.
   - E0382 use of moved value, E0502 and E0499 borrows: restructure so the value is used once or
     borrowed for less time; clone only when the data is small and the copy is meant.
   - E0277 trait bound not satisfied: read the `help` lines; they name the missing impl or bound.
   - E0004 non-exhaustive match: add the arms the enum has, with the behaviour each needs.
5. After each batch of edits run `await scripts.run("check", { package: "<crate>" })` again.
   Errors in the first run can hide others, so expect new ones. Stop when `errors` is 0.
6. When the errors cross a crate boundary (an API changed in crate A, crate B fails), fix the
   caller to the new API unless the request says the API change was a mistake.
7. When `buildError` is set and there are no diagnostics, cargo failed before compiling: read it.
   A "failed to select a version" or "no matching package" is a dependency problem; a failed build
   script is usually a missing system library or an environment variable (SQLX_OFFLINE, a database
   URL): say which, and do not guess a value.

In the answer: the crates that now build, each error fixed as `path:line code what changed`, and
anything left with its reason. Do not run clippy or fmt unless asked.
