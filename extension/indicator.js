// Só desenho: recebe o estado pronto e renderiza as barras da barra superior e o menu.

import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import {formatClock, formatPercent, formatRemaining, levelFor} from './format.js';

const BAR_WIDTH = 30;
const BAR_HEIGHT = 5;
const DIMMED_OPACITY = 110;

class UsageBar {
    constructor() {
        this.actor = new St.Widget({
            style_class: 'claude-usage-bar',
            width: BAR_WIDTH,
            height: BAR_HEIGHT,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._fill = new St.Widget({style_class: 'claude-usage-bar-fill', height: BAR_HEIGHT});
        this.actor.add_child(this._fill);
        this.set(0, 'normal');
    }

    set(fraction, level) {
        const width = Math.round(BAR_WIDTH * Math.min(1, Math.max(0, fraction)));
        this._fill.visible = width > 0;
        this._fill.set_width(width);
        for (const name of ['warn', 'critical'])
            this._fill.remove_style_class_name(`level-${name}`);
        if (level !== 'normal')
            this._fill.add_style_class_name(`level-${level}`);
    }
}

// Um trecho do painel: rótulo, barra, porcentagem e (opcional) tempo até o reset.
class PanelSegment {
    constructor(name) {
        this.actor = new St.BoxLayout({style_class: 'claude-usage-segment', y_align: Clutter.ActorAlign.CENTER});
        this._name = new St.Label({text: name, style_class: 'claude-usage-segment-name', y_align: Clutter.ActorAlign.CENTER});
        this._bar = new UsageBar();
        this._value = new St.Label({style_class: 'claude-usage-segment-value', y_align: Clutter.ActorAlign.CENTER});
        this._reset = new St.Label({style_class: 'claude-usage-segment-reset', y_align: Clutter.ActorAlign.CENTER});
        for (const child of [this._name, this._bar.actor, this._value, this._reset])
            this.actor.add_child(child);
    }

    /** detail: 'bars' | 'percent' | 'full' */
    set(window, {mode, detail, now}) {
        this._name.visible = detail !== 'bars';
        this._value.visible = detail !== 'bars';
        this._reset.visible = detail === 'full';

        for (const name of ['warn', 'critical'])
            this._value.remove_style_class_name(`level-${name}`);
        if (!window) {
            this._bar.set(0, 'normal');
            this._value.text = '–';
            this._reset.text = '';
            return;
        }
        const level = levelFor(window.utilization);
        const shown = mode === 'remaining' ? 100 - window.utilization : window.utilization;
        this._bar.set(shown / 100, level);
        this._value.text = formatPercent(window.utilization, mode);
        if (level !== 'normal')
            this._value.add_style_class_name(`level-${level}`);
        this._reset.text = formatRemaining(window.resetsAt, now);
    }
}

class UsageRow extends PopupMenu.PopupBaseMenuItem {
    static {
        GObject.registerClass(this);
    }

    constructor(name, {scoped = false} = {}) {
        super({reactive: false, can_focus: false});
        this._name = new St.Label({
            text: name,
            style_class: `claude-usage-row-name${scoped ? ' scoped' : ''}`,
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._percent = new St.Label({style_class: 'claude-usage-row-percent', y_align: Clutter.ActorAlign.CENTER});
        this._reset = new St.Label({style_class: 'claude-usage-row-reset', y_align: Clutter.ActorAlign.CENTER});
        this.add_child(this._name);
        this.add_child(this._percent);
        this.add_child(this._reset);
    }

    setWindow(window, mode, now) {
        this._percent.text = formatPercent(window.utilization, mode);
        const remaining = formatRemaining(window.resetsAt, now);
        this._reset.text = remaining ? `reinicia em ${remaining}` : '';
    }
}

function textItem(styleClass) {
    const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
    const label = new St.Label({style_class: styleClass, y_align: Clutter.ActorAlign.CENTER});
    item.add_child(label);
    return {item, label};
}

export class ClaudeUsageIndicator extends PanelMenu.Button {
    static {
        GObject.registerClass(this);
    }

    /**
     * @param {object} options
     * @param {string} options.name
     * @param {() => void} options.onRefresh
     * @param {() => void} options.onPreferences
     */
    constructor({name, onRefresh, onPreferences}) {
        super(0.0, name, false);
        this._state = null;

        this._box = new St.BoxLayout({style_class: 'claude-usage-box', y_align: Clutter.ActorAlign.CENTER});
        this._fiveHourSegment = new PanelSegment('5h');
        this._weekSegment = new PanelSegment('7d');
        this._dot = new St.Widget({style_class: 'claude-usage-dot', y_align: Clutter.ActorAlign.CENTER, visible: false});
        this._box.add_child(this._fiveHourSegment.actor);
        this._box.add_child(this._weekSegment.actor);
        this._title = new St.Label({text: 'Claude', y_align: Clutter.ActorAlign.CENTER});
        this._box.add_child(this._title);
        this._box.add_child(this._dot);
        this.add_child(this._box);

        const header = textItem('claude-usage-header');
        this._headerLabel = header.label;
        const email = textItem('claude-usage-dim');
        this._emailItem = email.item;
        this._emailLabel = email.label;
        const status = textItem('claude-usage-warning');
        this._statusItem = status.item;
        this._statusLabel = status.label;
        this._fiveHourRow = new UsageRow('Janela de 5 horas');
        this._weekRow = new UsageRow('Semana');
        this._scopedSection = new PopupMenu.PopupMenuSection();
        const updated = textItem('claude-usage-dim');
        this._updatedItem = updated.item;
        this._updatedLabel = updated.label;

        const menu = this.menu;
        menu.addMenuItem(header.item);
        menu.addMenuItem(this._emailItem);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this._statusItem);
        menu.addMenuItem(this._fiveHourRow);
        menu.addMenuItem(this._weekRow);
        menu.addMenuItem(this._scopedSection);
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());
        menu.addMenuItem(this._updatedItem);
        menu.addAction('Atualizar agora', onRefresh);
        menu.addAction('Preferências…', onPreferences);

        // Reescreve os tempos de reset com a hora de agora ao abrir o menu.
        menu.connect('open-state-changed', (_menu, open) => {
            if (open && this._state)
                this.update(this._state);
        });
    }

    /**
     * @param {object} state
     * @param {string} state.status 'loading' | 'ok' | 'not-logged-in' | 'expired' | 'rate-limited' | 'error'
     * @param {string} state.message
     * @param {string} state.plan
     * @param {string|null} state.email
     * @param {object|null} state.usage última leitura boa (parseUsage), mantida em caso de erro
     * @param {Date|null} state.updatedAt
     * @param {number|null} state.retryAfter segundos
     * @param {'used'|'remaining'} state.mode
     * @param {boolean} state.showWeekly
     * @param {'bars'|'percent'|'full'} state.detail quanto mostrar no painel
     */
    update(state) {
        this._state = state;
        const now = new Date();
        const {status, usage, mode} = state;
        const failing = status !== 'ok' && status !== 'loading';

        this._box.opacity = status === 'ok' ? 255 : DIMMED_OPACITY;
        this._dot.visible = failing;
        this._weekSegment.actor.visible = state.showWeekly;
        this._title.visible = state.detail === 'bars';

        const segmentOptions = {mode, detail: state.detail, now};
        this._fiveHourSegment.set(usage?.fiveHour ?? null, segmentOptions);
        this._weekSegment.set(usage?.sevenDay ?? null, segmentOptions);

        this._headerLabel.text = state.plan ? `Claude Code · ${state.plan}` : 'Claude Code';
        this._emailItem.visible = Boolean(state.email);
        this._emailLabel.text = state.email ?? '';

        let statusText = status === 'loading' ? 'Carregando…' : status === 'ok' ? '' : state.message;
        if (status === 'rate-limited' && state.retryAfter)
            statusText += ` · tenta de novo em ${formatRemaining(new Date(now.getTime() + state.retryAfter * 1000), now)}`;
        this._statusItem.visible = statusText !== '';
        this._statusLabel.text = statusText;

        this._fiveHourRow.visible = Boolean(usage?.fiveHour);
        if (usage?.fiveHour)
            this._fiveHourRow.setWindow(usage.fiveHour, mode, now);
        this._weekRow.visible = Boolean(usage?.sevenDay);
        if (usage?.sevenDay)
            this._weekRow.setWindow(usage.sevenDay, mode, now);

        this._scopedSection.removeAll();
        for (const scoped of usage?.scoped ?? []) {
            const row = new UsageRow(scoped.name, {scoped: true});
            row.setWindow(scoped, mode, now);
            this._scopedSection.addMenuItem(row);
        }

        this._updatedItem.visible = Boolean(state.updatedAt);
        if (state.updatedAt) {
            const when = formatClock(state.updatedAt);
            this._updatedLabel.text = failing ? `Última leitura às ${when}` : `Atualizado às ${when}`;
        }
    }
}
