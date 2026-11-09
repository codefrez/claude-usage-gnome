import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {ClaudeUsageIndicator} from './indicator.js';
import {UsageClient} from './usageClient.js';

// Evita rajadas de "Atualizar agora": o endpoint responde 429 quando recebe chamadas demais.
const MIN_MANUAL_GAP_MS = 15_000;

export default class ClaudeUsageExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._client = new UsageClient({userAgent: `${this.uuid}/1.0`});
        this._timeoutId = null;
        this._inflight = false;
        this._lastAttemptMs = 0;
        this._notBeforeMs = 0;
        this._lastUsage = null;
        this._updatedAt = null;
        this._plan = '';
        this._email = null;
        this._result = {status: 'loading', message: '', retryAfter: null};

        this._indicator = new ClaudeUsageIndicator({
            name: this.metadata.name,
            onRefresh: () => this._refresh({manual: true}),
            onPreferences: () => this.openPreferences(),
        });
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        this._settingsIds = [
            this._settings.connect('changed::refresh-interval-minutes', () => this._schedule()),
            this._settings.connect('changed::display-mode', () => this._render()),
            this._settings.connect('changed::show-weekly', () => this._render()),
            this._settings.connect('changed::panel-detail', () => this._render()),
        ];

        this._render();
        this._refresh();
    }

    disable() {
        if (this._timeoutId) {
            GLib.Source.remove(this._timeoutId);
            this._timeoutId = null;
        }
        for (const id of this._settingsIds ?? [])
            this._settings.disconnect(id);
        this._settingsIds = null;

        this._client?.destroy();
        this._client = null;
        this._indicator?.destroy();
        this._indicator = null;
        this._settings = null;
        this._lastUsage = null;
        this._email = null;
    }

    _render() {
        this._indicator?.update({
            status: this._result.status,
            message: this._result.message,
            retryAfter: this._result.retryAfter,
            plan: this._plan,
            email: this._email,
            usage: this._lastUsage,
            updatedAt: this._updatedAt,
            mode: this._settings.get_string('display-mode'),
            showWeekly: this._settings.get_boolean('show-weekly'),
            detail: this._settings.get_string('panel-detail'),
        });
    }

    /** Agenda a próxima consulta; respeita o intervalo configurado e o Retry-After. */
    _schedule() {
        if (this._timeoutId)
            GLib.Source.remove(this._timeoutId);
        const intervalS = this._settings.get_int('refresh-interval-minutes') * 60;
        const waitS = Math.ceil((this._notBeforeMs - Date.now()) / 1000);
        this._timeoutId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, Math.max(intervalS, waitS), () => {
            this._timeoutId = null;
            this._refresh();
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh({manual = false} = {}) {
        if (this._inflight)
            return;
        if (manual && Date.now() - this._lastAttemptMs < MIN_MANUAL_GAP_MS)
            return;
        this._inflight = true;
        this._lastAttemptMs = Date.now();

        const client = this._client;
        let result;
        try {
            result = await client.fetch();
            if (this._client !== client)
                return;
            this._email ??= await client.readAccountEmail();
        } catch (e) {
            if (this._client !== client)
                return;
            console.error(`${this.uuid}: erro inesperado: ${e.message}`);
            result = {status: 'error', message: 'Erro inesperado', retryAfter: null, plan: '', usage: null};
        } finally {
            if (this._client === client)
                this._inflight = false;
        }
        if (this._client !== client)
            return;

        this._result = result;
        if (result.plan)
            this._plan = result.plan;
        if (result.usage) {
            this._lastUsage = result.usage;
            this._updatedAt = new Date();
        }
        this._notBeforeMs = result.retryAfter ? Date.now() + result.retryAfter * 1000 : 0;

        this._render();
        this._schedule();
    }
}
