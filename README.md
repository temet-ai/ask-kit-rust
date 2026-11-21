# ask-kit-rust

An [ask-kit](https://github.com/temet-ai/ask-kit) kit that lets your coding agent's `ask` tool
answer questions about a Rust workspace through `cargo`, and fix compile errors and failing tests
when asked. A cheap model runs `cargo check`, `clippy`, `test`, `nextest`, `metadata` and `tree`
outside your agent's context and answers with the errors, the failing assertions and the
dependency paths, each with `path:line`, a compiler code or a crate version.

Questions from its bench, of the kinds agents had answered by hand with `cargo`:

- Does the workspace compile with feature `err` on? Give each error with file, line and code.
- Which tests fail, and what does each failing assertion say?
- Why is itoa in the dependency tree, and in how many versions?

## Install

You need [ask-kit](https://github.com/temet-ai/ask-kit#set-it-up), `cargo` and `git`. `cargo
nextest` is used when it is installed and the workspace has a `.config/nextest.toml`.

Paste this into your agent:

```
Read ~/.config/ask-kit/AGENTS.md, then add this kit: github.com/temet-ai/ask-kit-rust
```

Or run it yourself:

```sh
ask-kit kit install temet-ai/ask-kit-rust        # shows what it reads, changes and runs
ask-kit kit install temet-ai/ask-kit-rust --yes  # installs and enables it
```

Restart your agents so `ask` lists `rust`. The kit answers about the workspace your agent works
in, which must be inside a git repository; a question that names another folder is answered there.
A build can take longer than `ask`'s default five minutes: pass `timeoutSeconds` (up to 900) on
the call, and set `CARGO_TIMEOUT_SECONDS` (default 600) in `domains.rust.settings` for the limit
on one cargo run.

## What it carries

| | |
|---|---|
| Scripts | `check` (errors and warnings from `cargo check` or clippy, once each, grouped by crate, with the compiler's fix), `test` (counts, and each failing test's panic, location and output; nextest or libtest), `workspace` (crates, paths, how they depend on each other, depth), `why` (every version of a crate in the tree, who depends on it, paths from the workspace, features on), `outdated` (direct dependencies behind, from `cargo update --dry-run`), `timings` (build time and the slowest crates from `cargo build --timings`) |
| Skills | `compile-error`, `failing-test`, `add-dependency`, `split-crate`, `tidy`: playbooks the investigator loads when the job calls for one |
| Roles | `fixer` for requests to make it compile, make a test pass or clear warnings; `reviewer` for questions about the quality or structure of Rust code |

Each script also runs with no model: `ask-kit run rust check`, or `ask(do: "rust.check")` from an
agent. The `cargo` global in the investigator's REPL is described in `api.d.ts`; the `rust` global
reads and, when asked to change something, edits the repository's files.

## What it can change

When the request asks for a change, it runs `cargo fmt`, `cargo fix`, `clippy --fix`,
`cargo add`, `remove` and `update`, and edits source files to fix a compile error or a failing
test. A question never changes anything: `cargo.mjs` sorts every cargo call into reading or
changing, and a changing call is refused unless the caller asked for a change (`act`). `check`,
`build`, `test`, `clippy`, `metadata`, `tree`, `fmt --check` and `update --dry-run` count as
reading; they write to the `target` folder only, and pass `--locked` when a `Cargo.lock` exists so
they never rewrite it.

`cargo.mjs` also checks each command before it runs:

- `publish`, `login`, `logout`, `owner`, `yank`, `install`, `uninstall` and `cargo config` are
  refused, with or without `act`, as is a token on the command line. URL passwords and
  `*TOKEN*`, `*SECRET*` and `*PASSWORD*` assignments are masked in all output.
- `--config`, `-Z`, `-C` and environment variables that change which program cargo runs
  (`RUSTFLAGS`, `RUSTC_WRAPPER`, `LD_*`, `PATH`) are refused in a question.
- Every run has a timeout and no terminal; at the timeout the whole process group is killed.

The repository folder it reads leaves out `target`, `.env*`, keys, tokens, cookies, databases and
`.cargo/credentials`. Its instructions tell it never to change an assertion, delete or ignore a
test, or add an `#[allow]` to get a run to pass, and to leave files it did not change alone.

## How well it works

`bench/questions.json` holds six questions and two script runs, each with patterns its answer
must hold. The compile, test, clippy and outdated questions run on `bench/fixture`, a two-crate
workspace in this repository that has a compile error and a clippy warning behind features and two
failing tests on purpose; do not run its tests expecting green. The scripts have been run on the
fixture and, for `workspace` and `why`, on a real workspace, and the patterns were checked against
that output. The bench has not been run on a model yet; `ask-kit kit test rust` runs it.
