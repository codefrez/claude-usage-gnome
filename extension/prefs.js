import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const MODES = ['used', 'remaining'];
const DETAILS = ['bars', 'percent', 'full'];

export default class ClaudeUsagePreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window._settings = settings;

        const page = new Adw.PreferencesPage({title: 'Claude Usage', icon_name: 'preferences-system-symbolic'});
        const group = new Adw.PreferencesGroup({title: 'Exibição'});
        page.add(group);

        const interval = new Adw.SpinRow({
            title: 'Intervalo de atualização',
            subtitle: 'Em minutos. O mínimo é 2: o endpoint recusa chamadas demais.',
            adjustment: new Gtk.Adjustment({lower: 2, upper: 60, step_increment: 1, page_increment: 5}),
        });
        settings.bind('refresh-interval-minutes', interval, 'value', 0);
        group.add(interval);

        const mode = new Adw.ComboRow({
            title: 'Porcentagem',
            subtitle: 'Mostrar quanto já foi usado ou quanto resta.',
            model: Gtk.StringList.new(['Usado', 'Restante']),
            selected: Math.max(0, MODES.indexOf(settings.get_string('display-mode'))),
        });
        mode.connect('notify::selected', () => settings.set_string('display-mode', MODES[mode.selected]));
        group.add(mode);

        const detail = new Adw.ComboRow({
            title: 'Detalhe na barra superior',
            subtitle: 'Só barras, com porcentagem, ou também com o tempo até o reset.',
            model: Gtk.StringList.new(['Só barras', 'Barras e porcentagem', 'Completo (com tempo até o reset)']),
            selected: Math.max(0, DETAILS.indexOf(settings.get_string('panel-detail'))),
        });
        detail.connect('notify::selected', () => settings.set_string('panel-detail', DETAILS[detail.selected]));
        group.add(detail);

        const weekly = new Adw.SwitchRow({title: 'Barra semanal na barra superior'});
        settings.bind('show-weekly', weekly, 'active', 0);
        group.add(weekly);

        window.add(page);
    }
}
