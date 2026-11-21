export const meta = {
  purpose:
    "The crates of the workspace, one line each: path, depth in the dependency graph between workspace crates (0 is a crate that depends on no other member), which workspace crates it depends on and which depend on it, binaries, feature names, and how many outside dependencies it has. With `crate`, the full record of one crate including every target and feature. Reads cargo metadata only: nothing is compiled.",
  params: {
    crate: "one crate name for its full record, optional",
    path: "another workspace folder, optional (default: the caller's)",
    max: "how many crates to list, default 60",
  },
  returns: "{root, members, targetDir, crates:['depth N  name version  path  | deps: a, b (dev)  | usedBy: x, y  | bins: ...  | features: ...  | N outside deps']}; with crate: {root, crate:{name, version, path, edition, targets, features, dependsOn:[{crate, kinds}], usedBy, externalDependencies, depth}}",
  example: 'await scripts.run("workspace")',
};

const list = (a, n = 8) => (a.length > n ? `${a.slice(0, n).join(", ")} +${a.length - n} more` : a.join(", ") || "none");

export default async function ({ cargo }, { crate, path, max = 60 } = {}) {
  const c = path ? cargo.at(path) : cargo;
  const w = await c.workspace();
  if (crate) {
    const r = w.crates.find((x) => x.name === crate);
    if (!r) return { found: false, crate, members: w.crates.map((x) => x.name) };
    return { root: w.root, crate: r };
  }
  const lines = w.crates.map((r) => {
    const deps = r.dependsOn.map((d) => (d.kinds.length === 1 && d.kinds[0] === "normal" ? d.crate : `${d.crate} (${d.kinds.join(", ")})`));
    const bins = r.targets.filter((t) => t.kind === "bin").map((t) => t.name);
    const feats = Object.keys(r.features);
    return `depth ${r.depth}  ${r.name} ${r.version}  ${r.path}  | deps: ${list(deps)}  | usedBy: ${list(r.usedBy)}${bins.length ? `  | bins: ${list(bins)}` : ""}${feats.length ? `  | features: ${list(feats, 6)}` : ""}  | ${r.externalDependencies} outside deps`;
  });
  return { root: w.root, members: w.members, targetDir: w.target, crates: lines.slice(0, max), ...(lines.length > max ? { cut: lines.length - max } : {}) };
}
