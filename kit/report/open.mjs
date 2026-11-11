#!/usr/bin/env node
/**
 * Opens the latest e2e-report.html through `playwright show-report`, which is required for trace links.
 *   node <kitDir>/report/open.mjs [--since <epochMs>]
 */
import { spawn } from 'node:child_process';
import path from 'node:path';
import { loadKitConfig, reportSettings } from '../config-loader.js';
import { listReportDirs, pickLatestReport, REPORT_FILE } from './latest.mjs';

const OPEN_WAIT_MS = 15000;
const sinceArg = process.argv.indexOf('--since');
const since = sinceArg > 0 ? Number(process.argv[sinceArg + 1]) : null;

const { archiveDir } = reportSettings(loadKitConfig());
const reportDir = pickLatestReport(listReportDirs(archiveDir), since);
if (!reportDir) {
    console.log(`[e2e-report] no ${REPORT_FILE} under ${path.relative(process.cwd(), archiveDir) || archiveDir}`);
    process.exit(1);
}

const openInBrowser = (url) => {
    const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'explorer' : 'xdg-open';
    const child = spawn(opener, [url], { stdio: 'ignore', detached: true });
    // No opener on CI/SSH: print the URL instead of crashing
    child.on('error', () => console.log(`[e2e-report] open manually: ${url}`));
    child.unref();
};

console.log(`[e2e-report] serving ${path.relative(process.cwd(), reportDir)}`);
const server = spawn('npx', ['playwright', 'show-report', reportDir, '--port', '0'], { stdio: ['ignore', 'pipe', 'inherit'], detached: true });
server.on('error', () => {});
const done = () => {
    server.stdout.destroy();
    server.unref();
    process.exit(0);
};
const timer = setTimeout(done, OPEN_WAIT_MS);
server.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
    const url = String(chunk).match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+/)?.[0];
    if (!url) return;
    console.log(`[e2e-report] ${url}/${REPORT_FILE}`);
    openInBrowser(`${url}/${REPORT_FILE}`);
    clearTimeout(timer);
    done();
});
