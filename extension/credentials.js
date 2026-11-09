// Funções puras sobre o conteúdo de .credentials.json e cabeçalhos HTTP. Sem imports de gi://.

const EXPIRY_MARGIN_MS = 30_000;
// Abaixo disto o valor está em segundos, não em milissegundos (1e11 ms = 1973).
const SECONDS_THRESHOLD = 1e11;

/**
 * @param {unknown} json conteúdo decodificado de .credentials.json
 * @param {number} nowMs
 * @returns {{status: 'ok', accessToken: string, subscriptionType: string|null, rateLimitTier: string|null}
 *   | {status: 'not-logged-in'} | {status: 'expired'}}
 */
export function evaluateCredentials(json, nowMs) {
    const oauth = json?.claudeAiOauth;
    if (oauth === null || typeof oauth !== 'object')
        return {status: 'not-logged-in'};
    const {accessToken} = oauth;
    if (typeof accessToken !== 'string' || accessToken === '')
        return {status: 'not-logged-in'};

    if (typeof oauth.expiresAt === 'number' && Number.isFinite(oauth.expiresAt)) {
        const expiresMs = oauth.expiresAt < SECONDS_THRESHOLD ? oauth.expiresAt * 1000 : oauth.expiresAt;
        if (expiresMs < nowMs + EXPIRY_MARGIN_MS)
            return {status: 'expired'};
    }

    return {
        status: 'ok',
        accessToken,
        subscriptionType: typeof oauth.subscriptionType === 'string' ? oauth.subscriptionType : null,
        rateLimitTier: typeof oauth.rateLimitTier === 'string' ? oauth.rateLimitTier : null,
    };
}

/** "Max 20x", "Max", "Pro"; vazio se desconhecido. */
export function planLabel(subscriptionType, rateLimitTier) {
    const type = (subscriptionType ?? '').toLowerCase();
    if (type === '')
        return '';
    const name = type.charAt(0).toUpperCase() + type.slice(1);
    const multiplier = /(\d+x)$/.exec(rateLimitTier ?? '');
    return type === 'max' && multiplier ? `${name} ${multiplier[1]}` : name;
}

/** Retry-After (segundos ou data HTTP) -> segundos inteiros >= 0, ou null se ilegível. */
export function parseRetryAfter(value, nowMs) {
    if (typeof value !== 'string' || value.trim() === '')
        return null;
    const text = value.trim();
    if (/^\d+$/.test(text))
        return Number(text);
    const date = Date.parse(text);
    if (Number.isNaN(date))
        return null;
    return Math.max(0, Math.ceil((date - nowMs) / 1000));
}
