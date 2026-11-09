// Lê as credenciais do Claude Code e consulta o endpoint de uso. Sem lógica de interface.
// O accessToken vive só em variáveis locais de fetch(): nunca é logado, guardado nem renovado.

import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {evaluateCredentials, parseRetryAfter, planLabel} from './credentials.js';
import {parseUsage} from './parser.js';

Gio._promisify(Soup.Session.prototype, 'send_and_read_async', 'send_and_read_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage';
const DEFAULT_RETRY_AFTER_S = 120;
const REQUEST_TIMEOUT_S = 15;

const decoder = new TextDecoder();

// O cache guarda só o instante de liberação do 429, nunca credenciais nem leituras.
function defaultStateFile() {
    return GLib.build_filenamev([GLib.get_user_cache_dir(), 'claude-usage', 'state.json']);
}

async function readJson(path, cancellable) {
    const [contents] = await Gio.File.new_for_path(path).load_contents_async(cancellable);
    return JSON.parse(decoder.decode(contents));
}

export class UsageClient {
    /**
     * @param {object} [options]
     * @param {string} [options.userAgent]
     * @param {string} [options.url] só para testes contra um servidor local
     * @param {string} [options.configDir] padrão: $CLAUDE_CONFIG_DIR ou ~/.claude
     * @param {string} [options.stateFile] onde guardar o Retry-After entre reinícios do shell
     */
    constructor({userAgent = 'claude-usage-gnome/1.0', url = USAGE_URL, configDir = null, stateFile = null} = {}) {
        this._url = url;
        this._configDir = configDir ?? GLib.getenv('CLAUDE_CONFIG_DIR') ?? GLib.build_filenamev([GLib.get_home_dir(), '.claude']);
        this._session = new Soup.Session({user_agent: userAgent, timeout: REQUEST_TIMEOUT_S});
        this._cancellable = new Gio.Cancellable();
        this._stateFile = stateFile ?? defaultStateFile();
        this._retryUntilMs = this._loadRetryUntil();
    }

    _loadRetryUntil() {
        try {
            const [, bytes] = GLib.file_get_contents(this._stateFile);
            const value = JSON.parse(decoder.decode(bytes)).retryUntilMs;
            return Number.isFinite(value) ? value : 0;
        } catch (e) {
            return 0;
        }
    }

    _saveRetryUntil() {
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(this._stateFile), 0o700);
            GLib.file_set_contents(this._stateFile, JSON.stringify({retryUntilMs: this._retryUntilMs}));
        } catch (e) {
            // Sem cache o pior caso é uma requisição extra após reiniciar o shell.
        }
    }

    /**
     * @returns {Promise<{status: 'ok'|'not-logged-in'|'expired'|'rate-limited'|'error',
     *   usage: object|null, plan: string, retryAfter: number|null, message: string}>}
     *   usage é null quando status != ok; quem chama mantém a última leitura.
     */
    async fetch() {
        const result = (status, extra = {}) => ({
            status, usage: null, plan: '', retryAfter: null, message: '', ...extra,
        });

        const waitS = Math.ceil((this._retryUntilMs - Date.now()) / 1000);
        if (waitS > 0)
            return result('rate-limited', {retryAfter: waitS, message: 'Limite de requisições'});

        let credentials;
        try {
            const json = await readJson(GLib.build_filenamev([this._configDir, '.credentials.json']), this._cancellable);
            credentials = evaluateCredentials(json, Date.now());
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND))
                return result('not-logged-in', {message: 'Rode `claude` e faça login'});
            return result('error', {message: 'Credenciais ilegíveis'});
        }

        if (credentials.status === 'not-logged-in')
            return result('not-logged-in', {message: 'Rode `claude` e faça login'});
        if (credentials.status === 'expired')
            return result('expired', {message: 'Abra o Claude Code uma vez'});

        const plan = planLabel(credentials.subscriptionType, credentials.rateLimitTier);
        const message = Soup.Message.new('GET', this._url);
        const headers = message.get_request_headers();
        headers.append('Authorization', `Bearer ${credentials.accessToken}`);
        headers.append('anthropic-beta', 'oauth-2025-04-20');

        let bytes;
        try {
            bytes = await this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, this._cancellable);
        } catch (e) {
            if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                throw e;
            return result('error', {plan, message: 'Sem conexão com a Anthropic'});
        }

        // get_status() lança em códigos fora do enum Soup.Status (como 429); a propriedade devolve o número cru.
        const httpStatus = message.status_code;
        if (httpStatus === 401 || httpStatus === 403)
            return result('expired', {plan, message: 'Abra o Claude Code uma vez'});
        if (httpStatus === 429) {
            const retryAfter = parseRetryAfter(message.get_response_headers().get_one('Retry-After'), Date.now()) ?? DEFAULT_RETRY_AFTER_S;
            this._retryUntilMs = Date.now() + retryAfter * 1000;
            this._saveRetryUntil();
            return result('rate-limited', {plan, retryAfter, message: 'Limite de requisições'});
        }
        if (httpStatus < 200 || httpStatus >= 300)
            return result('error', {plan, message: `Erro HTTP ${httpStatus}`});

        let usage;
        try {
            usage = parseUsage(JSON.parse(decoder.decode(bytes.get_data())));
        } catch (e) {
            return result('error', {plan, message: 'Resposta ilegível'});
        }
        if (!usage)
            return result('error', {plan, message: 'Resposta sem janelas de uso'});
        return result('ok', {plan, usage});
    }

    /** Email da conta, se disponível em .claude.json; null caso contrário. */
    async readAccountEmail() {
        const candidates = [
            GLib.build_filenamev([this._configDir, '.claude.json']),
            GLib.build_filenamev([GLib.get_home_dir(), '.claude.json']),
        ];
        for (const path of candidates) {
            try {
                const email = (await readJson(path, this._cancellable)).oauthAccount?.emailAddress;
                if (typeof email === 'string')
                    return email;
            } catch (e) {
                if (e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    throw e;
            }
        }
        return null;
    }

    /** Cancela requisições em andamento e encerra a sessão. Chamar no disable(). */
    destroy() {
        this._cancellable.cancel();
        this._session.abort();
        this._session = null;
    }
}
