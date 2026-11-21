Move code out of a crate into a new crate, or between crates, without breaking the workspace

1. Understand the shape first: `await scripts.run("workspace")`. Note each crate's `depth`,
   `dependsOn` and `usedBy`. A new crate must sit where its dependencies allow: it may depend on
   crates of lower depth only, and nothing it depends on may depend on it.
2. Find what moves and what it needs: `rust.rg` for the items' uses across the workspace, and read
   the module's `use` lines for what it imports from the old crate. If the moving code needs
   something that stays behind, and the old crate needs the moving code back, the split is wrong:
   extract that shared piece into a third crate below both, or move less.
3. Rules for host-and-parts workspaces (a core crate and one crate per feature), which hold for any workspace of that shape:
   - the host (core) crate depends on no part crate and holds no part's domain words;
   - a part crate depends on the host and crates.io only, and never names another part's crate;
     parts meet through the host's contract (view data, intents, events), not through each other;
   - a trait that several parts implement lives in the host or a family crate; each implementation
     crate depends on it only;
   - every version and every internal crate is declared once in `[workspace.dependencies]`; member
     crates use `{ workspace = true }`;
   - a crate's tests use that crate's own fixtures; a test that fails in another crate after a
     change is a coupling to remove, not a snapshot to re-record.
4. Make the move in steps that each compile (needs act): create the crate (`cargo.run("new", "--lib", "<path>")`),
   add it to `[workspace] members` and `[workspace.dependencies]`, move the files (`rust.git("mv", from, to)`
   keeps history), fix module paths, re-export from the old crate (`pub use new_crate::Item;`) so
   callers keep compiling, and run `check` for the old crate, the new crate and each dependent after
   every step.
5. Tests move with the code they test. Run `await scripts.run("test", { package: ["<old>", "<new>"] })`
   before and after, and compare `passed`: it must not drop.
6. Remove the re-exports only when the request asks for callers to change.

In the answer: the new crate's path and depth, what moved, which crates now depend on it, and the
check and test counts before and after.
