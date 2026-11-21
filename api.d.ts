interface CargoResult { code: number; out: string; err: string; ms: number; timedOut?: boolean; truncated?: boolean }
interface Diagnostic {
  level: "error" | "warning"; code: string | null; // E0308, unused_variables, clippy::len_zero
  message: string; file: string | null; line: number | null; col: number | null; // file is relative to the workspace root
  label: string | null;  // the compiler's note on the primary span: "expected `u32`, found `&str`"
  source: string | null; // the source line the primary span is on
  help?: string[];       // the compiler's help and note lines, lint-level boilerplate removed
  fix?: { say: string; file: string; line: number; replace: string; applicability: string }[]; // replace is the text to put at the span; MachineApplicable is safe to apply as it is
}
interface Checked {
  errors: number; warnings: number; // distinct diagnostics: one that appears for the lib and its tests is counted once
  packages: { package: string; errors: number; warnings: number; diagnostics: Omit<Diagnostic, "package">[] }[];
  byCode: { level: string; code: string | null; count: number; first: string; message: string }[];
  shown: number; cut: number;      // diagnostics listed, and how many were left out (errors are listed first)
}
interface WorkspaceCrate {
  name: string; version: string; path: string; edition: string; rustVersion: string | null; publish: boolean;
  targets: { kind: string; name: string; path: string }[]; // kind: lib, bin, test, example, bench, proc-macro
  features: Record<string, string[]>;
  dependsOn: { crate: string; kinds: ("normal" | "dev" | "build")[]; optional?: boolean }[]; // workspace crates only
  usedBy: string[]; externalDependencies: number;
  depth: number; // 0: depends on no other workspace crate (dev-dependencies aside); otherwise 1 + the deepest crate it depends on
}

declare const cargo: {
  cwd: string;      // the folder cargo runs in: the repository the calling agent works in
  root: string;     // the workspace root, found with `cargo locate-project --workspace`
  manifest: string | null; // its Cargo.toml; null when there is none above cwd
  act: boolean;     // true when this ask may change things

  // Environment variables added to every run of this client: cargo.env.SQLX_OFFLINE = "true". Variables that can change which program cargo runs
  // (RUSTFLAGS, RUSTC_WRAPPER, LD_*, PATH, a target runner) throw when cargo.act is false. Never put a secret here.
  env: Record<string, string>;

  // Any cargo subcommand, no shell: pass each argument separately. cargo.run("tree", "-i", "syn", "-e", "features"),
  // cargo.run("update", "--dry-run"). Never throws on a non-zero exit; stdout and stderr are separate strings.
  // It throws for:
  //  - a changing call (fmt without --check, fix, clippy --fix, add, remove, update without --dry-run, run, clean, new, init) when cargo.act is false;
  //  - publish, login, logout, owner, yank, install, uninstall, `cargo config` and a token on the command line, always;
  //  - --config, -Z and -C when cargo.act is false (they can set a program to run).
  // Runs have a timeout (default 600 s) and no terminal; at the timeout the whole process group is killed and the result has timedOut: true.
  // Builds and tests print thousands of lines: use check() and test() for those, and cut what you read from `out` with a filter.
  // Colours are off and URL passwords and *TOKEN*/*SECRET*/*PASSWORD* assignments are masked in the output.
  run(...args: string[]): Promise<CargoResult>;
  // As run, but returns stdout (trailing newlines removed) and throws cargo's error on a non-zero exit.
  text(...args: string[]): Promise<string>;
  // The same client for another workspace. A question that names another repository or path is answered there:
  // cargo.at("/path/to/my-app").workspace()
  at(dir: string): typeof cargo;

  // Does it compile, what does the compiler (or clippy) say. Runs `cargo check` or `cargo clippy` with --message-format=json
  // and returns every diagnostic once, grouped by crate, errors first. Use this for any "does it build" or "what are the errors" question.
  // package: a crate name or list (default: the whole workspace). features, allFeatures, noDefaultFeatures, exclude, release: as cargo.
  // allTargets: default true (tests, examples and benches are checked too). max: diagnostics to list, default 40. extra: more cargo arguments.
  // ok is false when cargo failed or there are errors. buildError holds cargo's own message when it failed without a compiler error
  // (an unresolvable dependency, a failed build script).
  check(o?: { clippy?: boolean; package?: string | string[]; exclude?: string[]; features?: string | string[]; allFeatures?: boolean; noDefaultFeatures?: boolean;
    release?: boolean; allTargets?: boolean; max?: number; extra?: string[]; timeoutSeconds?: number }):
    Promise<Checked & { ok: boolean; command: string; seconds: number; exitCode: number; timedOut?: boolean; buildError?: string }>;

  // Which tests fail and why. runner: "auto" (nextest when .config/nextest.toml exists and nextest is installed, else libtest), "nextest" or "libtest".
  // filter: test name substrings. profile and expr: nextest profile and filterset. ignored: only the ignored tests.
  // Returns counts and, per failing test, the panic message (the assertion with left and right), file:line:col and the output printed before it.
  // A build that does not compile returns `compile` (the compiler's errors, as check) or buildError, and no failures.
  // nextest does not run doc tests; runner "libtest" with extra ["--doc"] does.
  test(o?: { package?: string | string[]; exclude?: string[]; filter?: string | string[]; runner?: "auto" | "nextest" | "libtest"; profile?: string; expr?: string; ignored?: boolean;
    features?: string | string[]; allFeatures?: boolean; noDefaultFeatures?: boolean; release?: boolean; extra?: string[]; maxFailures?: number; max?: number; timeoutSeconds?: number }):
    Promise<{ ok: boolean; runner: string; command: string; seconds: number; exitCode: number; passed: number; failed: number; ignored: number; skipped?: number;
      binaries?: { binary: string; status: string; passed?: number; failed?: number; ignored?: number }[];
      failures: { test: string; binary: string; file?: string | null; line?: number | null; col?: number | null; message: string; output: string | null; seconds?: number | null; status?: string }[];
      failuresCut?: number; compile?: { errors: number; packages: Checked["packages"]; shown: number; cut: number }; buildError?: string;
      timedOut?: boolean; slowest?: string[]; slowTests?: string[]; crashed?: string[]; ignoredTests?: string[]; note?: string }>;

  // The parsed JSON of `cargo metadata --format-version 1` (--locked when Cargo.lock exists, so it never rewrites the lock file).
  // noDeps: true leaves out the resolved tree (fast; workspace members only). Large in a big workspace: pick fields, do not print it.
  metadata(o?: { noDeps?: boolean }): Promise<any>;

  // The workspace members: path, targets, features, the workspace crates each depends on and is used by, depth in that graph.
  // Sorted by depth, then name. Reads metadata only.
  workspace(): Promise<{ root: string; members: number; target: string; crates: WorkspaceCrate[] }>;

  // Why a crate is in the tree: every version present, who depends on each directly (with the version requirement and features asked for),
  // the shortest paths from workspace crates, the features switched on, and which workspace crates reach it through normal dependencies,
  // only through build scripts, or only in tests. Resolved for every platform, so it can list a crate `cargo tree` (host platform only) does not.
  // found: false with `similar` when no crate has that name.
  why(name: string, o?: { version?: string; paths?: number }): Promise<{ crate: string; found: boolean; versionCount?: number; note: string; similar?: string[];
    versions?: { version: string; source: string; workspaceMember?: boolean; featuresOn: string[];
      directDependents: { by: string; member?: boolean; kinds: string[]; req?: string; features?: string[]; optional?: boolean }[]; directDependentsCut?: number;
      shortestPaths: string[]; reachedByMembers: { normal: string[]; onlyWithBuildScripts: string[]; onlyInTests: string[] } }[] }>;

  // Direct dependencies that are behind, from `cargo update --dry-run --verbose` (writes nothing; needs the registry index, so the network).
  // compatibleUpdates: what `cargo update` would change. newerMajorOrIncompatible: a newer version exists but the requirement excludes it.
  // all: the whole tree, not only direct dependencies. package: one dependency.
  outdated(o?: { all?: boolean; package?: string; timeoutSeconds?: number }): Promise<{ ok: boolean; error?: string; directDependencies?: number;
    compatibleUpdates?: { action: string; name: string; from: string | null; to: string | null; direct?: boolean; usedBy?: string[] }[]; compatibleUpdatesTotal?: number;
    newerMajorOrIncompatible?: { name: string; locked: string; latest: string; direct?: boolean; usedBy?: string[] }[]; newerMajorOrIncompatibleTotal?: number; note?: string }>;

  // Build time from `cargo build --timings` (check: true for cargo check). fresh: true builds into a new empty temporary target folder, so every crate
  // is compiled and the repository's own target folder is untouched (a whole build: slow in a big workspace). Without fresh, crates already built show no time.
  timings(o?: { fresh?: boolean; check?: boolean; package?: string | string[]; release?: boolean; allTargets?: boolean; top?: number; extra?: string[]; timeoutSeconds?: number }):
    Promise<{ ok: boolean; command: string; wallSeconds: number; buildSeconds?: number; units?: number; cpuSecondsSummed?: number; averageParallelism?: number | null;
      workspaceCratesSeconds?: number; buildScriptSeconds?: number; slowest?: { crate: string; version: string; what: string; seconds: number; startedAt: number; metadataReadyAfter?: number; workspace?: boolean }[];
      note?: string; buildError?: string; error?: string }>;
};
