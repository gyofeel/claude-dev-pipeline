/** Every user-facing string of the verdict, the fixture messages and the e2e-report pages. Both locales share one shape. */

const en = (platform) => ({
    htmlLang: 'en',
    gate: { defect: 'Not approvable — defect', rerun: 'Not approvable — rerun needed', check: 'Needs review', ok: 'Approvable',
        testDataAbsent: 'Test data absent', missingValue: 'Empty value in actuals', expectedNeedsCheck: 'Expected value needs review', actual: 'actual' },
    failure: {
        setup: 'Failed before any checkpoint (setup / environment)',
        timeout: 'Test timeout',
        interrupted: 'Run interrupted',
        assertion: 'Checkpoint assertion failed',
        judge: 'Runtime verdict FAIL',
        'mock-unused': 'mock never used',
        other: 'Other failure'
    },
    stepState: {
        passed: 'Passed',
        failed: 'Failed',
        unreached: 'Not reached',
        'not-run': 'Not run',
        unmarked: 'Not marked',
        soft: platform ? `Depends on ${platform} — recheck on device` : 'Recheck on device'
    },
    acState: {
        passed: 'Passed',
        failed: 'Failed',
        unverified: 'Unverified (environment)',
        skipped: 'Unverified (skip)',
        missing: 'No spec',
        'not-in-run': 'Not in this run',
        unmapped: 'Unmapped'
    },
    acCategory: { unit: 'Unit test', manual: 'Manual review', excluded: 'Out of scope', cancelled: 'Cancelled', 'no-tc': 'No TC' },
    excluded: { whitelist: 'whitelist', 'be-response': 'backend response', 'resource-load': 'resource load', asset: 'asset', 'mock-scope': 'outside mocks' },
    issue: { console_error: 'Client console error', exception: 'Uncaught exception', network_error: 'API error response' },
    whitelistCount: (n) => `whitelist ${n}`,
    judgeSummary: ({ cpPassed, cpTotal, clientErrors, excluded }) => {
        const parts = [`cp ${cpPassed}/${cpTotal} passed`, `client errors ${clientErrors}`];
        if (!excluded.length) return parts.join(' · ');
        const total = excluded.reduce((a, [, n]) => a + n, 0);
        const L = en(platform);
        parts.push(`excluded ${total} (${excluded.map(([r, n]) => `${L.excluded[r] ?? r} ${n}`).join(' · ')})`);
        return parts.join(' · ');
    },
    skipSummary: 'Not run (skip)',
    annotation: { runtimeVerdict: 'Runtime verdict' },
    verdictThrow: (tcName, verdict, issueLines) => `[${tcName}] verdict: ${verdict}\nIssues:\n${issueLines || 'none'}`,
    softLog: (title, reason) => `[soft-track] ${title} — ${reason} (recheck on device)`,
    setupStep: 'Entry / setup (beforeEach)',
    runLabel: (n) => `run ${n}`,
    reason: {
        failure: (label, kindLabel) => `${label} — ${kindLabel}`,
        missingSpec: (tcId, acIds) => `${tcId} — no spec (${acIds.join(' · ')})`,
        skip: (label, why) => `${label} — skip: ${why ?? 'no reason given'}`,
        unmarked: (label, n) => `${label} — ${n} checkpoint(s) not marked`,
        unmapped: (label) => `${label} — cannot map to a TC`,
        loops: (label, n) => `${label} — regenerated ${n} times`,
        unmappedTc: (tcId, acIds) => `${tcId} — spec exists but no test maps to it (${acIds.join(' · ')})`,
        tcMdUnread: (looked, locale) => `tc.md — no TC block has any of: ${looked.join(' / ')} (read as locale ${locale}; check the config locale)`,
        loadError: (message) => `spec failed to load — ${message}`,
        noVerdict: (label) => `${label} — no runtime verdict — kit fixture not used`,
        noTcMd: (slug, file) => `${slug} — no tc.md at ${file}; AC coverage not checked`
    },
    html: {
        title: (t) => `E2E report · ${t}`,
        prevRun: '◂ previous run',
        conclusion: 'Conclusion',
        nothingToCheck: 'Nothing to review',
        partialFiltered: 'only some tests ran (--grep etc.)',
        partialNote: (scope) => `Partial run: ${scope} — TCs not run show as "Not in this run" in the AC table`,
        acCoverage: 'AC coverage',
        notE2e: 'Not E2E',
        actual: 'actual',
        skipReason: (why) => `Skip reason — ${why ?? 'no reason given'}`,
        verdictBasis: 'Verdict basis',
        mockLine: (f, e, l) => `mock: fixture ${f} · empty ${e} · live ${l}`,
        mockNone: 'mock: not recorded',
        playwrightDetail: 'Playwright detail · trace',
        apiNone: 'No API calls recorded',
        apiLine: (total, dup, idle) => `API calls ${total} · duplicate ${dup} · idle ${idle}`,
        dupRequests: 'Duplicate requests',
        idleRequests: 'Requests while idle',
        afterInput: (s) => `${s} after last input`,
        byEndpoint: 'By endpoint',
        excludedItems: 'Excluded items',
        emptyApi: 'Empty-response APIs',
        liveApi: 'Live APIs',
        consoleErrors: 'Console errors',
        consoleWarnings: 'Console warnings',
        exceptions: 'JS exceptions',
        networkErrors: 'Network errors',
        loops: (n) => ` · loops ${n}`,
        tests: 'Tests',
        generated: 'Generated',
        fullReport: 'Full Playwright report'
    },
    md: {
        heading: (t) => `# E2E report — ${t}`,
        conclusion: 'Conclusion',
        ran: 'Run',
        results: 'Results',
        detail: (p, cmd) => `Detail: \`${p}\` (open with \`${cmd}\`)`,
        conclusionDetail: 'Conclusion detail',
        acCoverage: 'AC coverage',
        acHeader: ['| AC | Criterion | TC | Result |', '| --- | --- | --- | --- |'],
        notE2e: 'Not E2E',
        tests: 'Tests',
        testHeader: ['| TC | Test | Result | cp | Requests | Time | Loops |', '| --- | --- | --- | --- | --- | --- | --- |'],
        status: { passed: 'passed', skipped: 'skip' },
        requests: (total, dup) => `total ${total} · duplicate ${dup}`
    }
});

const ko = (platform) => ({
    htmlLang: 'ko',
    gate: { defect: '승인 불가 — 결함', rerun: '승인 불가 — 재실행 필요', check: '확인 필요', ok: '승인 가능',
        testDataAbsent: '시험 데이터 부재', missingValue: '실측값에 빈 값', expectedNeedsCheck: '기대값 확인 필요', actual: '실측' },
    failure: {
        setup: 'cp 도달 전 실패 (setup·환경)',
        timeout: '테스트 타임아웃',
        interrupted: '실행 중단',
        assertion: 'cp 단언 실패',
        judge: '런타임 판정 FAIL',
        'mock-unused': '목업 미사용',
        other: '기타 실패'
    },
    stepState: {
        passed: '통과',
        failed: '실패',
        unreached: '미도달',
        'not-run': '미실행',
        unmarked: '판정 누락',
        soft: platform ? `${platform} 응답 의존 — 실기기 재검증 필요` : '실기기 재검증 필요'
    },
    acState: {
        passed: '통과',
        failed: '실패',
        unverified: '미검증 (환경)',
        skipped: '미검증 (skip)',
        missing: 'spec 없음',
        'not-in-run': '이번 실행 제외',
        unmapped: '매핑 불가'
    },
    acCategory: { unit: '단위 테스트', manual: '수동 검수', excluded: '범위 제외', cancelled: '취소', 'no-tc': 'TC 없음' },
    excluded: { whitelist: '화이트리스트', 'be-response': 'BE', 'resource-load': '리소스 로드', asset: '자산', 'mock-scope': 'mock 범위 밖' },
    issue: { console_error: '클라이언트 콘솔 에러', exception: 'uncaught 예외', network_error: 'API 오류 응답' },
    whitelistCount: (n) => `화이트리스트 ${n}건`,
    judgeSummary: ({ cpPassed, cpTotal, clientErrors, excluded }) => {
        const parts = [`cp ${cpPassed}/${cpTotal} 통과`, `클라이언트 에러 ${clientErrors}`];
        if (!excluded.length) return parts.join(' · ');
        const total = excluded.reduce((a, [, n]) => a + n, 0);
        const L = ko(platform);
        parts.push(`제외 ${total} (${excluded.map(([r, n]) => `${L.excluded[r] ?? r} ${n}`).join(' · ')})`);
        return parts.join(' · ');
    },
    skipSummary: '실행되지 않음 (skip)',
    annotation: { runtimeVerdict: '런타임 판정' },
    verdictThrow: (tcName, verdict, issueLines) => `[${tcName}] 판정 결과: ${verdict}\nIssues:\n${issueLines || '없음'}`,
    softLog: (title, reason) => `[soft-track] ${title} — ${reason} (개발 환경 한계, 실기기 재검증 필요)`,
    setupStep: '진입·준비 (beforeEach)',
    runLabel: (n) => `${n}회차`,
    reason: {
        failure: (label, kindLabel) => `${label} — ${kindLabel}`,
        missingSpec: (tcId, acIds) => `${tcId} — spec 없음 (${acIds.join(' · ')})`,
        skip: (label, why) => `${label} — skip: ${why ?? '사유 없음'}`,
        unmarked: (label, n) => `${label} — 판정 누락 cp ${n}개`,
        unmapped: (label) => `${label} — TC 매핑 불가`,
        loops: (label, n) => `${label} — 재생성 루프 ${n}회`,
        unmappedTc: (tcId, acIds) => `${tcId} — spec 은 있으나 매핑된 테스트 없음 (${acIds.join(' · ')})`,
        tcMdUnread: (looked, locale) => `tc.md — 어느 TC 블록에도 ${looked.join(' / ')} 항목이 없음 (${locale} 로 읽음, 설정 locale 확인)`,
        loadError: (message) => `spec 로드 실패 — ${message}`,
        noVerdict: (label) => `${label} — 런타임 판정 없음 — kit fixture 미사용`,
        noTcMd: (slug, file) => `${slug} — ${file} 에 tc.md 없음, AC 커버리지 확인 안 함`
    },
    html: {
        title: (t) => `E2E 리포트 · ${t}`,
        prevRun: '◂ 직전 회차',
        conclusion: '결론',
        nothingToCheck: '확인할 항목이 없습니다',
        partialFiltered: '일부 테스트만 실행(--grep 등)',
        partialNote: (scope) => `부분 실행: ${scope} — 실행하지 않은 TC 는 AC 표에서 "이번 실행 제외"로 표시합니다`,
        acCoverage: 'AC 커버리지',
        notE2e: 'E2E 대상 아님',
        actual: '실제',
        skipReason: (why) => `skip 사유 — ${why ?? '사유 없음'}`,
        verdictBasis: '판정 근거',
        mockLine: (f, e, l) => `mock: fixture ${f} · 빈 응답 ${e} · 실호출 ${l}`,
        mockNone: 'mock: 기록 없음',
        playwrightDetail: 'Playwright 상세 · trace',
        apiNone: 'API 호출 기록 없음',
        apiLine: (total, dup, idle) => `API 호출 ${total} · 중복 ${dup} · 유휴 ${idle}`,
        dupRequests: '중복 요청',
        idleRequests: '유휴 중 요청',
        afterInput: (s) => `마지막 입력 ${s} 뒤`,
        byEndpoint: '엔드포인트별',
        excludedItems: '제외 항목',
        emptyApi: '빈 응답 API',
        liveApi: '실호출 API',
        consoleErrors: '콘솔 에러',
        consoleWarnings: '콘솔 경고',
        exceptions: 'JS 예외',
        networkErrors: '네트워크 오류',
        loops: (n) => ` · 루프 ${n}`,
        tests: '테스트',
        generated: '생성',
        fullReport: 'Playwright 리포트 전체'
    },
    md: {
        heading: (t) => `# E2E 리포트 — ${t}`,
        conclusion: '결론',
        ran: '실행',
        results: '결과',
        detail: (p, cmd) => `상세: \`${p}\` (\`${cmd}\`로 열기)`,
        conclusionDetail: '결론 상세',
        acCoverage: 'AC 커버리지',
        acHeader: ['| AC | 내용 | TC | 결과 |', '| --- | --- | --- | --- |'],
        notE2e: 'E2E 대상 아님',
        tests: '테스트',
        testHeader: ['| TC | 테스트 | 결과 | cp | 요청 | 소요 | 루프 |', '| --- | --- | --- | --- | --- | --- | --- |'],
        status: { passed: '통과', skipped: 'skip' },
        requests: (total, dup) => `총 ${total} · 중복 ${dup}`
    }
});

const LOCALES = { en, ko };

/** Strings for one locale. Unknown locales fall back to English. */
export const labels = (locale = 'en', { platformLabel = null } = {}) => (LOCALES[locale] ?? en)(platformLabel);

export const VERDICT_ICON = { PASS: '✅', FAIL: '❌', SKIP: '⏭' };

const pad = (n) => String(Math.abs(n)).padStart(2, '0');

/** ISO time → 'YYYY-MM-DD HH:mm (UTC±hh:mm)' in the machine's time zone. */
export const formatTime = (iso) => {
    const d = new Date(iso);
    const offset = -d.getTimezoneOffset();
    const local = new Date(d.getTime() + offset * 60000).toISOString().slice(0, 16).replace('T', ' ');
    return `${local} (UTC${offset >= 0 ? '+' : '-'}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)})`;
};
