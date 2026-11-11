/** Builds e2e-report.html (and e2e-report.md for a full feature run) from one archive folder. Called by the archive reporter. */
import { readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { parseTcMd } from './tc-md.mjs';
import { collectRun } from './collect.mjs';
import { renderHtml } from './render-html.mjs';
import { renderMd } from './render-md.mjs';
import { extractCpFrames } from './trace-frames.mjs';
import { REPORT_FILE } from './latest.mjs';

const readJson = (file) => {
    try {
        return JSON.parse(readFileSync(file, 'utf8'));
    } catch {
        return null;
    }
};

/** Finds the previous archive with the same tag (by date, then number) and returns a relative link to it. */
export function findPrevHref(archiveRoot, tag, currentDir) {
    const re = new RegExp(`^${tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-(\\d+)$`);
    const all = [];
    const dates = existsSync(archiveRoot)
        ? readdirSync(archiveRoot, { withFileTypes: true }).filter((d) => d.isDirectory())
        : [];
    for (const date of dates.map((d) => d.name).sort()) {
        for (const name of readdirSync(path.join(archiveRoot, date))) {
            const m = name.match(re);
            if (m) all.push({ date, name, nn: Number(m[1]) });
        }
    }
    all.sort((a, b) => a.date.localeCompare(b.date) || a.nn - b.nn);
    const index = all.findIndex((x) => path.join(archiveRoot, x.date, x.name) === currentDir);
    const prev = index > 0 ? all[index - 1] : null;
    return prev ? `../../${prev.date}/${prev.name}/${REPORT_FILE}` : null;
}

/** Reads tc.md, loops and spec headers for the run and builds the report model; destDir null skips the previous-run link and thumbnails. */
export function buildModel({
    results,
    specFiles,
    tag,
    nn,
    destDir = null,
    testDir = results.config?.rootDir,
    cwd = process.cwd(),
    now = new Date(),
    filtered = false,
    settings
}) {
    const rel = specFiles.map((f) => path.relative(testDir, f));
    const dirs = [...new Set(rel.map((f) => (f.includes(path.sep) ? f.split(path.sep)[0] : null)))];
    const slug = dirs.length === 1 ? dirs[0] : null;
    const artifactLocale = settings.artifactLocale ?? settings.locale;

    const worksDir = slug ? path.join(settings.worksDir, slug) : null;
    const tcPath = worksDir ? path.join(worksDir, 'tc.md') : null;
    const tcMd = tcPath && existsSync(tcPath) ? parseTcMd(readFileSync(tcPath, 'utf8'), { locale: artifactLocale }) : null;
    const loops = (worksDir && readJson(path.join(worksDir, 'e2e-loops.json'))) ?? {};
    const slugDir = slug ? path.join(testDir, slug) : null;
    const dirSpecFiles =
        slugDir && existsSync(slugDir)
            ? readdirSync(slugDir)
                  .filter((f) => f.endsWith('.spec.js'))
                  .map((f) => path.join(slug, f))
            : [];
    const readHeader = (relFile) => {
        try {
            return readFileSync(path.join(testDir, relFile), 'utf8').slice(0, 2000);
        } catch {
            return '';
        }
    };

    const model = collectRun({
        results,
        tcMd,
        loops,
        slug,
        tag,
        nn,
        dirSpecFiles,
        readHeader,
        prevHref: destDir ? findPrevHref(path.dirname(path.dirname(destDir)), tag, destDir) : null,
        now,
        filtered,
        locale: settings.locale,
        artifactLocale,
        missingTcMd: tcPath && !tcMd ? path.relative(cwd, tcPath) : null,
        loopThreshold: settings.loopThreshold,
        specFilePrefix: settings.specFilePrefix,
        platformLabel: settings.platformLabel,
        thumbsFor: destDir
            ? (result) => {
                  const att = (result.attachments ?? []).find((a) => a.name === 'trace' && a.path);
                  return att && existsSync(att.path) ? extractCpFrames(att.path) : new Map();
              }
            : undefined
    });
    return { model, tcMd, worksDir };
}

/** Writes the report from destDir/results.json; the md is written only for an unfiltered, full-directory run with a tc.md. */
export function writeReport({
    destDir,
    specFiles,
    tag,
    nn,
    cwd = process.cwd(),
    now = new Date(),
    filtered = false,
    testDir,
    settings
}) {
    const results = JSON.parse(readFileSync(path.join(destDir, 'results.json'), 'utf8'));
    const { model, tcMd, worksDir } = buildModel({
        results,
        specFiles,
        tag,
        nn,
        destDir,
        testDir: testDir ?? results.config?.rootDir,
        cwd,
        now,
        filtered,
        settings
    });

    const reportPath = path.join(destDir, REPORT_FILE);
    writeFileSync(reportPath, renderHtml(model));

    let mdPath = null;
    if (tcMd && !model.partial) {
        mdPath = path.relative(cwd, path.join(worksDir, 'e2e-report.md'));
        writeFileSync(
            path.join(cwd, mdPath),
            renderMd(model, {
                archivePath: path.relative(cwd, destDir),
                openCommand: settings.openCommand
            })
        );
    }
    return { reportPath, mdPath, gate: model.gate.level, model };
}
