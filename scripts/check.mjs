export const meta = {
  purpose:
    "Does the workspace compile, and what does the compiler or clippy say. Runs cargo check (or cargo clippy) with its JSON output and returns each error and warning once, grouped by crate, with file, line, code, message, the source line, the compiler's own fix (replacement text and how safe it is) and counts by lint code. Runs outside the caller's context: the build log is never returned.",
  params: {
    package: "crate name or list of names to check, optional (default: the whole workspace)",
    clippy: "true to run cargo clippy instead of cargo check, default false",
    features: "feature name or list, optional",
    allFeatures: "true for --all-features",
    allTargets: "false to leave out tests, examples and benches, default true (they are checked too)",
    max: "how many diagnostics to list as lines, errors first, default 15 (the rest stay in byCode and the counts)",
    timeoutSeconds: "default 600",
  },
  returns: "{ok, command, seconds, errors, warnings, byCrate:{'<crate> (N errors, M warnings)': ['error[E0308] file:line:col message: label | src: the source line | fix: what -> replacement (applicability)']}, byCode:['error E0308 x2 first file:line'], cut?, buildError?}. buildError is set when cargo failed for a reason that is not a compiler diagnostic (dependency resolution, a build script). cargo.check() has the structured rows.",
  example: 'await scripts.run("check", { package: "my-crate", clippy: true })',
};

export default async function ({ cargo }, { max = 15, ...params } = {}) {
  const c = await cargo.check({ ...params, max });
  const byCrate = {};
  for (const p of c.packages) {
    const rows = p.diagnostics.map((d) => cargo.format.diagnostic(d));
    const label = `${p.package} (${p.errors} error${p.errors === 1 ? "" : "s"}, ${p.warnings} warning${p.warnings === 1 ? "" : "s"})`;
    byCrate[label] = rows;
  }
  return {
    ok: c.ok,
    command: c.command,
    seconds: c.seconds,
    ...(c.exitCode ? { exitCode: c.exitCode } : {}),
    ...(c.timedOut ? { timedOut: true } : {}),
    errors: c.errors,
    warnings: c.warnings,
    byCrate,
    byCode: c.byCode.slice(0, 10).map((x) => `${x.level} ${x.code ?? "(no code)"} x${x.count} first ${x.first}`),
    ...(c.cut ? { cut: c.cut, more: "re-run with package set to one crate, or max higher" } : {}),
    ...(c.buildError ? { buildError: c.buildError } : {}),
  };
}
