// A client for a Rust workspace through `cargo`: compiler and clippy diagnostics, test results,
// the workspace's crates and their dependencies, why a crate is in the tree, what is outdated and
// where build time goes. cargo's own machine output is parsed here (`--message-format=json`,
// `cargo metadata`, libtest and nextest results), so a build or test run that prints thousands of
// lines comes back as the few rows that matter.
//
// Three checks. A call that changes the repository (fmt, fix, clippy --fix, add, remove, update, run,
// clean) needs `act`; answers go to a cloud model, so output never carries a credential (URL
// passwords and token-like assignments are masked; publishing, login and `cargo config` are
// refused); and every run has a timeout and no terminal, because a run that waits never ends here.
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const deny = (why) => {
  throw new Error(`not allowed: ${why}`);
};
const notInThisAsk = (what) => {
  throw new Error(`not in this ask: ${what} changes things, and the caller did not ask for a change (act: true), so nothing was done. Answer what you can, and say that this needs \`ask\` with act: true. Do not look for another way to do it.`);
};

// Subcommands that only read the sources. build, test and check write into the target folder only.
const READS = new Set([
  "check", "c", "build", "b", "test", "t", "clippy", "doc", "d", "bench", "metadata", "tree", "locate-project", "pkgid", "verify-project",
  "read-manifest", "search", "info", "version", "help", "report", "package", "audit", "deny", "outdated", "expand", "bloat", "llvm-lines",
  "semver-checks", "geiger", "machete", "nextest",
]);
// Never run, with or without act: they publish, store credentials or print them.
const NEVER = new Set(["publish", "login", "logout", "owner", "yank", "install", "uninstall", "config", "credential"]);
const GLOBAL_VALUE = new Set(["-C", "--config", "-Z", "--color"]);
const SECRET_FLAG = /^--(token|registry-token|index-token)\b/;

const flag = (rest, ...names) => rest.some((x) => names.some((n) => x === n || x.startsWith(n + "=")));

function split(a) {
  let i = 0;
  for (; i < a.length; i++) {
    if (GLOBAL_VALUE.has(a[i])) i++;
    else if (!a[i].startsWith("-") && !a[i].startsWith("+")) break;
  }
  return { globals: a.slice(0, i), sub: a[i] ?? "", rest: a.slice(i + 1) };
}

/** Does `cargo <sub> <rest>` change the repository? */
function changes(sub, rest) {
  const own = rest.includes("--") ? rest.slice(0, rest.indexOf("--")) : rest;
  const pos = own.filter((x) => !x.startsWith("-"));
  switch (sub) {
    case "fmt":
      return !flag(rest, "--check");
    case "update":
      return !flag(own, "--dry-run", "-n");
    case "clippy":
      return flag(own, "--fix");
    case "nextest":
      return !["run", "r", "list", "show-config"].includes(pos[0]);
    case "audit":
      return pos[0] === "fix";
    case "machete":
      return flag(own, "--fix");
    case "deny":
      return pos.includes("fix");
    default:
      return !READS.has(sub);
  }
}

function check(args, act) {
  const a = args.map(String);
  const { globals, sub, rest } = split(a);
  if (!sub) deny("no cargo subcommand");
  if (NEVER.has(sub)) deny(`cargo ${sub} publishes, stores credentials or can print them`);
  if (a.some((x) => SECRET_FLAG.test(x))) deny("a token on the command line");
  const changing = changes(sub, rest);
  if (!act) {
    if (changing) notInThisAsk(`cargo ${[sub, ...rest].join(" ").slice(0, 80)}`);
    const own = a.includes("--") ? a.slice(0, a.indexOf("--")) : a;
    if (globals.some((g) => g === "--config" || g === "-Z" || g === "-C") || flag(own, "--config", "-Z")) notInThisAsk("cargo --config, -Z or -C (they can set a program to run)");
  }
  return { a, sub, rest, changing };
}

// URL passwords and token-like assignments never reach the model.
const mask = (s) =>
  String(s ?? "")
    .replace(/(\b[a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+(?::[^\s/@]*)?@/gi, "$1***@")
    .replace(/(authorization:\s*)(bearer|basic)\s+\S+/gi, "$1$2 ***")
    .replace(/\b([A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY)[A-Z0-9_]*)=\S+/g, "$1=***");

const ENV = {
  CARGO_TERM_COLOR: "never", CARGO_TERM_PROGRESS_WHEN: "never", NO_COLOR: "1", GIT_TERMINAL_PROMPT: "0", GIT_ASKPASS: "true",
  NEXTEST_EXPERIMENTAL_LIBTEST_JSON: "1", RUST_LOG: "", CARGO_TERM_QUIET: "false",
};
const MAX_OUT = 256 << 20;

const running = new Set();
process.on("exit", () => {
  for (const pid of running) {
    try { process.kill(-pid, "SIGTERM"); } catch {}
  }
});

/** Run cargo with no shell and no terminal; the whole process group is killed at the timeout, and when this process exits. */
function exec(args, { cwd, timeoutMs, env = {} }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const out = [];
    const err = [];
    let outSize = 0;
    let truncated = false;
    let timedOut = false;
    const child = spawn("cargo", args, { cwd, env: { ...process.env, ...ENV, ...env }, stdio: ["ignore", "pipe", "pipe"], detached: true });
    running.add(child.pid);
    const kill = (sig) => {
      try {
        process.kill(-child.pid, sig);
      } catch {
        try { child.kill(sig); } catch {}
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill("SIGTERM");
      setTimeout(() => kill("SIGKILL"), 5000).unref();
    }, timeoutMs);
    child.stdout.on("data", (d) => {
      if (outSize > MAX_OUT) return void (truncated = true);
      outSize += d.length;
      out.push(d);
    });
    child.stderr.on("data", (d) => {
      if (err.reduce((n, x) => n + x.length, 0) < 32 << 20) err.push(d);
    });
    const done = (code, extra = {}) => {
      clearTimeout(timer);
      running.delete(child.pid);
      resolve({ code, out: Buffer.concat(out).toString("utf8"), err: Buffer.concat(err).toString("utf8"), ms: Date.now() - started, ...(timedOut ? { timedOut: true } : {}), ...(truncated ? { truncated: true } : {}), ...extra });
    };
    child.on("error", (e) => (e.code === "ENOENT" ? done(127, { err: "cargo is not installed" }) : done(1, { err: String(e) })));
    child.on("close", (code, sig) => done(code ?? (sig ? 128 : 1)));
  });
}

export function make({ settings, push, cwd, act }) {
  const start = cwd || process.cwd();
  const timeout = Number(settings?.CARGO_TIMEOUT_SECONDS) > 0 ? Number(settings.CARGO_TIMEOUT_SECONDS) : 600;
  return makeCargo({ cwd: start, push, act: !!act, timeoutSeconds: timeout });
}

// ---- parsing ----

/** The crate name in a cargo package id: `path+file:///x/crates/a#a-b@0.1.0`, `registry+...#serde@1.0.0`, or the old `name 0.1.0 (path+...)`. */
export function packageName(id) {
  const s = String(id ?? "");
  const h = s.indexOf("#");
  if (h >= 0) {
    const frag = s.slice(h + 1);
    const at = frag.indexOf("@");
    if (at > 0) return frag.slice(0, at);
    return path.basename(s.slice(0, h).replace(/\/$/, ""));
  }
  return s.split(" ")[0];
}
const packageVersion = (id) => {
  const s = String(id ?? "");
  const h = s.indexOf("#");
  if (h >= 0) {
    const frag = s.slice(h + 1);
    const at = frag.indexOf("@");
    return at > 0 ? frag.slice(at + 1) : frag;
  }
  return s.split(" ")[1] ?? null;
};

const clip = (s, n) => (s && s.length > n ? s.slice(0, n - 1) + "…" : s);
const SUMMARY = /^(aborting due to|\d+ warnings? emitted|build failed|could not compile|.* generated \d+ warnings?|\d+ previous errors?)/;

function lintNotes(children) {
  const help = [];
  for (const c of children ?? []) {
    if (c.level !== "help" && c.level !== "note") continue;
    const m = c.message ?? "";
    if (/^`#\[(warn|deny|allow|forbid)\(/.test(m) || /^for further information visit/.test(m) || /^`-[DWAF] /.test(m) || /^requested on the command line/.test(m)) continue;
    help.push(clip(m, 220));
  }
  return help.slice(0, 3);
}

/** One compiler-message -> a row, or null for summary lines. */
function toDiag(msg, root) {
  const d = msg.message;
  if (!d || !["error", "warning", "error: internal compiler error"].includes(d.level)) return null;
  const code = d.code?.code ?? null;
  if (!code && SUMMARY.test(d.message ?? "")) return null;
  const spans = d.spans ?? [];
  const primary = spans.find((s) => s.is_primary) ?? spans[0];
  const rel = (f) => (f && path.isAbsolute(f) && root && f.startsWith(root + path.sep) ? f.slice(root.length + 1) : f);
  const fix = [];
  const take = (s, say) => {
    if (s.suggested_replacement != null) fix.push({ say: clip(say, 200), file: rel(s.file_name), line: s.line_start, replace: clip(s.suggested_replacement, 200), applicability: s.suggestion_applicability });
  };
  for (const s of spans) take(s, d.message);
  for (const c of d.children ?? []) for (const s of c.spans ?? []) take(s, c.message);
  const seen = new Set();
  const fixes = fix.filter((f) => !seen.has(JSON.stringify(f)) && seen.add(JSON.stringify(f))).slice(0, 3);
  const help = lintNotes(d.children).filter((h) => !fixes.some((f) => f.say.startsWith(h.slice(0, 40))));
  return {
    package: packageName(msg.package_id),
    level: d.level.startsWith("error") ? "error" : "warning",
    code,
    message: clip(d.message, 400),
    file: primary ? rel(primary.file_name) : null,
    line: primary?.line_start ?? null,
    col: primary?.column_start ?? null,
    label: clip(primary?.label ?? null, 200),
    source: clip(primary?.text?.[0]?.text?.trim() ?? null, 200),
    ...(help.length ? { help } : {}),
    ...(fixes.length ? { fix: fixes } : {}),
  };
}

/** Parse cargo's JSON message stream out of stdout lines. Returns the diagnostics (deduplicated) and the lines that were not JSON. */
export function parseMessages(stdout, root) {
  const diags = new Map();
  const rest = [];
  for (const line of stdout.split("\n")) {
    if (line.startsWith("{") && line.includes('"reason"')) {
      let j;
      try { j = JSON.parse(line); } catch { rest.push(line); continue; }
      if (j.reason !== "compiler-message") continue;
      const dg = toDiag(j, root);
      if (!dg) continue;
      const key = [dg.package, dg.level, dg.code, dg.message, dg.file, dg.line, dg.col].join("|");
      if (!diags.has(key)) diags.set(key, dg);
    } else if (line) rest.push(line);
  }
  return { diags: [...diags.values()], rest };
}

const NOISE = /^\s*(Compiling|Checking|Fresh|Blocking|Downloaded|Downloading|Updating|Locking|Adding|Documenting|Finished|Running|Doc-tests|Starting|PASS|SLOW|Summary|Fixed)\b/;
const tail = (s, n = 25) => s.split("\n").filter((l) => l.trim() && !NOISE.test(l)).slice(-n).join("\n");

/** Group diagnostics by crate, errors first, with counts. `max` rows are shown across all crates. */
export function summarize(diags, { max = 40 } = {}) {
  const errors = diags.filter((d) => d.level === "error").length;
  const warnings = diags.length - errors;
  const order = [...diags].sort((a, b) => (a.level === b.level ? 0 : a.level === "error" ? -1 : 1) || (a.file ?? "").localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0));
  const shown = order.slice(0, max);
  const byPkg = new Map();
  for (const d of diags) {
    const p = byPkg.get(d.package) ?? { package: d.package, errors: 0, warnings: 0, diagnostics: [] };
    p[d.level === "error" ? "errors" : "warnings"]++;
    byPkg.set(d.package, p);
  }
  for (const d of shown) {
    const { package: _p, ...row } = d;
    byPkg.get(d.package).diagnostics.push(row);
  }
  const codes = new Map();
  for (const d of diags) {
    const k = `${d.level} ${d.code ?? "(no code)"}`;
    const c = codes.get(k) ?? { level: d.level, code: d.code ?? null, count: 0, first: `${d.file}:${d.line}`, message: d.message };
    c.count++;
    codes.set(k, c);
  }
  return {
    errors,
    warnings,
    packages: [...byPkg.values()].sort((a, b) => b.errors - a.errors || b.warnings - a.warnings),
    byCode: [...codes.values()].sort((a, b) => b.count - a.count).slice(0, 15),
    shown: shown.length,
    cut: Math.max(0, diags.length - shown.length),
  };
}

/** `thread 'x' panicked at file:line:col:\nmessage` (new and old formats) -> {file, line, col, message, output}. */
export function panicInfo(text) {
  const lines = String(text ?? "").replace(/\r/g, "").split("\n");
  let i = lines.findIndex((l) => /panicked at /.test(l));
  if (i < 0) {
    return { message: clip(lines.filter((l) => l.trim()).slice(-12).join("\n"), 1200), output: null };
  }
  const head = lines[i];
  let file = null, line = null, col = null, message = [];
  let m = head.match(/panicked at (.+?):(\d+):(\d+):?\s*$/);
  if (m) {
    [file, line, col] = [m[1], +m[2], +m[3]];
    for (let k = i + 1; k < lines.length; k++) {
      if (/^note: run with `RUST_BACKTRACE|^stack backtrace:/.test(lines[k])) break;
      message.push(lines[k]);
    }
  } else if ((m = head.match(/panicked at '(.*)', (.+?):(\d+):(\d+)/))) {
    [message, file, line, col] = [[m[1]], m[2], +m[3], +m[4]];
  }
  const before = lines.slice(0, i).filter((l) => l.trim());
  while (before.length && /^thread '/.test(before[before.length - 1])) before.pop();
  const msg = message.join("\n").trim();
  return { file, line, col, message: clip(msg, 1200), output: before.length ? clip(before.slice(-8).join("\n"), 600) : null };
}

/** libtest's plain output: counts per test binary, and each failure with its panic. `headers` are the `Running ...` lines from stderr, in order. */
export function parseLibtest(stdout, headers = []) {
  const blocks = [];
  let cur = null;
  const details = new Map();
  let detail = null;
  const flush = () => {
    if (detail) details.set(detail.name, detail.lines.join("\n"));
    detail = null;
  };
  for (const raw of stdout.split("\n")) {
    const l = raw.replace(/\r$/, "");
    let m;
    if ((m = l.match(/^running (\d+) tests?$/))) {
      flush();
      cur = { tests: [], result: null };
      blocks.push(cur);
    } else if ((m = l.match(/^---- (.+) stdout ----$/))) {
      flush();
      detail = { name: m[1], lines: [], block: cur };
    } else if ((m = l.match(/^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out/))) {
      flush();
      if (cur) cur.result = { status: m[1], passed: +m[2], failed: +m[3], ignored: +m[4], measured: +m[5], filtered: +m[6] };
    } else if (/^failures:$/.test(l)) {
      flush();
    } else if (detail) detail.lines.push(l);
    else if ((m = l.match(/^test (.+?) \.\.\. (ok|FAILED|ignored)(?:, (.*))?$/)) && cur) cur.tests.push({ name: m[1], status: m[2], reason: m[3] });
  }
  flush();
  const paired = headers.length === blocks.length;
  const failures = [];
  const binaries = blocks.map((b, i) => {
    const h = paired ? headers[i] : null;
    const label = h ? h.label : "?";
    for (const t of b.tests.filter((x) => x.status === "FAILED")) failures.push({ test: t.name, binary: label, ...panicInfo(details.get(t.name) ?? "") });
    return { binary: label, ...(b.result ?? { status: "no result line (the binary crashed or was killed)" }), ignoredTests: b.tests.filter((x) => x.status === "ignored").map((x) => (x.reason ? `${x.name} (${x.reason})` : x.name)) };
  });
  return { binaries, failures };
}

/** nextest's `--message-format libtest-json` stream. */
export function parseNextest(stdout) {
  const tests = new Map();
  for (const line of stdout.split("\n")) {
    if (!line.startsWith("{")) continue;
    let j;
    try { j = JSON.parse(line); } catch { continue; }
    if (j.type !== "test" || j.event === "started") continue;
    const name = String(j.name ?? "");
    const d = name.indexOf("$");
    const id = d >= 0 ? name.slice(0, d) : "";
    tests.set(name, { name: d >= 0 ? name.slice(d + 1) : name, crate: id.split("::")[0] || null, binary: id, status: j.event, seconds: j.exec_time ?? null, stdout: j.stdout });
  }
  return [...tests.values()];
}

/** One diagnostic as one line: `error[E0308] path:line:col message: label | source | fix: say -> replacement (applicability)`. */
export function formatDiagnostic(d) {
  const head = `${d.level}${d.code ? `[${d.code}]` : ""} ${d.file ?? "?"}:${d.line ?? "?"}:${d.col ?? "?"} ${d.message}${d.label ? `: ${d.label}` : ""}`;
  const parts = [head];
  if (d.source) parts.push(`src: ${d.source}`);
  const f = d.fix?.[0];
  if (f) parts.push(`fix: ${clip(f.say, 90)} -> ${JSON.stringify(clip(f.replace, 80))} (${f.applicability})`);
  else if (d.help?.length) parts.push(`help: ${clip(d.help[0], 140)}`);
  return clip(parts.join(" | "), 420);
}

/** One failing test as one object with short fields. */
export function formatFailure(f) {
  return {
    test: f.test,
    binary: f.binary,
    at: f.file ? `${f.file}:${f.line}:${f.col}` : null,
    message: clip(f.message, 450),
    ...(f.output ? { printed: clip(f.output.split("\n").slice(-3).join(" / "), 160) } : {}),
    ...(f.status ? { status: f.status } : {}),
  };
}

export function makeCargo({ cwd, push = () => {}, act = false, timeoutSeconds = 600 }) {
  let manifest = null;
  let root = cwd;
  try {
    manifest = execFileSync("cargo", ["locate-project", "--workspace", "--message-format", "plain"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 30_000, env: { ...process.env, ...ENV } }).trim();
    root = path.dirname(manifest);
  } catch {}
  const hasLock = () => fs.existsSync(path.join(root, "Cargo.lock"));
  const locked = () => (hasLock() ? ["--locked"] : []);

  // Environment variables the investigator sets for later runs (SQLX_OFFLINE=true, a test database URL). Variables that can run a program need act.
  const extraEnv = {};
  const RISKY_ENV = /^(LD_|DYLD_|RUSTC_WRAPPER|RUSTC_WORKSPACE_WRAPPER|RUSTFLAGS|CARGO_ENCODED_RUSTFLAGS|CARGO_BUILD_RUSTC|CARGO_TARGET_.*_(RUNNER|LINKER)|PATH$|HOME$)/;
  const envNow = () => {
    for (const k of Object.keys(extraEnv)) if (!act && RISKY_ENV.test(k)) notInThisAsk(`setting ${k} (it can change which program cargo runs)`);
    return { ...extraEnv };
  };
  const run = async (...args) => {
    const { a } = check(args, act);
    const r = await exec(a, { cwd, timeoutMs: timeoutSeconds * 1000, env: envNow() });
    push({ kind: "cargo", detail: `cargo ${a.join(" ")}`.slice(0, 200), ms: r.ms, code: r.code, size: r.out.length });
    return { ...r, out: mask(r.out), err: mask(r.err) };
  };
  const runFor = async (seconds, args, env) => {
    const { a } = check(args, act);
    const r = await exec(a, { cwd, timeoutMs: (seconds ?? timeoutSeconds) * 1000, env: { ...envNow(), ...env } });
    push({ kind: "cargo", detail: `cargo ${a.join(" ")}`.slice(0, 200), ms: r.ms, code: r.code, size: r.out.length });
    return { ...r, out: mask(r.out), err: mask(r.err) };
  };
  const text = async (...args) => {
    const r = await run(...args);
    if (r.code !== 0) throw new Error(`cargo ${args.slice(0, 3).join(" ")}: ${tail(r.err || r.out, 8).slice(0, 800)}`);
    return r.out.replace(/\n+$/, "");
  };

  const scope = (o) => {
    const a = [];
    if (o.package) for (const p of [].concat(o.package)) a.push("-p", p);
    else a.push("--workspace");
    for (const p of [].concat(o.exclude ?? [])) a.push("--exclude", p);
    if (o.allFeatures) a.push("--all-features");
    if (o.noDefaultFeatures) a.push("--no-default-features");
    if (o.features) a.push("--features", [].concat(o.features).join(","));
    if (o.release) a.push("--release");
    return a;
  };

  const metadata = async (o = {}) => {
    const r = await run("metadata", "--format-version", "1", ...(o.noDeps ? ["--no-deps"] : []), ...locked());
    if (r.code !== 0) throw new Error(`cargo metadata failed: ${tail(r.err, 6)}`);
    return JSON.parse(r.out);
  };

  const api = {
    cwd,
    root,
    manifest,
    act,
    env: extraEnv,
    format: { diagnostic: formatDiagnostic, failure: formatFailure },
    run,
    text,
    at(dir) {
      const p = path.resolve(cwd, String(dir).replace(/^~(?=\/|$)/, process.env.HOME ?? "~"));
      if (!fs.existsSync(p)) throw new Error(`no such folder: ${p}`);
      return makeCargo({ cwd: p, push, act, timeoutSeconds });
    },
    metadata,

    async check(o = {}) {
      const clippy = !!o.clippy;
      const args = [clippy ? "clippy" : "check", "--message-format=json", ...scope(o), ...(o.allTargets === false ? [] : ["--all-targets"]), ...locked(), ...(o.extra ?? [])];
      const r = await runFor(o.timeoutSeconds, args);
      const { diags } = parseMessages(r.out, root);
      const s = summarize(diags, { max: o.max ?? 40 });
      const failed = r.code !== 0;
      return {
        ok: !failed && s.errors === 0,
        command: `cargo ${args.join(" ")}`,
        seconds: Math.round(r.ms / 100) / 10,
        exitCode: r.code,
        ...(r.timedOut ? { timedOut: true } : {}),
        ...s,
        ...(failed && s.errors === 0 ? { buildError: tail(r.err, 25) } : {}),
      };
    },

    async test(o = {}) {
      let runner = o.runner ?? "auto";
      if (runner === "auto") {
        const nx = fs.existsSync(path.join(root, ".config", "nextest.toml")) && (await exec(["nextest", "--version"], { cwd, timeoutMs: 20_000 })).code === 0;
        runner = nx ? "nextest" : "libtest";
      }
      const filter = o.filter ? [].concat(o.filter) : [];
      let args;
      if (runner === "nextest") {
        args = ["nextest", "run", "--no-fail-fast", "--message-format", "libtest-json", ...scope(o), ...(o.profile ? ["--profile", o.profile] : []), ...(o.expr ? ["-E", o.expr] : []), ...(o.ignored ? ["--run-ignored", "only"] : []), ...locked(), ...(o.extra ?? []), ...filter];
      } else {
        args = ["test", "--no-fail-fast", "--message-format=json", ...scope(o), ...locked(), ...(o.extra ?? []), ...filter, ...(o.ignored ? ["--", "--ignored"] : [])];
      }
      const r = await runFor(o.timeoutSeconds, args);
      const res = {
        command: `cargo ${args.join(" ")}`,
        runner,
        seconds: Math.round(r.ms / 100) / 10,
        exitCode: r.code,
        ...(r.timedOut ? { timedOut: true, note: "the run hit its timeout; tests that had not finished are not counted. Narrow with package or filter, or pass timeoutSeconds." } : {}),
      };
      let passed = 0, failed = 0, ignored = 0, failures = [], binaries;
      let compileDiags = [];
      if (runner === "nextest") {
        const tests = parseNextest(r.out);
        passed = tests.filter((t) => t.status === "ok").length;
        ignored = tests.filter((t) => t.status === "ignored").length;
        const bad = tests.filter((t) => t.status === "failed" || t.status === "timeout" || t.status === "leaky");
        failed = bad.length;
        failures = bad.map((t) => ({ test: t.name, binary: t.binary, status: t.status === "failed" ? undefined : t.status, seconds: t.seconds != null ? Math.round(t.seconds * 1000) / 1000 : null, ...panicInfo(t.stdout) }));
        const sk = r.err.match(/(\d+) skipped/);
        res.skipped = sk ? +sk[1] : 0;
        const slow = tests.filter((t) => t.seconds > 5).sort((a, b) => b.seconds - a.seconds).slice(0, 5).map((t) => `${t.binary} ${t.name} ${t.seconds.toFixed(1)}s`);
        if (slow.length) res.slowest = slow;
        res.note = "nextest does not run doc tests; use runner: \"libtest\" with extra: [\"--doc\"] for those";
        if (!tests.length && r.code !== 0) {
          // The build failed before any test ran: get the compiler's diagnostics as rows.
          const c = await api.check({ package: o.package, exclude: o.exclude, features: o.features, allFeatures: o.allFeatures, noDefaultFeatures: o.noDefaultFeatures, max: o.max ?? 25 });
          if (c.errors) res.compile = { errors: c.errors, packages: c.packages, shown: c.shown, cut: c.cut };
          else res.buildError = tail(r.err, 25);
        }
      } else {
        const { diags, rest } = parseMessages(r.out, root);
        compileDiags = diags.filter((d) => d.level === "error");
        const headers = r.err.split("\n").map((l) => l.match(/^\s+Running (.+?) \((.+?)\)\s*$/) ?? l.match(/^\s+(Doc-tests) (\S+)\s*$/)).filter(Boolean).map((m) => ({ label: m[1] === "Doc-tests" ? `doc-tests ${m[2]}` : `${m[2].split("/").pop().replace(/-[0-9a-f]{8,}$/, "")} (${m[1]})` }));
        const p = parseLibtest(rest.join("\n"), headers);
        for (const b of p.binaries) {
          passed += b.passed ?? 0;
          failed += b.failed ?? 0;
          ignored += b.ignored ?? 0;
        }
        failures = p.failures;
        binaries = p.binaries.filter((b) => b.failed || b.status !== "ok" || b.passed).map(({ ignoredTests, ...b }) => b);
        const ig = p.binaries.flatMap((b) => b.ignoredTests ?? []);
        if (ig.length) res.ignoredTests = ig.slice(0, 20);
        if (compileDiags.length) res.compile = summarize(compileDiags, { max: o.max ?? 25 });
        else if (r.code !== 0 && !p.binaries.length) res.buildError = tail(r.err, 25);
        const hung = r.err.split("\n").filter((l) => /has been running for over/.test(l)).slice(0, 5);
        if (hung.length) res.slowTests = hung.map((l) => l.trim());
        const crashed = r.err.split("\n").filter((l) => /process didn't exit successfully|SIGSEGV|SIGABRT|signal: \d+/.test(l)).slice(0, 3);
        if (crashed.length) res.crashed = crashed.map((l) => l.trim());
      }
      const maxF = o.maxFailures ?? 15;
      if (!passed && !failed && !ignored && r.code === 0 && !r.timedOut) res.note = [res.note, "no test ran: nothing matched the filter or package"].filter(Boolean).join("; ");
      return {
        ok: r.code === 0 && failed === 0,
        ...res,
        passed,
        failed,
        ignored,
        ...(binaries && binaries.length <= 12 ? { binaries } : {}),
        failures: failures.slice(0, maxF),
        ...(failures.length > maxF ? { failuresCut: failures.length - maxF } : {}),
      };
    },

    /** Crates, their paths, targets, features and workspace-internal dependencies. */
    async workspace() {
      const md = await metadata({ noDeps: true });
      const members = md.packages;
      const names = new Set(members.map((p) => p.name));
      const rel = (p) => (p.startsWith(root + path.sep) ? p.slice(root.length + 1) : p);
      const rows = members.map((p) => {
        const byName = new Map();
        let external = 0;
        for (const d of p.dependencies) {
          if (d.path && names.has(d.name) && d.name !== p.name) {
            const e = byName.get(d.name) ?? { crate: d.name, kinds: [], optional: true };
            const k = d.kind ?? "normal";
            if (!e.kinds.includes(k)) e.kinds.push(k);
            e.optional = e.optional && !!d.optional;
            byName.set(d.name, e);
          } else external++;
        }
        const dependsOn = [...byName.values()].map((e) => ({ crate: e.crate, kinds: e.kinds, ...(e.optional ? { optional: true } : {}) }));
        return {
          name: p.name,
          version: p.version,
          path: rel(path.dirname(p.manifest_path)) || ".",
          edition: p.edition,
          rustVersion: p.rust_version,
          publish: p.publish === null ? true : (p.publish?.length ?? 0) > 0,
          targets: p.targets.map((t) => ({ kind: t.kind.join("/"), name: t.name, path: rel(t.src_path) })).filter((t) => !/custom-build/.test(t.kind)),
          features: p.features,
          dependsOn,
          externalDependencies: external,
        };
      });
      const usedBy = {};
      for (const r of rows) for (const d of r.dependsOn) (usedBy[d.crate] ??= []).push(r.name);
      for (const r of rows) r.usedBy = usedBy[r.name] ?? [];
      // Depth (dev-dependencies do not count): 0 for a crate that depends on no other member; each crate sits one deeper than its deepest member dependency.
      const depth = {};
      const level = (n, seen = new Set()) => {
        if (depth[n] != null) return depth[n];
        if (seen.has(n)) return 0;
        seen.add(n);
        const r = rows.find((x) => x.name === n);
        const real = r.dependsOn.filter((d) => d.kinds.some((k) => k !== "dev"));
        return (depth[n] = real.length ? 1 + Math.max(...real.map((d) => level(d.crate, seen))) : 0);
      };
      for (const r of rows) r.depth = level(r.name);
      return { root, members: rows.length, target: md.target_directory, crates: rows.sort((a, b) => a.depth - b.depth || a.name.localeCompare(b.name)) };
    },

    /** Why a crate is in the dependency tree, in which versions, through which paths, with which features. */
    async why(name, o = {}) {
      const md = await metadata();
      const pkgs = new Map(md.packages.map((p) => [p.id, p]));
      const nodes = new Map(md.resolve.nodes.map((n) => [n.id, n]));
      const members = new Set(md.workspace_members);
      const label = (id) => {
        const p = pkgs.get(id);
        return p ? `${p.name} ${p.version}` : packageName(id);
      };
      const matches = md.packages.filter((p) => p.name === name && (!o.version || p.version === o.version || p.version.startsWith(o.version)));
      if (!matches.length) {
        const like = [...new Set(md.packages.filter((p) => p.name.includes(name) || name.includes(p.name)).map((p) => p.name))].slice(0, 10);
        return { crate: name, found: false, note: "no package of that name in the resolved tree (for any platform, with every feature the workspace resolves)", similar: like };
      }
      // parents[id] = [{from, kinds}] over resolve edges.
      const parents = new Map();
      for (const n of md.resolve.nodes) {
        for (const d of n.deps) {
          const kinds = new Set((d.dep_kinds ?? [{ kind: null }]).map((k) => k.kind ?? "normal"));
          if (!parents.has(d.pkg)) parents.set(d.pkg, []);
          parents.get(d.pkg).push({ from: n.id, kinds });
        }
      }
      const reach = (id, allowed) => {
        const found = new Set();
        const seen = new Set([id]);
        const q = [id];
        while (q.length) {
          const x = q.shift();
          if (members.has(x)) found.add(x);
          for (const e of parents.get(x) ?? []) {
            if (seen.has(e.from) || ![...e.kinds].some((k) => allowed.includes(k))) continue;
            seen.add(e.from);
            q.push(e.from);
          }
        }
        return found;
      };
      const maxPaths = o.paths ?? 4;
      const versions = matches.map((p) => {
        const id = p.id;
        const normal = reach(id, ["normal"]);
        const withBuild = reach(id, ["normal", "build"]);
        const all = reach(id, ["normal", "build", "dev"]);
        const by = (set) => [...set].map(label).sort();
        // Shortest paths from a workspace member, by walking the parents breadth first.
        const paths = [];
        const q = [[id]];
        const seenPaths = new Set();
        while (q.length && paths.length < maxPaths) {
          const chain = q.shift();
          const head = chain[chain.length - 1];
          if (members.has(head) && chain.length > 1) {
            paths.push(chain.slice().reverse().map(label).join(" -> "));
            continue;
          }
          for (const e of parents.get(head) ?? []) {
            if (chain.includes(e.from)) continue;
            const key = chain.length + ":" + e.from + ">" + head;
            if (seenPaths.has(key) && chain.length > 6) continue;
            seenPaths.add(key);
            if (chain.length < 12) q.push([...chain, e.from]);
          }
        }
        const direct = (parents.get(id) ?? []).map((e) => {
          const from = pkgs.get(e.from);
          const decl = from?.dependencies.find((d) => d.name === p.name);
          return { by: label(e.from), member: members.has(e.from) || undefined, kinds: [...e.kinds], ...(decl ? { req: decl.req, features: decl.features?.length ? decl.features : undefined, optional: decl.optional || undefined } : {}) };
        });
        return {
          version: p.version,
          source: p.source ? p.source.replace(/^registry\+.*crates\.io.*$/, "crates.io").replace(/^git\+/, "git ") : "path (in the workspace)",
          workspaceMember: members.has(id) || undefined,
          featuresOn: nodes.get(id)?.features ?? [],
          directDependents: direct.slice(0, 15),
          ...(direct.length > 15 ? { directDependentsCut: direct.length - 15 } : {}),
          shortestPaths: paths,
          reachedByMembers: { normal: by(normal), onlyWithBuildScripts: by(new Set([...withBuild].filter((x) => !normal.has(x)))), onlyInTests: by(new Set([...all].filter((x) => !withBuild.has(x)))) },
        };
      });
      return { crate: name, found: true, versionCount: versions.length, note: "resolved for every platform and with every feature the workspace enables; `cargo tree` shows the host platform only", versions };
    },

    /** Direct dependencies and what is newer. Needs the registry index (network). */
    async outdated(o = {}) {
      const md = await metadata();
      const direct = new Map();
      const idOf = new Map(md.packages.map((p) => [p.id, p]));
      for (const id of md.workspace_members) {
        for (const d of idOf.get(id).dependencies) {
          if (d.path) continue;
          const e = direct.get(d.name) ?? { name: d.name, users: new Set() };
          e.users.add(`${idOf.get(id).name} (${d.req}${d.kind ? `, ${d.kind}` : ""})`);
          direct.set(d.name, e);
        }
      }
      const r = await runFor(o.timeoutSeconds, ["update", "--dry-run", "--verbose", ...(o.package ? ["-p", o.package] : [])]);
      if (r.code !== 0) return { ok: false, error: tail(r.err, 8), note: "cargo update --dry-run needs the registry index; check the network" };
      const compatible = [];
      const behind = [];
      for (const l of r.err.split("\n")) {
        let m;
        if ((m = l.match(/^\s*(Updating|Adding|Removing|Downgrading)\s+(\S+) v(\S+)(?: -> v(\S+))?(?: \(available: v(\S+)\))?/))) {
          compatible.push({ action: m[1], name: m[2], from: m[1] === "Adding" ? null : m[3], to: m[4] ?? (m[1] === "Adding" ? m[3] : null), ...(m[5] ? { latest: m[5] } : {}) });
        } else if ((m = l.match(/^\s*Unchanged\s+(\S+) v(\S+) \(available: v(\S+)\)/))) behind.push({ name: m[1], locked: m[2], latest: m[3] });
      }
      // A requirement such as ^0.4 or 1.2 sits on the same release line as a locked 0.4.8 or 1.2.9 when its leading components match (0.x: major and minor; otherwise the major).
      const sameLine = (req, locked) => {
        const r = req.replace(/^[\^~=<>\s]+/, "").split(".");
        const l = locked.split(".");
        const n = l[0] === "0" ? 2 : 1;
        return r.slice(0, n).every((p, i) => p === "*" || p === l[i]);
      };
      const mark = (x) => {
        const e = direct.get(x.name);
        if (!e) return x;
        const all = [...e.users];
        const on = x.locked ? all.filter((u) => sameLine(u.slice(u.indexOf("(") + 1).split(/[,)]/)[0], x.locked)) : all;
        return { ...x, direct: true, usedBy: (on.length ? on : all).slice(0, 6) };
      };
      const cmp = compatible.map(mark);
      const bhd = behind.map(mark);
      const keep = (rows) => (o.all ? rows : rows.filter((x) => x.direct));
      const c = keep(cmp);
      const b = keep(bhd);
      return {
        ok: true,
        directDependencies: direct.size,
        compatibleUpdates: c.slice(0, 60),
        compatibleUpdatesTotal: cmp.length,
        newerMajorOrIncompatible: b.slice(0, 60),
        newerMajorOrIncompatibleTotal: bhd.length,
        note: o.all ? "every crate in the tree" : "direct dependencies only; pass all: true for the whole tree. compatibleUpdates would be applied by `cargo update`; newerMajorOrIncompatible need a change to the version requirement",
      };
    },

    /** Build or check timing from `cargo build --timings`. fresh: true builds into a new empty target folder, so every crate is compiled. */
    async timings(o = {}) {
      const tmp = o.fresh ? fs.mkdtempSync(path.join(os.tmpdir(), "ask-kit-rust-timings-")) : null;
      try {
        const args = [o.check ? "check" : "build", "--timings", ...scope(o), ...(o.allTargets ? ["--all-targets"] : []), ...locked(), ...(o.extra ?? [])];
        const md = tmp ? null : await metadata({ noDeps: true });
        const r = await runFor(o.timeoutSeconds, args, tmp ? { CARGO_TARGET_DIR: tmp } : {});
        const m = r.err.match(/Timing report saved to (\S+\.html)/);
        const res = { ok: r.code === 0, command: `cargo ${args.join(" ")}${tmp ? " (new empty target folder)" : ""}`, wallSeconds: Math.round(r.ms / 100) / 10, ...(r.timedOut ? { timedOut: true } : {}) };
        if (r.code !== 0) res.buildError = tail(r.err, 15);
        const file = m?.[1] ?? path.join(tmp ?? md.target_directory, "cargo-timings", "cargo-timing.html");
        if (!fs.existsSync(file)) return { ...res, error: "no timing report was written" };
        const html = fs.readFileSync(file, "utf8");
        const mm = html.match(/const UNIT_DATA = (\[[\s\S]*?\n\]);/);
        if (!mm) return { ...res, error: "the timing report has no unit data" };
        const units = JSON.parse(mm[1]);
        const sum = units.reduce((n, u) => n + (u.duration ?? 0), 0);
        const total = Math.max(...units.map((u) => (u.start ?? 0) + (u.duration ?? 0)), 0);
        const memberNames = new Set((md ?? (await metadata({ noDeps: true }))).packages.map((p) => p.name));
        const row = (u) => ({ crate: u.name, version: u.version, what: u.target?.trim() || "compile", seconds: Math.round(u.duration * 100) / 100, startedAt: Math.round(u.start * 100) / 100, ...(u.rmeta_time ? { metadataReadyAfter: Math.round(u.rmeta_time * 100) / 100 } : {}), workspace: memberNames.has(u.name) || undefined });
        const slow = [...units].sort((a, b) => b.duration - a.duration).slice(0, o.top ?? 10).map(row);
        const buildScripts = units.filter((u) => /build script \(run\)/.test(u.target ?? "")).reduce((n, u) => n + u.duration, 0);
        const ws = units.filter((u) => memberNames.has(u.name)).reduce((n, u) => n + u.duration, 0);
        return {
          ...res,
          buildSeconds: Math.round(total * 100) / 100,
          units: units.length,
          cpuSecondsSummed: Math.round(sum * 100) / 100,
          averageParallelism: total ? Math.round((sum / total) * 10) / 10 : null,
          workspaceCratesSeconds: Math.round(ws * 100) / 100,
          buildScriptSeconds: Math.round(buildScripts * 100) / 100,
          slowest: slow,
          ...(sum < 0.5 && !o.fresh ? { note: "almost nothing was compiled: every crate was already built. Pass fresh: true to time a full build in a new empty target folder." } : {}),
          report: o.fresh ? undefined : file,
        };
      } finally {
        if (tmp && tmp.startsWith(path.join(os.tmpdir(), "ask-kit-rust-timings-"))) fs.rmSync(tmp, { recursive: true, force: true });
      }
    },
  };
  return api;
}
