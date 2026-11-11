const matchesAny = (patterns, value) => patterns.some((p) => value?.includes(p));

/** Remove whitelisted entries and report how many each list removed. */
export function filterRuntime(runtimeData, consoleWhitelist, networkWhitelist) {
    const allConsole = runtimeData.consoleErrors ?? [];
    // Browser "Failed to load resource" logs carry the URL only in `url`, so match it against the network list too
    const consoleErrors = allConsole.filter((e) => !matchesAny(consoleWhitelist, e.text) && !matchesAny(networkWhitelist, e.url));
    const allNetwork = runtimeData.networkErrors ?? [];
    const networkErrors = allNetwork.filter((e) => !matchesAny(networkWhitelist, e.url));
    return {
        runtimeData: { ...runtimeData, consoleErrors, networkErrors },
        whitelistedErrors: { patterns: consoleWhitelist, filteredCount: allConsole.length - consoleErrors.length, remainingCount: consoleErrors.length },
        whitelistedNetworkErrors: { patterns: networkWhitelist, filteredCount: allNetwork.length - networkErrors.length, remainingCount: networkErrors.length }
    };
}

/** Errors collected so far, through the same whitelists the verdict uses. For runtime checkpoints inside a spec. */
export function runtimeErrors(collector, { consoleErrorWhitelist = [], networkErrorWhitelist = [] } = {}) {
    const { runtimeData } = filterRuntime(
        {
            consoleErrors: collector.consoleEntries.filter((e) => e.type === 'error'),
            networkErrors: collector.networkErrors
        },
        consoleErrorWhitelist,
        networkErrorWhitelist
    );
    return { consoleErrors: runtimeData.consoleErrors, networkErrors: runtimeData.networkErrors };
}
