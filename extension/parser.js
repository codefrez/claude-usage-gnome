// Funções puras: JSON do endpoint de uso -> modelo de janelas. Sem imports de gi://.

const SCOPED_FIELDS = [
    ['seven_day_opus', 'Opus'],
    ['seven_day_sonnet', 'Sonnet'],
];

function clampPercent(value) {
    if (typeof value !== 'number' || !Number.isFinite(value))
        return null;
    return Math.min(100, Math.max(0, value));
}

function parseDate(value) {
    if (typeof value !== 'string')
        return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function parseWindow(raw) {
    if (raw === null || typeof raw !== 'object')
        return null;
    const utilization = clampPercent(raw.utilization);
    if (utilization === null)
        return null;
    return {utilization, resetsAt: parseDate(raw.resets_at)};
}

function parseScopedLimits(limits, knownNames) {
    if (!Array.isArray(limits))
        return [];
    const result = [];
    for (const entry of limits) {
        if (entry === null || typeof entry !== 'object' || entry.kind !== 'weekly_scoped')
            continue;
        const name = entry.scope?.model?.display_name;
        const utilization = clampPercent(entry.percent);
        if (typeof name !== 'string' || name === '' || utilization === null)
            continue;
        const lower = name.toLowerCase();
        if (knownNames.some(known => lower.includes(known)))
            continue;
        result.push({name, utilization, resetsAt: parseDate(entry.resets_at)});
    }
    return result;
}

/**
 * @param {unknown} json resposta já decodificada
 * @returns {{fiveHour: object|null, sevenDay: object|null, scoped: object[]}|null}
 *   null quando nenhuma janela é reconhecida.
 */
export function parseUsage(json) {
    if (json === null || typeof json !== 'object')
        return null;

    const fiveHour = parseWindow(json.five_hour);
    const sevenDay = parseWindow(json.seven_day);

    const scoped = [];
    for (const [field, name] of SCOPED_FIELDS) {
        const window = parseWindow(json[field]);
        if (window)
            scoped.push({name, ...window});
    }
    scoped.push(...parseScopedLimits(json.limits, SCOPED_FIELDS.map(([, name]) => name.toLowerCase())));

    if (!fiveHour && !sevenDay && scoped.length === 0)
        return null;
    return {fiveHour, sevenDay, scoped};
}
