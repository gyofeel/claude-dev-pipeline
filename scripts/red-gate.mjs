#!/usr/bin/env node
/**
 * red-gate — deterministic TDD RED/GREEN gate with an evidence ledger.
 *
 * The one fact a TDD pipeline cannot reconstruct after the fact is "the test failed first".
 * This script records that fact at RED time and looks it up at GREEN time, so "the test
 * failed first" is a ledger query, not an agent's claim.
 *
 * Every verdict comes from the runner's JSON output — never from diff inference.
 * Module-level failures (import error, SyntaxError, top-level side effects) never reach
 * assertionResults; they live only in testResults[].message, so that field is read first
 * when the target is missing.
 *
 * Usage:
 *   node red-gate.mjs --phase red   --plan <plan.md> --task <N> --file <abs test> --test "<it name>" [--project <name>]
 *   node red-gate.mjs --phase green --plan <plan.md> --task <N> --file <abs test> --test "<it name>" [--project <name>]
 *   node red-gate.mjs --phase char  --plan <plan.md> --task <N> --file <abs test> --test "<it name>" [--project <name>]
 *   node red-gate.mjs --phase green --plan <plan.md> --all
 *
 * --plan     required — the ledger is red-evidence.jsonl in the plan's directory (tracked with the plan).
 *            With --task, that Task section (Files: Create · Interfaces Produces · characterization
 *            marker) decides whether the first failure of a new module or export is a legitimate RED.
 * --phase char  only for tasks marked **characterization**: a test that pins current behaviour passes
 *            from the start, so the pre-change GREEN is recorded in place of a RED.
 * --file     must be absolute — runner roots differ; an absolute path is unambiguous.
 * --test     substring of the test's full name (describe titles + it() name); must match one test.
 * --project  optional — the runner project that collects --file; omitted sends no project filter.
 *            In a multi-project runner, omitting it can report the target as skipped.
 * --all      green only: every project, two workers, baseline from unitTest.knownFailuresFile
 *            ({ "failures": ["rel/path.test.js::full name"] }); also emits a ledger audit.
 * --runner-cmd <cmd>   test hook: replaces `npx <runner>`; receives the same argument list.
 *
 * Runner (unitTest.runner: vitest | jest), extra args (unitTest.runnerArgs), test globs and
 * import aliases (source.aliases or tsconfig/jsconfig paths) come from .agents/pipeline.config.json.
 *
 * Output: one JSON object on stdout. Exit code is always 0 — callers read ok / failureClass.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { labelsFor } from '../kit/artifact-labels.mjs';
import { DEFAULTS, loadConfig } from './config-load.mjs';
import { readAliases, resolveAlias } from './lib/source-scan.mjs';

const EN = labelsFor('en');

const BUILTIN_ENV_PATTERNS = [
    /EACCES/,
    /permission denied/i,
    /ENOENT.*node_modules/,
    /Cannot find package/,
    /Failed to load config/i,
    /failed to load config from/,
    /EADDRINUSE/,
    /ENOSPC/,
    /heap out of memory/,
    /ERR_PNPM/
];

const WRONG_REASON_PATTERNS = [
    /^\s*TypeError:/m,
    /^\s*ReferenceError:/m,
    /^\s*SyntaxError:/m,
    /getActivePinia\(\) was called with no active Pinia/,
    /Test timed out in \d+ms/,
    /Hook timed out in \d+ms/,
    /Exceeded timeout of \d+ ?ms/
];

const OK_RED_PATTERNS = [/AssertionError/, /expected .+ to /, /Expected:.*\n.*Received:/s];

// `expect(p).resolves` / `.rejects` failures; a TypeError inside the rejection is what the assertion caught,
// so this is checked before WRONG_REASON_PATTERNS.
const PROMISE_ASSERTION = /promise (?:rejected .+ instead of resolving|resolved .+ instead of rejecting)/;

const MODULE_MISS = [/Cannot find module ['"]([^'"]+)['"]/, /Failed to resolve import ['"]([^'"]+)['"]/];

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ROUTES = {
    ENV: 'user:env',
    NOT_COLLECTED: 'controller:placement',
    SKIPPED: 'controller:placement',
    GREEN_WITHOUT_RED: 'controller:halt',
    NO_RED_ON_RECORD: 'controller:halt',
    TARGET_NOT_FOUND: 'implementer:test-only',
    TARGET_AMBIGUOUS: 'implementer:test-only',
    WRONG_REASON: 'implementer:test-only',
    'WRONG_REASON{module}': 'implementer:test-only',
    WRONG_REASON_UNKNOWN: 'implementer:test-only',
    STILL_RED: 'implementer',
    COLLATERAL_RED: 'implementer',
    RUN_INCOMPLETE: 'controller:rerun',
    GATE_ERROR: 'controller:halt',
    OK_RED: null,
    OK_GREEN: null,
    OK_CHAR: null
};

const CONSUMES_ROUND = new Set([
    'TARGET_NOT_FOUND',
    'TARGET_AMBIGUOUS',
    'WRONG_REASON',
    'WRONG_REASON{module}',
    'WRONG_REASON_UNKNOWN',
    'STILL_RED',
    'COLLATERAL_RED'
]);

const HELP = `red-gate — TDD RED/GREEN gate with evidence ledger
  --phase red|green|char  required (char: tasks marked **characterization** only)
  --plan <plan.md>        required; ledger = <plan dir>/red-evidence.jsonl
  --task <N>              task number (ledger + plan contract)
  --file <abs path>       test file (absolute)
  --test "<name>"         substring of the test's full name, matching one test
  --project <name>        runner project collecting --file (omitted: no project filter)
  --all                   green only: whole suite, baseline from unitTest.knownFailuresFile, ledger audit
  --runner-cmd <cmd>      replace "npx <runner>" (testing hook)
Output: one JSON object on stdout; exit code always 0. Read ok / failureClass / routeTo.`;

export const parseArgs = (argv) => {
    const args = { phase: null, plan: null, task: null, file: null, test: null, project: null, all: false, runnerCmd: null, help: false };
    const take = (key, a, i) => {
        if (a === `--${key}`) return [argv[i + 1], 1];
        if (a.startsWith(`--${key}=`)) return [a.slice(key.length + 3), 0];
        return null;
    };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--all') args.all = true;
        else if (a === '--help' || a === '-h') args.help = true;
        else {
            let hit = null;
            for (const [key, field] of [['phase', 'phase'], ['plan', 'plan'], ['task', 'task'], ['file', 'file'], ['test', 'test'], ['project', 'project'], ['runner-cmd', 'runnerCmd']]) {
                hit = take(key, a, i);
                if (hit) {
                    args[field] = hit[0];
                    i += hit[1];
                    break;
                }
            }
        }
    }
    return args;
};

const emit = (payload) => {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    process.exit(0);
};

const gitRoot = () => {
    const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : process.cwd();
};

const headSha = () => {
    const r = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { encoding: 'utf8' });
    return r.status === 0 ? r.stdout.trim() : null;
};

// Next to the plan, so it survives workspace or worktree cleanup together with the plan
const ledgerPathFor = (root, planFile) => {
    const dir = path.dirname(path.resolve(root, planFile));
    mkdirSync(dir, { recursive: true });
    return path.join(dir, 'red-evidence.jsonl');
};

const readLedger = (ledger) => {
    if (!existsSync(ledger)) return [];
    return readFileSync(ledger, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => {
            try {
                return JSON.parse(line);
            } catch {
                return null;
            }
        })
        .filter(Boolean);
};

const firstLine = (s, max = 200) => String(s ?? '').split('\n')[0].slice(0, max);
const matchesAny = (patterns, text) => patterns.some((p) => p.test(text));

const loadKnownFailures = (knownPath) => {
    if (!knownPath) return { known: new Set(), knownPath: null };
    try {
        const j = JSON.parse(readFileSync(knownPath, 'utf8'));
        return { known: new Set(j.failures ?? []), knownPath };
    } catch {
        return { known: new Set(), knownPath };
    }
};

const missingModule = (text) => MODULE_MISS.map((re) => re.exec(text)?.[1]).find(Boolean) ?? null;

// ── plan contract ───────────────────────────────────────────────

/** `### Task N` section, same rule as the superpowers task brief (headings inside code fences ignored). */
export const taskSection = (planText, n, L = EN) => {
    const task = escapeRe(L['plan.task']);
    const out = [];
    let inFence = false;
    let inTask = false;
    for (const line of planText.split('\n')) {
        if (/^```/.test(line)) inFence = !inFence;
        if (!inFence && new RegExp(`^#+[ \\t]+${task}[ \\t]+\\d+`).test(line)) {
            inTask = new RegExp(`^#+[ \\t]+${task}[ \\t]+${n}([^0-9]|$)`).test(line);
        }
        if (inTask) out.push(line);
    }
    return out.join('\n');
};

const proseLines = (section) => {
    let inFence = false;
    return section.split('\n').filter((line) => {
        if (/^```/.test(line)) {
            inFence = !inFence;
            return false;
        }
        return !inFence;
    });
};

/** A task's contract: files it creates, the lines naming its new exports, its characterization marker. */
export const taskContract = (section, L = EN) => {
    const lines = proseLines(section);
    const creates = lines
        .filter((l) => /^\s*-\s*Create:/.test(l))
        .flatMap((l) => l.replace(/^\s*-\s*Create:/, '').match(/[\w@~./-]+\.\w+/g) ?? []);
    const produces = lines.filter((l) => /Produces/.test(l)).join('\n');
    const marker = `**${L['plan.characterization']}**`;
    const characterization = lines.some((l) => l.includes(marker));
    return { creates, produces, characterization };
};

const stemOf = (p) => p.replace(/\.([cm]?[jt]sx?|vue)$/, '');

/**
 * A missing module is a legitimate first RED only when the plan says this task creates it.
 * An undeclared path may be an import typo, so it stays WRONG_REASON{module}.
 */
export const isPlannedModuleMiss = (text, { root, testFile, contract, config }) => {
    const spec = missingModule(text);
    if (!spec || !contract) return false;
    const resolved = resolveAlias(spec, path.relative(root, testFile), root, config);
    if (resolved === null) return false;
    return contract.creates.some((c) => stemOf(path.posix.normalize(c)) === stemOf(resolved));
};

/** A TypeError for a not-yet-existing export is a legitimate RED only when Produces names it. */
export const isPlannedSymbolMiss = (text, contract) => {
    const m = /TypeError: \(?(?:0 , )?(?:[\w$]+\.)*([\w$]+)\)? is not a (?:function|constructor)/.exec(text);
    if (!m || !contract) return false;
    return new RegExp(`\\b${m[1].replace(/\$/g, '\\$')}\\b`).test(contract.produces);
};

/**
 * Repo-relative path of the first stack frame when it is a source file (not a test, not a dependency).
 * Tells whether production code or the test threw.
 */
export const thrownInSource = (text, root) => {
    const frame = /^\s+at (?:[^(\n]* \()?(?:file:\/\/)?(\/[^\n()]+?):\d+:\d+\)?\s*$/m.exec(text)?.[1];
    if (!frame || frame.includes('/node_modules/') || /\.(test|spec)\.[cm]?[jt]sx?$/.test(frame)) return null;
    return path.relative(root, frame);
};

/**
 * Ledger audit (report only): GREEN records without an earlier RED or characterization record,
 * tests whose last record failed, and plan tasks with no evidence that are not RED-exempt.
 * With liveTests ({ file, fullName }[]), failures of tests that were renamed away are not counted.
 */
export const auditLedger = (entries, planText, liveTests = null, L = EN) => {
    const key = (e) => `${e.file}::${e.test}`;
    const firstProof = new Map();
    const last = new Map();
    const violations = [];
    for (const e of [...entries].sort((a, b) => String(a.ts).localeCompare(String(b.ts)))) {
        last.set(key(e), e);
        if (!e.ok) continue;
        if (e.phase === 'red' || e.phase === 'char') {
            if (!firstProof.has(key(e))) firstProof.set(key(e), e);
        } else if (e.phase === 'green' && !firstProof.has(key(e))) {
            violations.push({ task: e.task, test: e.test, reason: 'no RED record before GREEN' });
        }
    }
    const isLive = (e) => !liveTests || liveTests.some((t) => t.file === e.file && String(t.fullName).includes(e.test));
    for (const e of last.values()) {
        if (!e.ok && isLive(e)) violations.push({ task: e.task, test: e.test, reason: `last record failed (${e.failureClass})` });
    }
    const headings = new RegExp(`^#+[ \\t]+${escapeRe(L['plan.task'])}[ \\t]+(\\d+)`, 'gm');
    const taskNums = [...new Set([...planText.matchAll(headings)].map((m) => Number(m[1])))];
    const exemptMarker = `**${L['plan.redExempt']}`;
    const exempt = (n) => taskSection(planText, n, L).includes(exemptMarker);
    const withEvidence = new Set(entries.filter((e) => e.ok).map((e) => Number(e.task)));
    return {
        violations,
        tasksWithoutEvidence: taskNums.filter((n) => !withEvidence.has(n) && !exempt(n)),
        exemptTasks: taskNums.filter(exempt)
    };
};

// ── runner adapters ─────────────────────────────────────────────

/** Command line for the configured runner. Returns { cmd, argv }. */
export const buildCommand = ({ runner, runnerArgs = [], project, maxWorkers, file, outputFile, runnerCmd }) => {
    const workers = maxWorkers ? [`--maxWorkers=${maxWorkers}`] : [];
    const argv =
        runner === 'jest'
            ? ['--json', `--outputFile=${outputFile}`, '--coverage=false', ...(project ? ['--selectProjects', project] : []), ...workers, ...runnerArgs, ...(file ? ['--runTestsByPath', file] : [])]
            : ['run', '--reporter=json', `--outputFile=${outputFile}`, '--coverage.enabled=false', ...(project ? ['--project', project] : []), ...workers, ...runnerArgs, ...(file ? [file] : [])];
    if (runnerCmd) return { cmd: 'bash', argv: ['-c', `${runnerCmd} "$@"`, '--', ...argv] };
    return { cmd: 'npx', argv: [runner, ...argv] };
};

const runRunner = (opts) => {
    const { cmd, argv } = buildCommand(opts);
    const r = spawnSync(cmd, argv, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, cwd: opts.cwd });
    return {
        command: `${cmd} ${argv.join(' ')}`,
        exitCode: r.status,
        stdout: r.stdout ?? '',
        stderr: r.stderr ?? '',
        spawnError: r.error ? r.error.message : null
    };
};

/**
 * vitest (--reporter=json) and jest (--json) both emit the Jest result schema:
 *   testResults[].name (abs file) · .message (file-level error) · assertionResults[].title / .fullName / .status / .failureMessages
 */
export const normalize = (report) => {
    const files = (report.testResults ?? []).map((tr) => ({ file: tr.name, message: (tr.message ?? '').trim() }));
    const tests = (report.testResults ?? []).flatMap((tr) =>
        (tr.assertionResults ?? []).map((ar) => ({
            file: tr.name,
            name: ar.title ?? '',
            fullName: ar.fullName ?? ar.title ?? '',
            status: ar.status === 'passed' ? 'passed' : ar.status === 'failed' ? 'failed' : 'skipped',
            message: (ar.failureMessages ?? []).join('\n'),
            duration: ar.duration ?? null
        }))
    );
    return { tests, files, collected: tests.length, raw: report };
};

/**
 * Whether a whole run stopped short: file-level errors, unfinished tests, or a non-zero exit with no
 * failed test. A non-zero exit with baseline failures is expected, so it does not count.
 */
export const incompleteRun = ({ exitCode, report }) => {
    const suiteErrors = (report?.testResults ?? [])
        .filter((tr) => tr.status === 'failed' && !(tr.assertionResults ?? []).some((a) => a.status === 'failed'))
        .map((tr) => ({ file: tr.name, message: firstLine(tr.message ?? '') }));
    const counted =
        (report?.numPassedTests ?? 0) + (report?.numFailedTests ?? 0) + (report?.numPendingTests ?? 0) + (report?.numTodoTests ?? 0);
    const unrun = Math.max(0, (report?.numTotalTests ?? 0) - counted);
    const exitWithoutFailure = exitCode !== 0 && (report?.numFailedTests ?? 0) === 0;
    if (!suiteErrors.length && !unrun && !exitWithoutFailure) return null;
    return { exitCode, unrun, suiteErrors };
};

/** isFirstParty(spec): whether a missing module is the project's own (a new module) rather than a dependency. */
export const classifyFailureText = (text, isFirstParty = (spec) => spec.startsWith('.')) => {
    if (PROMISE_ASSERTION.test(text)) return 'OK_RED';
    if (matchesAny(WRONG_REASON_PATTERNS, text)) return 'WRONG_REASON';
    const spec = missingModule(text);
    if ((spec && isFirstParty(spec)) || matchesAny(OK_RED_PATTERNS, text)) return 'OK_RED';
    return 'WRONG_REASON_UNKNOWN';
};

// ── main ────────────────────────────────────────────────────────

const main = () => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(HELP);
        process.exit(0);
    }
    const fail = (advice) => emit({ ok: false, failureClass: 'GATE_ERROR', routeTo: ROUTES.GATE_ERROR, consumesFixRound: false, advice });

    if (!['red', 'green', 'char'].includes(args.phase)) fail('--phase red|green|char is required');
    if (!args.plan) fail('--plan <plan.md> is required (derives the ledger location)');
    if (!args.all && (!args.file || !args.test)) fail('--file <abs path> and --test "<name>" are required (or --all)');
    if (args.file && !path.isAbsolute(args.file)) fail(`--file must be absolute — runner roots differ; an absolute path is unambiguous: ${args.file}`);
    if (args.all && args.phase !== 'green') fail('--all is green-only');
    if (args.phase === 'char' && !args.task) fail('--phase char needs --task <N> — the characterization marker is read from that plan task.');

    const cfgRes = loadConfig(process.cwd());
    const cfg = cfgRes.resolved ?? DEFAULTS;
    const root = cfgRes.root ?? gitRoot();
    const L = labelsFor(cfg.locale);
    const envPatterns = [...BUILTIN_ENV_PATTERNS, ...(cfg.e2e?.envErrorPatterns ?? []).map((s) => new RegExp(escapeRe(s)))];
    const isFirstParty = (spec) => path.isAbsolute(spec) || resolveAlias(spec, '', root, cfg) !== null;

    // runners report real paths; a --file through a symlink must still match
    const real = (p) => {
        try {
            return realpathSync(p);
        } catch {
            return p;
        }
    };
    const sameFile = (a, b) => a === b || real(a) === real(b);

    const ledger = ledgerPathFor(root, args.plan);
    const planPath = path.resolve(root, args.plan);
    const planText = existsSync(planPath) ? readFileSync(planPath, 'utf8') : '';
    const contract = args.task && planText ? taskContract(taskSection(planText, args.task, L), L) : null;
    if (args.phase === 'char' && !contract?.characterization)
        fail(`Plan Task ${args.task} has no **${L['plan.characterization']}** marker. If it is not a characterization task, confirm the failure with --phase red first.`);

    const outputFile = path.join(os.tmpdir(), `red-gate-${process.pid}.json`);
    rmSync(outputFile, { force: true });

    const run = runRunner({
        runner: cfg.unitTest.runner,
        runnerArgs: cfg.unitTest.runnerArgs ?? [],
        project: args.all ? null : args.project,
        // the whole suite at default concurrency fails at random from resource contention
        maxWorkers: args.all ? 2 : null,
        file: args.all ? null : args.file,
        outputFile,
        runnerCmd: args.runnerCmd,
        cwd: root
    });

    let report = null;
    if (existsSync(outputFile)) {
        try {
            report = JSON.parse(readFileSync(outputFile, 'utf8'));
        } catch {
            report = null;
        }
        rmSync(outputFile, { force: true });
    }
    const result = report ? normalize(report) : null;

    const base = {
        phase: args.phase,
        plan: args.plan,
        task: args.task ? Number(args.task) : null,
        target: args.all ? null : { file: args.file, test: args.test, project: args.project },
        run: {
            command: run.command,
            exitCode: run.exitCode,
            collected: result?.collected ?? null,
            passed: result ? result.tests.filter((t) => t.status === 'passed').length : null,
            failed: result ? result.tests.filter((t) => t.status === 'failed').length : null
        },
        // an alias warning explains why an aliased planned module miss stayed WRONG_REASON{module}
        config: { runner: cfg.unitTest.runner, warnings: [...(cfgRes.ok ? [] : cfgRes.errors), readAliases(root, cfg).warning].filter(Boolean) },
        evidence: { headSha: headSha(), recordedAt: new Date().toISOString(), ledger }
    };

    const finish = (failureClass, extra = {}) => {
        const ok = ['OK_RED', 'OK_GREEN', 'OK_CHAR'].includes(failureClass);
        const out = {
            ...base,
            ok,
            failureClass,
            // key presence, not ??: OK_* intentionally route to null
            routeTo: failureClass in ROUTES ? ROUTES[failureClass] : 'implementer',
            consumesFixRound: CONSUMES_ROUND.has(failureClass),
            ...extra
        };
        if (!args.all) {
            try {
                appendFileSync(
                    ledger,
                    `${JSON.stringify({
                        ts: out.evidence.recordedAt,
                        task: out.task,
                        phase: out.phase,
                        file: args.file,
                        test: args.test,
                        headSha: out.evidence.headSha,
                        failureClass,
                        ok,
                        messageHead: firstLine(extra.messageHead ?? '')
                    })}\n`
                );
            } catch {
                /* stdout is the source of truth; a ledger write failure must not block the verdict */
            }
        }
        emit(out);
    };

    // 1. ENV — runner produced no result, an environment pattern matched, or a dependency is missing
    const stderrAndOut = `${run.stderr}\n${run.stdout}`;
    const missingDep = [...stderrAndOut.matchAll(/Cannot find module ['"]([^'"]+)['"]/g)].find((m) => !isFirstParty(m[1]))?.[0];
    if (!result || matchesAny(envPatterns, stderrAndOut) || missingDep) {
        const hit = envPatterns.find((p) => p.test(stderrAndOut));
        finish('ENV', {
            matchedPattern: hit ? String(hit) : (missingDep ?? null),
            messageHead: firstLine(run.stderr || run.spawnError || 'runner produced no JSON result'),
            stderrTail: run.stderr.slice(-1500),
            advice: 'Not a test defect. Fix the environment (install dependencies, run commands.setup, free the port, restore file ownership) and retry. This gate does not consume a fix round.'
        });
    }

    // --all: whole-suite regression gate against the known-failures baseline
    if (args.all) {
        const audit = planText ? auditLedger(readLedger(ledger), planText, result.tests, L) : null;
        const { known, knownPath } = loadKnownFailures(cfg.unitTest.knownFailuresFile);
        const all = result.tests.filter((t) => t.status === 'failed');
        const keyOf = (t) => `${path.relative(real(root), real(t.file))}::${t.fullName}`;
        const failures = all.filter((t) => !known.has(keyOf(t)));
        const knownHit = all.length - failures.length;
        const incomplete = incompleteRun({ exitCode: run.exitCode, report });
        if (failures.length === 0 && incomplete) {
            finish('RUN_INCOMPLETE', {
                incomplete,
                audit,
                messageHead: incomplete.suiteErrors[0]?.message ?? firstLine(run.stderr),
                advice: 'The whole suite did not run to the end (file-level error, unfinished tests, or a non-zero exit without failures). No regression cannot be claimed. Rerun; if the same file repeats, fix that file\'s module error.'
            });
        }
        if (result.collected === 0)
            finish('NOT_COLLECTED', {
                audit,
                advice: `The runner collected 0 tests for the whole suite, so no regression check ran. Check commands.unitTest, unitTest.runner and unitTest.testFileGlobs (${(cfg.unitTest.testFileGlobs ?? []).join(', ')}).`
            });
        if (failures.length === 0) finish('OK_GREEN', { collateral: { newFailures: [], knownFailuresSkipped: knownHit, knownPath }, audit });
        finish('COLLATERAL_RED', {
            collateral: { newFailures: failures.map((t) => ({ file: t.file, test: t.fullName })), knownFailuresSkipped: knownHit, knownPath },
            audit,
            messageHead: firstLine(failures[0]?.message ?? ''),
            advice: 'New failures not in the baseline. If a failing file is outside the plan\'s Files: list, report to the user instead of fixing.'
        });
    }

    // 2. NOT_COLLECTED — the file filter was given but the file is absent from results
    const fileEntry = result.files.find((f) => sameFile(f.file, args.file));
    if (!fileEntry) {
        finish('NOT_COLLECTED', {
            advice: `The runner did not collect this file${args.project ? ` under --project ${args.project}` : ''}: ${args.file}\nMove it to a location matched by unitTest.testFileGlobs (${(cfg.unitTest.testFileGlobs ?? []).join(', ')}) and avoid excluded names (${(cfg.unitTest.excludedFilePatterns ?? []).join(', ') || 'none'}), or pass the --project that collects it. Do not edit the runner config.`
        });
    }

    const tests = result.tests.filter((t) => sameFile(t.file, args.file));
    const matches = tests.filter((t) => t.fullName.includes(args.test));

    // 3. target missing + file-level error (module-level failure). A module the plan says this task
    //    creates is a legitimate first RED.
    if (
        args.phase === 'red' &&
        matches.length === 0 &&
        isPlannedModuleMiss(fileEntry.message, { root, testFile: args.file, contract, config: cfg })
    ) {
        finish('OK_RED', { messageHead: firstLine(fileEntry.message), plannedMiss: 'module' });
    }
    if (matches.length === 0 && fileEntry.message) {
        finish('WRONG_REASON{module}', {
            messageHead: firstLine(fileEntry.message),
            advice: 'The file failed at module level (import error / top-level side effect / SyntaxError), so no test was collected. Fix the test file only; move setup into the test body. A new module counts as RED only when the task\'s Files: Create lists it.'
        });
    }

    // 4. target lookup
    if (matches.length === 0) {
        finish('TARGET_NOT_FOUND', {
            advice: `No test whose full name contains "${args.test}". Match --test to the it('UCP-NN: <description>') name.`,
            availableTests: tests.map((t) => t.fullName).slice(0, 20)
        });
    }
    if (matches.length > 1) {
        finish('TARGET_AMBIGUOUS', { advice: '--test matches several tests. Use a longer unique string.', matched: matches.map((t) => t.fullName) });
    }

    const target = matches[0];
    // a passing target in a run that crashed (unhandled error, exit 1 without failures) is not proof
    const passedOnlyIfComplete = (info) => {
        const incomplete = incompleteRun({ exitCode: run.exitCode, report });
        if (incomplete)
            finish('RUN_INCOMPLETE', {
                ...info,
                incomplete,
                messageHead: incomplete.suiteErrors[0]?.message ?? firstLine(run.stderr),
                advice: 'The target passed but the run did not finish cleanly (file-level error, unfinished tests, or a non-zero exit without failures — e.g. an unhandled error). Rerun; if it repeats, read stderrTail and fix the cause.',
                stderrTail: run.stderr.slice(-1500)
            });
    };
    const collateralFailures = result.tests.filter((t) => t.status === 'failed' && !(t.file === target.file && t.fullName === target.fullName));
    const targetInfo = {
        target: {
            file: target.file,
            test: target.fullName,
            status: target.status,
            durationMs: target.duration,
            failureMessages: target.message ? target.message.split('\n').slice(0, 5).map((m) => firstLine(m, 400)) : []
        }
    };

    // 4b. SKIPPED — the target did not run (skipped/pending/todo). Neither pass nor fail, so it must
    //     not fall through to GREEN_WITHOUT_RED (whose advice says to delete production code) or STILL_RED.
    if (target.status === 'skipped') {
        finish('SKIPPED', {
            ...targetInfo,
            advice: 'The target test did not run (skipped). In a multi-project runner, check that --project names the project that collects this file, and that no it.skip / it.todo / stray .only remains. Do not delete production code.'
        });
    }

    if (args.phase === 'char') {
        if (target.status !== 'passed') {
            finish('STILL_RED', {
                ...targetInfo,
                messageHead: firstLine(target.message),
                advice: 'A characterization test must pass against the unchanged behaviour. The test describes current behaviour wrongly — fix the test.'
            });
        }
        passedOnlyIfComplete(targetInfo);
        finish('OK_CHAR', targetInfo);
    }

    if (args.phase === 'red') {
        // 5. GREEN_WITHOUT_RED — the test passed at RED time (rule violation or vacuous test)
        if (target.status !== 'failed') {
            finish('GREEN_WITHOUT_RED', {
                ...targetInfo,
                advice: 'The test passed in the RED phase. If production code was written first, delete it (do not adapt it) and restart from RED. If not, the test asserts nothing — fix the test.'
            });
        }
        // 6·7. failure-reason classification; RED looks at the target only
        const cls = classifyFailureText(target.message, isFirstParty);
        if (cls === 'OK_RED') finish('OK_RED', { ...targetInfo, messageHead: firstLine(target.message) });
        if (cls === 'WRONG_REASON' && isPlannedSymbolMiss(target.message, contract))
            finish('OK_RED', { ...targetInfo, messageHead: firstLine(target.message), plannedMiss: 'export' });
        const thrownAt = cls === 'WRONG_REASON' ? thrownInSource(target.message, root) : null;
        finish(cls, {
            ...targetInfo,
            messageHead: firstLine(target.message),
            thrownAt,
            advice: thrownAt
                ? `Production code (${thrownAt}) threw. If handling it without an exception is what you verify, assert \`expect(() => …).not.toThrow()\` (async: \`await expect(fn()).resolves.toBeUndefined()\`) and rerun --phase red — it is then caught as an assertion failure. Otherwise a mock or input is missing — fix the test. Either way, do not write production code yet.`
                : cls === 'WRONG_REASON'
                  ? 'Not the expected assertion failure but a defect in the test itself (type/reference/syntax/timeout). Do not write production code; fix the test and rerun --phase red.'
                  : 'Could not classify the failure reason. Read the full failure message.'
        });
    }

    // --phase green
    const redOnRecord = readLedger(ledger).some(
        (e) => ['red', 'char'].includes(e.phase) && e.ok === true && e.file === args.file && e.test === args.test
    );
    if (!redOnRecord) {
        finish('NO_RED_ON_RECORD', {
            ...targetInfo,
            advice: `No RED (or characterization) record for this test in ${ledger}\nEither RED was skipped or --file/--test differ from the RED run. Pass --phase red first.`
        });
    }
    if (target.status !== 'passed') {
        finish('STILL_RED', {
            ...targetInfo,
            subClass: classifyFailureText(target.message, isFirstParty),
            messageHead: firstLine(target.message),
            advice: 'The target still fails after implementation. Handle as a normal fix round.'
        });
    }
    if (collateralFailures.length > 0) {
        finish('COLLATERAL_RED', {
            ...targetInfo,
            collateral: { newFailures: collateralFailures.map((t) => ({ file: t.file, test: t.fullName })) },
            messageHead: firstLine(collateralFailures[0]?.message ?? ''),
            advice: 'The target passes but other tests broke. Inside the plan\'s Files: the implementer fixes them; outside, report to the user (shared code changed beyond the declared surface).'
        });
    }
    passedOnlyIfComplete(targetInfo);
    finish('OK_GREEN', { ...targetInfo, collateral: { newFailures: [] } });
};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        main();
    } catch (e) {
        emit({
            ok: false,
            failureClass: 'GATE_ERROR',
            routeTo: ROUTES.GATE_ERROR,
            consumesFixRound: false,
            messageHead: firstLine(e?.stack ?? e?.message ?? String(e)),
            advice: 'red-gate internal error. Check arguments and environment.'
        });
    }
}
