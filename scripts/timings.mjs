export const meta = {
  purpose:
    "How long a build takes and which crates take the time. Runs `cargo build --timings` (or check) and reads cargo's timing report: wall time, summed compile time, average parallelism, time in the workspace's own crates and in build scripts, and the slowest crates. With fresh: true it builds into a new empty temporary target folder, so every crate is compiled and the caller's target folder is untouched; without it, crates that are already built show no time.",
  params: {
    fresh: "true to time a full build in a new empty target folder (slow: a whole build), default false",
    check: "true to time cargo check instead of cargo build",
    package: "crate name or list, optional (default: the whole workspace)",
    release: "true for --release",
    top: "how many of the slowest crates to list, default 10",
    path: "another workspace folder, optional",
    timeoutSeconds: "default 600",
  },
  returns: "{ok, command, wallSeconds, buildSeconds, units, cpuSecondsSummed, averageParallelism, workspaceCratesSeconds, buildScriptSeconds, slowest:['crate version what Ns, started at Ns (workspace)'], note?, buildError?}",
  example: 'await scripts.run("timings", { fresh: true })',
};

export default async function ({ cargo }, { path, ...rest } = {}) {
  const r = await (path ? cargo.at(path) : cargo).timings(rest);
  const { slowest, report, ...others } = r;
  return {
    ...others,
    ...(slowest ? { slowest: slowest.map((u) => `${u.crate} ${u.version} ${u.what} ${u.seconds}s, started at ${u.startedAt}s${u.metadataReadyAfter ? `, metadata ready after ${u.metadataReadyAfter}s` : ""}${u.workspace ? " (workspace crate)" : ""}`) } : {}),
    ...(report ? { report } : {}),
  };
}
