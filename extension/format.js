// Funções puras de formatação. Sem imports de gi://.

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/** Tempo até o reset: "40m", "2h 10m", "3d". Vazio se a data for desconhecida. */
export function formatRemaining(resetsAt, now = new Date()) {
    if (!(resetsAt instanceof Date))
        return '';
    const ms = resetsAt.getTime() - now.getTime();
    if (ms <= 0)
        return '0m';
    if (ms < HOUR)
        return `${Math.max(1, Math.ceil(ms / MINUTE))}m`;
    if (ms < DAY) {
        const hours = Math.floor(ms / HOUR);
        const minutes = Math.floor((ms % HOUR) / MINUTE);
        return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
    }
    return `${Math.floor(ms / DAY)}d`;
}

/** Horário local de um instante: "03:00". */
export function formatClock(date) {
    if (!(date instanceof Date))
        return '';
    const pad = n => String(n).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Porcentagem inteira; mode "used" mostra o usado, "remaining" o que sobra. */
export function formatPercent(utilization, mode = 'used') {
    const value = mode === 'remaining' ? 100 - utilization : utilization;
    return `${Math.round(Math.min(100, Math.max(0, value)))}%`;
}

/** Nível de alerta pela utilização: "normal" até 70, "warn" até 90, "critical" acima. */
export function levelFor(utilization) {
    if (utilization > 90)
        return 'critical';
    if (utilization > 70)
        return 'warn';
    return 'normal';
}
