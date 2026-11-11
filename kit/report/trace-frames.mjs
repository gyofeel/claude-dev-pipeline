/** Pulls the screen frame at the end of each cp step from trace.zip (needs the system unzip; failures give an empty Map). */
import { execFileSync } from 'node:child_process';

const CP_RE = /^(cp-\d+)/i;
const ZIP_MAX_BUFFER = 64 * 1024 * 1024;

export const parseTraceLines = (text) =>
    String(text)
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

/** Last frame file before each cp step ends; step and frame times share one monotonic clock. */
export function pickFrames(events, frames) {
    const cpByCall = new Map();
    const picked = new Map();
    const sorted = [...frames].sort((a, b) => a.timestamp - b.timestamp);
    for (const ev of events) {
        if (ev.type === 'before' && ev.method === 'test.step' && CP_RE.test(ev.title ?? '')) {
            cpByCall.set(ev.callId, ev.title.match(CP_RE)[1].toLowerCase());
        }
        if (ev.type !== 'after' || !cpByCall.has(ev.callId)) continue;
        const frame = sorted.filter((f) => f.timestamp <= ev.endTime).at(-1);
        if (frame) picked.set(cpByCall.get(ev.callId), frame.file);
    }
    return picked;
}

const unzipReader = (zipPath) => ({
    list: () =>
        String(execFileSync('unzip', ['-Z1', zipPath]))
            .split('\n')
            .filter(Boolean),
    read: (entry) => execFileSync('unzip', ['-p', zipPath, entry], { maxBuffer: ZIP_MAX_BUFFER })
});

/** Per-cp thumbnail data URIs from one trace.zip; an empty Map on failure. */
export function extractCpFrames(traceZipPath, zip = unzipReader(traceZipPath)) {
    try {
        const traces = zip.list().filter((e) => e.endsWith('.trace'));
        const events = traces.flatMap((e) => parseTraceLines(zip.read(e)));
        const frames = events.filter((e) => e.type === 'screencast-frame' && e.file);
        const out = new Map();
        for (const [key, file] of pickFrames(events, frames)) {
            out.set(key, `data:image/jpeg;base64,${zip.read(file).toString('base64')}`);
        }
        return out;
    } catch {
        return new Map();
    }
}
