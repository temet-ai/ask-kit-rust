Find why a test fails, decide whether the test or the code is wrong, and fix that one

1. Run only what failed: `const t = await scripts.run("test", { package: "<crate>", filter: "<test name>" })`.
   Without a name, run the crate. `t.failures` has each test's panic `message`, `file:line` and
   `output`. If `t.compile` is set the tests do not build: use `skills.read("compile-error")`.
2. For each failure read the test (`rust.read` around its `file:line`, from the test's `fn` to its
   end), then the code it calls. Read the test's name: `{what}_{condition}_{expected}` names what
   the author meant.
3. Decide which is wrong, and say how you know:
   - the code is wrong when the assertion states the documented or obvious behaviour and the code
     does something else, or the code was changed recently in a way the test did not follow
     (`rust.git("log", "-5", "--format=%h %ad %s", "--date=short", "--", file)`);
   - the test is wrong when it asserts something the requirements no longer say, depends on the
     clock, the order of a hash map, a port, a shared database row or another test's leftovers, or
     was changed in the same commit as the code that now disagrees with it.
   A flaky test fails sometimes: run it three times with `await scripts.run("test", { filter: "<name>" })`
   before calling it flaky, and fix the shared state or the timing that makes it so.
4. Fix the cause. Never weaken an assertion, widen a tolerance, delete the test, add `#[ignore]` or
   catch the panic so the run passes. If the test's expectation must change, change it to the new
   correct value and say why in the answer.
5. A snapshot test: read the snapshot diff before accepting it. Regenerate a snapshot only when
   the new output is what you intended; one crate's tests failing because another crate changed
   is a coupling to fix, not a snapshot to re-record.
6. Run the crate's tests again, and the dependents' tests when you changed a public item
   (`await scripts.run("workspace", { crate: "<crate>" })` gives `usedBy`). Stop when `failed` is 0
   and say how many tests ran.
7. A test that needs a database, a network or an environment variable fails with a connection or
   missing-variable message: say that, with the variable's name, and do not edit the test to skip it.

In the answer: each failing test with the cause in one sentence, the file:line you changed, and the
final counts.
