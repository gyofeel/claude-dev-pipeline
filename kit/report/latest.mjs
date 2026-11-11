/** Picks the report to open; right after a run only reports created by that run count. */
import { readdirSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

/** Newest dir at or after `since` from a { dir, mtimeMs } list; all entries count when `since` is null. */
export function pickLatestReport(dirs, since = null) {
    const candidates = since == null ? dirs : dirs.filter((d) => d.mtimeMs >= since);
    return [...candidates].sort((a, b) => b.mtimeMs - a.mtimeMs)[0]?.dir ?? null;
}

/** Report file name inside an archive dir. */
export const REPORT_FILE = 'e2e-report.html';

/** Directories under the archive root that hold the report file. */
export function listReportDirs(archiveDir, file = REPORT_FILE) {
    try {
        return readdirSync(archiveDir, { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .flatMap(({ name: date }) =>
                readdirSync(path.join(archiveDir, date)).map((name) =>
                    path.join(archiveDir, date, name)
                )
            )
            .filter((dir) => existsSync(path.join(dir, file)))
            .map((dir) => ({ dir, mtimeMs: statSync(path.join(dir, file)).mtimeMs }));
    } catch {
        return [];
    }
}
