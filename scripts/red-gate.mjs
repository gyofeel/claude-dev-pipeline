#!/usr/bin/env node
/**
 * red-gate — deterministic TDD RED/GREEN gate with an evidence ledger.
 *
 * The one fact a TDD pipeline cannot reconstruct after the fact is "the test failed first".
 * This script records that fact at RED time and looks it up at GREEN time, so "the test
 * failed first" is a ledger query, not an agent's claim.
 *
 * Every verdict comes from the runner's JSON output — never from diff inference.
 *
 * Usage:
 *   node red-gate.mjs --phase red   --plan <plan.md> --task <N> --file <abs test> --test "<it name>"
 *   node red-gate.mjs --phase green --plan <plan.md> --task <N> --file <abs test> --test "<it name>"
 *   node red-gate.mjs --phase green --plan <plan.md> --all
 *
 * --plan   required — the ledger lives at <root>/.superpowers/sdd/<basename(plan,.md)>/red-evidence.jsonl
 *          (same rule as superpowers subagent-driven-development, so it sits next to progress.md).
 * --file   must be absolute — runner roots differ; an absolute path is unambiguous.
 * --test   the exact `it()` name (e.g. "UCP-01: returns matching items"); "UCP-01" alone also matches
 *          a single test whose name starts with "UCP-01:".
 * --all    run the whole suite (regression); pre-existing failures listed in
 *          unitTest.knownFailuresFile ({ "failures": ["rel/path.test.js::full name"] }) are skipped.
 * --runner-cmd <cmd>   test hook: replaces `npx <runner>`; receives the same argument list.
 *
 * Runner (unitTest.runner: vitest | jest) and extra args (unitTest.runnerArgs) come from
 * .agents/pipeline.config.json via ./config-load.mjs.
 *
 * Output: one JSON object on stdout. Exit code is always 0 — callers read ok / failureClass.
 */

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, loadConfig } from './config-load.mjs';

const BUILTIN_ENV_PATTERNS = [
    /EACCES/,
    /permission denied/i,
    /ENOENT.*node_modules/,
    /Cannot find module ['"](?![.~@/])/, // bare specifier → dependency not installed
    /Cannot find package/,
    /Failed to load config/i,
    /failed to load config from/,
    /EADDRINUSE/,
    /ENOSPC/,
    /heap out of memory/
];

const WRONG_REASON_PATTERNS = [
    /^\s*TypeError:/m,
    /^\s*ReferenceError:/m,
    /^\s*SyntaxError:/m,
    /Test timed out in \d+ms/,
    /Hook timed out in \d+ms/,
    /Exceeded timeout of \d+ ?ms/
];

const OK_RED_PATTERNS = [/AssertionError/, /expected .+ to /, /Expected:.*\n.*Received:/s];

const FIRST_PARTY_SPECIFIER = /^(@\/|~\/|\.{1,2}\/)/;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const ROUTES = {
    ENV: 'user:env',
    NOT_COLLECTED: 'controller:placement',
    GREEN_WITHOUT_RED: 'controller:halt',
    NO_RED_ON_RECORD: 'controller:halt',
    TARGET_NOT_FOUND: 'implementer:test-only',
    TARGET_AMBIGUOUS: 'implementer:test-only',
    WRONG_REASON: 'implementer:test-only',
    'WRONG_REASON{module}': 'implementer:test-only',
    WRONG_REASON_UNKNOWN: 'implementer:test-only',
    STILL_RED: 'implementer',
    COLLATERAL_RED: 'implementer',
    GATE_ERROR: 'controller:halt',
    OK_RED: null,
    OK_GREEN: null
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
  --phase red|green   required
  --plan <plan.md>    required; ledger = <root>/.superpowers/sdd/<basename>/red-evidence.jsonl
  --task <N>          task number (recorded in the ledger)
  --file <abs path>   test file (absolute)
  --test "<it name>"  exact it() name, or "UCP-NN" prefix
  --all               green only: whole suite, baseline from unitTest.knownFailuresFile
  --runner-cmd <cmd>  replace "npx <runner>" (testing hook)
Output: one JSON object on stdout; exit code always 0. Read ok / failureClass / routeTo.`;

export const parseArgs = (argv) => {
    const args = { phase: null, plan: null, task: null, file: null, test: null, all: false, runnerCmd: null, help: false };
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
            for (const [key, field] of [['phase', 'phase'], ['plan', 'plan'], ['task', 'task'], ['file', 'file'], ['test', 'test'], ['runner-cmd', 'runnerCmd']]) {
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

/** Same rule as superpowers sdd-workspace: <root>/.superpowers/sdd/<basename(plan,.md)>/ */
const ledgerPathFor = (root, planFile) => {
    const dir = path.join(root, '.superpowers', 'sdd', path.basename(planFile, '.md'));
    mkdirSync(dir, { recursive: true });
    try {
        writeFileSync(path.join(root, '.superpowers', 'sdd', '.gitignore'), '*\n');
    } catch {
        /* the ledger entry is what matters */
    }
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

/** A missing first-party module is a legitimate first RED for a new module; distinguish from uninstalled deps. */
const isFirstPartyModuleMiss = (text) => {
    const m = /Cannot find module ['"]([^'"]+)['"]/.exec(text) || /Failed to resolve import ['"]([^'"]+)['"]/.exec(text);
    return !!m && FIRST_PARTY_SPECIFIER.test(m[1]);
};

// ── runner adapters ─────────────────────────────────────────────

/** Command line for the configured runner. Returns { cmd, argv }. */
export const buildCommand = ({ runner, runnerArgs = [], file, outputFile, runnerCmd }) => {
    const argv =
        runner === 'jest'
            ? ['--json', `--outputFile=${outputFile}`, ...runnerArgs, ...(file ? ['--runTestsByPath', file] : [])]
            : ['run', '--reporter=json', `--outputFile=${outputFile}`, ...runnerArgs, ...(file ? [file] : [])];
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
 * Module-level failures (import error, SyntaxError) appear only in testResults[].message.
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

const classifyFailureText = (text) => {
    if (matchesAny(WRONG_REASON_PATTERNS, text)) return 'WRONG_REASON';
    if (isFirstPartyModuleMiss(text) || matchesAny(OK_RED_PATTERNS, text)) return 'OK_RED';
    return 'WRONG_REASON_UNKNOWN';
};

/** Exact it() name, or "UCP-NN" prefix → tests named "UCP-NN: …". */
const findTargets = (tests, name) => {
    const exact = tests.filter((t) => t.name === name);
    if (exact.length) return exact;
    if (/^UCP-\d+$/.test(name)) return tests.filter((t) => t.name.startsWith(`${name}:`));
    return [];
};

// ── main ────────────────────────────────────────────────────────

const main = () => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        console.log(HELP);
        process.exit(0);
    }
    const fail = (advice) => emit({ ok: false, failureClass: 'GATE_ERROR', routeTo: ROUTES.GATE_ERROR, consumesFixRound: false, advice });

    if (!['red', 'green'].includes(args.phase)) fail('--phase red|green is required');
    if (!args.plan) fail('--plan <plan.md> is required (derives the ledger location)');
    if (!args.all && (!args.file || !args.test)) fail('--file <abs path> and --test "<it name>" are required (or --all)');
    if (args.file && !path.isAbsolute(args.file)) fail(`--file must be absolute — runner roots differ; an absolute path is unambiguous: ${args.file}`);
    if (args.all && args.phase !== 'green') fail('--all is green-only');

    const cfgRes = loadConfig(process.cwd());
    const cfg = cfgRes.resolved ?? DEFAULTS;
    const root = cfgRes.root ?? gitRoot();
    const envPatterns = [...BUILTIN_ENV_PATTERNS, ...(cfg.e2e?.envErrorPatterns ?? []).map((s) => new RegExp(escapeRe(s)))];

    const ledger = ledgerPathFor(root, args.plan);
    const outputFile = path.join(os.tmpdir(), `red-gate-${process.pid}.json`);
    rmSync(outputFile, { force: true });

    const run = runRunner({
        runner: cfg.unitTest.runner,
        runnerArgs: cfg.unitTest.runnerArgs ?? [],
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
        target: args.all ? null : { file: args.file, test: args.test },
        run: {
            command: run.command,
            exitCode: run.exitCode,
            collected: result?.collected ?? null,
            passed: result ? result.tests.filter((t) => t.status === 'passed').length : null,
            failed: result ? result.tests.filter((t) => t.status === 'failed').length : null
        },
        config: { runner: cfg.unitTest.runner, warnings: cfgRes.ok ? [] : cfgRes.errors },
        evidence: { headSha: headSha(), recordedAt: new Date().toISOString(), ledger }
    };

    const finish = (failureClass, extra = {}) => {
        const ok = failureClass === 'OK_RED' || failureClass === 'OK_GREEN';
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

    // 1. ENV — runner produced no result, or an environment pattern matched
    const stderrAndOut = `${run.stderr}\n${run.stdout}`;
    if (!result || matchesAny(envPatterns, stderrAndOut)) {
        const hit = envPatterns.find((p) => p.test(stderrAndOut));
        finish('ENV', {
            matchedPattern: hit ? String(hit) : null,
            messageHead: firstLine(run.stderr || run.spawnError || 'runner produced no JSON result'),
            stderrTail: run.stderr.slice(-1500),
            advice: 'Not a test defect. Fix the environment (install dependencies, run commands.setup, free the port, restore file ownership) and retry. This gate does not consume a fix round.'
        });
    }

    // --all: whole-suite regression gate against the known-failures baseline
    if (args.all) {
        const { known, knownPath } = loadKnownFailures(cfg.unitTest.knownFailuresFile);
        const all = result.tests.filter((t) => t.status === 'failed');
        const real = (p) => {
            try {
                return realpathSync(p);
            } catch {
                return p;
            }
        };
        const keyOf = (t) => `${path.relative(real(root), real(t.file))}::${t.fullName}`;
        const failures = all.filter((t) => !known.has(keyOf(t)));
        const knownHit = all.length - failures.length;
        if (failures.length === 0) finish('OK_GREEN', { collateral: { newFailures: [], knownFailuresSkipped: knownHit, knownPath } });
        finish('COLLATERAL_RED', {
            collateral: { newFailures: failures.map((t) => ({ file: t.file, test: t.fullName })), knownFailuresSkipped: knownHit, knownPath },
            messageHead: firstLine(failures[0]?.message ?? ''),
            advice: 'New failures not in the baseline. If a failing file is outside the plan\'s Files: list, report to the user instead of fixing.'
        });
    }

    // 2. NOT_COLLECTED — the file filter was given but the file is absent from results
    const fileEntry = result.files.find((f) => f.file === args.file);
    if (!fileEntry) {
        finish('NOT_COLLECTED', {
            advice: `The runner did not collect this file: ${args.file}\nMove it to a location matched by unitTest.testFileGlobs (${(cfg.unitTest.testFileGlobs ?? []).join(', ')}) and avoid excluded names (${(cfg.unitTest.excludedFilePatterns ?? []).join(', ') || 'none'}). Do not edit the runner config.`
        });
    }

    const tests = result.tests.filter((t) => t.file === args.file);
    const matches = findTargets(tests, args.test);

    // 3. WRONG_REASON{module} — target missing + file-level error (module-level failure)
    if (matches.length === 0 && fileEntry.message) {
        finish('WRONG_REASON{module}', {
            messageHead: firstLine(fileEntry.message),
            advice: 'The file failed at module level (import error / top-level side effect / SyntaxError), so no test was collected. Fix the test file only; move setup into the test body.'
        });
    }

    // 4. target lookup
    if (matches.length === 0) {
        finish('TARGET_NOT_FOUND', {
            advice: `No test named "${args.test}". Match --test to the it('UCP-NN: <description>') name exactly.`,
            availableTests: tests.map((t) => t.name).slice(0, 20)
        });
    }
    if (matches.length > 1) {
        finish('TARGET_AMBIGUOUS', { advice: '--test matches several tests. Use the full unique it() name.', matched: matches.map((t) => t.fullName) });
    }

    const target = matches[0];
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

    if (args.phase === 'red') {
        // 5. GREEN_WITHOUT_RED — the test passed at RED time (rule violation or vacuous test)
        if (target.status !== 'failed') {
            finish('GREEN_WITHOUT_RED', {
                ...targetInfo,
                advice: 'The test passed in the RED phase. If production code was written first, delete it (do not adapt it) and restart from RED. If not, the test asserts nothing — fix the test.'
            });
        }
        // 6·7. failure-reason classification; RED looks at the target only
        const cls = classifyFailureText(target.message);
        if (cls === 'OK_RED') finish('OK_RED', { ...targetInfo, messageHead: firstLine(target.message) });
        finish(cls, {
            ...targetInfo,
            messageHead: firstLine(target.message),
            advice:
                cls === 'WRONG_REASON'
                    ? 'Not the expected assertion failure but a defect in the test itself (type/reference/syntax/timeout). Do not write production code; fix the test and rerun --phase red.'
                    : 'Could not classify the failure reason. Read the full failure message.'
        });
    }

    // --phase green
    const redOnRecord = readLedger(ledger).some((e) => e.phase === 'red' && e.ok === true && e.file === args.file && e.test === args.test);
    if (!redOnRecord) {
        finish('NO_RED_ON_RECORD', {
            ...targetInfo,
            advice: `No RED record for this test in ${ledger}\nEither RED was skipped or --file/--test differ from the RED run. Pass --phase red first.`
        });
    }
    if (target.status !== 'passed') {
        finish('STILL_RED', {
            ...targetInfo,
            subClass: classifyFailureText(target.message),
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
