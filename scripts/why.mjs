export const meta = {
  purpose:
    "Why a crate is in the dependency tree and in how many versions. For each version present: its source, the features switched on, which crates depend on it directly (with their version requirement and features), the shortest paths from workspace crates, and which workspace crates reach it through normal dependencies, only through build scripts, or only in tests. Reads cargo metadata only: nothing is compiled.",
  params: {
    crate: "the crate name, e.g. tokio-tungstenite",
    version: "a version or version prefix to narrow to, optional",
    paths: "how many shortest paths to list per version, default 4",
    path: "another workspace folder, optional",
  },
  returns: "{crate, found, versionCount, versions:[{version, source, featuresOn, dependents:['name version req (kinds) features'], paths:['member -> ... -> crate'], reachedBy:{normal:[members], onlyWithBuildScripts, onlyInTests}}], similar?}",
  example: 'await scripts.run("why", { crate: "syn" })',
};

const cap = (a, n = 6) => (a.length > n ? [...a.slice(0, n), `+${a.length - n} more`] : a);

export default async function ({ cargo }, { crate, version, paths, path } = {}) {
  if (!crate) throw new Error("pass crate: the name of the crate to look for");
  const w = await (path ? cargo.at(path) : cargo).why(crate, { version, paths: paths ?? 3 });
  if (!w.found) return w;
  return {
    crate: w.crate,
    versionCount: w.versionCount,
    versions: w.versions.map((v) => ({
      version: v.version,
      source: v.source,
      featuresOn: cap(v.featuresOn, 6),
      dependents: cap(v.directDependents.map((d) => `${d.by}${d.req ? ` requires ${d.req}` : ""} (${d.kinds.join(", ")})${d.features ? ` features ${d.features.join(",")}` : ""}${d.optional ? " optional" : ""}`), 5),
      paths: v.shortestPaths,
      reachedBy: { normal: cap(v.reachedByMembers.normal, 4), onlyWithBuildScripts: cap(v.reachedByMembers.onlyWithBuildScripts, 4), onlyInTests: cap(v.reachedByMembers.onlyInTests, 4) },
    })),
    note: w.note,
  };
}
