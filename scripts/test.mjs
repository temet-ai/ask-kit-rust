export const meta = {
  purpose:
    "Which tests fail and why. Runs the tests (cargo nextest when the workspace has .config/nextest.toml and nextest is installed, otherwise cargo test) for a crate, a name filter or the whole workspace, and returns the counts, and for each failing test its name, binary, panic message (the failing assertion with left and right), file:line and the output it printed before failing. A build that does not compile comes back as the compiler's errors instead.",
  params: {
    package: "crate name or list of names, optional (default: the whole workspace)",
    filter: "test name substring or list, optional",
    runner: "auto (default), nextest or libtest",
    profile: "nextest profile, optional (the workspace's .config/nextest.toml names them)",
    expr: "nextest filterset expression, optional",
    ignored: "true to run only the ignored tests",
    features: "feature name or list, optional",
    extra: "extra cargo arguments as a list, optional",
    maxFailures: "how many failures to detail, default 6",
    timeoutSeconds: "default 600",
  },
  returns: "{ok, runner, command, seconds, passed, failed, ignored, skipped?, binaries?, failures:[{test, binary, at:'file:line:col', message, printed?}], failuresCut?, compile?:{errors, byCrate:{crate:[diagnostic lines]}}, buildError?, timedOut?, slowest?, ignoredTests?}",
  example: 'await scripts.run("test", { package: "my-crate", filter: "parser" })',
};

export default async function ({ cargo }, { maxFailures = 6, ...params } = {}) {
  const t = await cargo.test({ ...params, maxFailures, max: 12 });
  const { failures, compile, ...rest } = t;
  const out = { ...rest, failures: failures.map((f) => cargo.format.failure(f)) };
  if (rest.binaries) out.binaries = rest.binaries.map((b) => `${b.binary}: ${b.status}${b.passed != null ? `, ${b.passed} passed, ${b.failed} failed, ${b.ignored} ignored` : ""}`);
  delete out.command;
  out.command = t.command.length > 200 ? t.command.slice(0, 200) + "…" : t.command;
  if (compile) {
    out.compile = { errors: compile.errors, byCrate: Object.fromEntries(compile.packages.map((p) => [`${p.package} (${p.errors} errors)`, p.diagnostics.map((d) => cargo.format.diagnostic(d))])), ...(compile.cut ? { cut: compile.cut } : {}) };
  }
  return out;
}
