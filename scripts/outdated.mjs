export const meta = {
  purpose:
    "Which dependencies are behind. Runs `cargo update --dry-run --verbose` (nothing is written) and lists the direct dependencies that a plain `cargo update` would move (compatible updates, from and to), and those with a newer version that their requirement excludes (locked and latest), each with the workspace crates and requirements that use it. Needs the network for the registry index.",
  params: {
    all: "true to list the whole tree, not only direct dependencies",
    package: "limit to one dependency, optional",
    path: "another workspace folder, optional",
    timeoutSeconds: "default 600",
  },
  returns: "{ok, directDependencies, compatibleUpdates:['name from -> to (used by crate (req))'], compatibleUpdatesTotal, newerMajorOrIncompatible:['name locked -> latest (used by crate (req))'], newerMajorOrIncompatibleTotal, note}",
  example: 'await scripts.run("outdated")',
};

export default async function ({ cargo }, { path, ...rest } = {}) {
  const r = await (path ? cargo.at(path) : cargo).outdated(rest);
  if (!r.ok) return r;
  const used = (x) => (x.usedBy ? ` (used by ${x.usedBy.slice(0, 3).join("; ")}${x.usedBy.length > 3 ? "; …" : ""})` : "");
  const cut = (a, n = 25) => (a.length > n ? [...a.slice(0, n), `+${a.length - n} more`] : a);
  return {
    ok: true,
    directDependencies: r.directDependencies,
    compatibleUpdates: cut(r.compatibleUpdates.map((x) => `${x.name} ${x.from ?? "(new)"} -> ${x.to ?? "(removed)"}${used(x)}`)),
    compatibleUpdatesTotal: r.compatibleUpdatesTotal,
    newerMajorOrIncompatible: cut(r.newerMajorOrIncompatible.map((x) => `${x.name} ${x.locked} -> ${x.latest}${used(x)}`)),
    newerMajorOrIncompatibleTotal: r.newerMajorOrIncompatibleTotal,
    note: r.note,
  };
}
