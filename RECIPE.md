# Recipe: rust kit

## What it answers

A Rust workspace through cargo: whether it compiles and the errors (file, line, code, message,
suggested fix), which tests fail and why, what clippy says, which crates the workspace has and how
they depend on each other, why a dependency is in the tree and in how many versions, which
features are on, what is outdated, how long a build takes and what takes the time. It changes
things when asked: `cargo fmt`, `fix`, `clippy --fix`, `add`, `remove`, `update`, and edits to
source files to fix a compile error or a failing test.

## What it needs

- `cargo` and `git` on PATH. Every call runs with the user's rights.
- `cargo nextest` is optional; it is used when installed and the workspace has `.config/nextest.toml`.
- The network, for `outdated` only (the registry index).
- No keys and no build step.

## What it reads and runs

- Runs `cargo` (no shell, no terminal) through `cargo.mjs`, in the folder the calling agent works
  in, or in a folder the question names (`cargo.at(path)`). Builds write into the workspace's
  `target` folder; `timings` with `fresh` writes into a temporary one and removes it.
- Refuses a call that changes the repository unless the ask may act; refuses publishing, login,
  `cargo config` and tokens always; masks URL passwords and token-like assignments in output.
- A `folder` source `rust` on the git root reads and, when the ask may act, edits files. It leaves
  out `target`, `.env*`, keys, tokens, cookies, databases and `.cargo/credentials`.

## Rebuild it from an empty folder

Write `ask-kit.toml` with a `module` source `cargo`, a `folder` source `rust` on a `RUST_ROOT`
setting detected by `git rev-parse --show-toplevel`, a `CARGO_TIMEOUT_SECONDS` setting (default
600), `state_key = "${RUST_ROOT}"`, and `acts` written as prose (the host cannot tell
`cargo update --dry-run` from `cargo update`, so the module does the holding back). The module
exports `make({settings, push, cwd, act})` returning a client with `run(...args)` and `text(...args)`
(every call classified as reading or changing; changing throws without `act`; spawned detached
with `CARGO_TERM_COLOR=never`, a timeout that kills the process group, and a kill on exit),
`env`, `at(dir)`, `check(o)`, `test(o)`, `metadata(o)`, `workspace()`, `why(name)`, `outdated(o)`
and `timings(o)`. Describe it exactly in `api.d.ts`.

Parsing: `cargo check|clippy --message-format=json` gives `compiler-message` lines (deduplicate by
crate, code, message and span; drop the "aborting" summaries; read the compiler's suggested
replacements from the spans of the message and its children). `cargo test --message-format=json`
mixes those lines with libtest's plain output on stdout: pair each `running N tests` block with the
`Running ...` lines on stderr, read each `---- name stdout ----` section for the panic location
and message. `cargo nextest run --message-format libtest-json` needs
`NEXTEST_EXPERIMENTAL_LIBTEST_JSON=1`; its failed-test events carry the test's stdout. `why` is a
breadth-first walk over the `resolve` graph of `cargo metadata`, split by dependency kind.
`outdated` parses the `Updating` and `Unchanged ... (available: ...)` lines of
`cargo update --dry-run --verbose`. `timings` reads `UNIT_DATA` from the HTML report of
`cargo build --timings`.

Scripts return at most about 4000 characters, which is what a REPL cell shows: one line per
diagnostic, per crate and per update.

Scripts: `check`, `test`, `workspace`, `why`, `outdated`, `timings`. Skills in `skills/`:
compile-error, failing-test, add-dependency, split-crate, tidy. Roles in `roles/`: fixer, reviewer.
`instructions.md`: start from a script, run the narrowest thing, answer in the folder the question
names, never weaken a test, leave other people's files alone.

## Bench

`bench/questions.json`: six questions of kinds agents answer by hand with cargo and two script runs. `bench/fixture` is a two-crate workspace with a compile error
and a clippy warning behind features and two failing tests, and itoa in two versions; every question runs on it.
