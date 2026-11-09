# Claude Usage no GNOME Shell

POC: uma extensão do GNOME Shell que mostra, na barra superior, o uso da assinatura do Claude Code (janela de 5 horas e limite semanal), no estilo do widget do TokenTray para Windows.

Este documento é o ponto de partida para quem for implementar. Ele registra o que já foi pesquisado, as decisões tomadas, a estrutura planejada e o resultado esperado.

---

## 1. Objetivo

Ver de relance, na barra superior do GNOME, quanto da janela de 5 horas e do limite semanal da assinatura Claude já foi usado, e quando cada uma reinicia.

Escopo do POC:

- Janela de 5 horas (`five_hour`).
- Limite semanal geral (`seven_day`).
- Limites semanais por modelo (`seven_day_opus`, `seven_day_sonnet` e entradas `limits` do tipo `weekly_scoped`), exibidos no menu, não na barra.
- Apenas assinatura do Claude Code (Pro, Max 5x, Max 20x). Chave de API não entra no escopo, porque não tem janela de 5 horas nem limite semanal de plano.

Fora de escopo nesta fase:

- Outras ferramentas (Codex, Cursor, Gemini etc.), embora o TokenTray as suporte.
- Empacotamento (extensions.gnome.org, Flatpak).
- Suporte a Windows ou macOS.

---

## 2. Ambiente alvo

| Item | Valor |
| --- | --- |
| Sistema | Fedora 44 |
| GNOME Shell | 45 a 50 (desenvolvido e testado no 50.6; ver seção 7.1) |
| Sessão | Wayland (padrão do Fedora) |
| Claude Code | instalado e logado no mesmo usuário (`vfrez`) |

Extensões do GNOME Shell são acopladas à versão do shell. O código usa só APIs estáveis do 45 em diante (módulos ESM, `Extension`/`ExtensionPreferences`, Soup 3, libadwaita 1.4). Versões anteriores ao 45 usam outro sistema de módulos (`imports.*`) e exigiriam um pacote separado; estão fora do escopo.

---

## 3. Por que uma extensão e não um app GTK

- A barra superior só aceita itens de extensões do GNOME Shell. Um app GTK normal não aparece ali.
- A alternativa seria um indicador StatusNotifierItem/AppIndicator, que exige o pacote `gnome-shell-extension-appindicator`. Não vem instalado por padrão no Fedora, então foi descartada para não criar uma dependência extra.
- Uma única extensão em GJS basta: ela lê as credenciais, faz a requisição HTTP com Soup 3 e desenha o indicador com St. Não precisa de Python nem de processo separado.

---

## 4. Fonte dos dados (pesquisada)

A pesquisa foi feita lendo o código-fonte do projeto open source [TokenTray](https://github.com/emrecengdev/tokentray) (MIT), arquivo `src/TokenTray.Core/Providers.cs`, classe `ClaudeProvider`. **Não copiar código de lá**: usar apenas como referência do protocolo. A implementação aqui deve ser escrita do zero.

### 4.1 Não existe API oficial

Não há endpoint público e documentado da Anthropic para o uso de assinatura (Pro/Max). O endpoint usado abaixo é interno e pode mudar sem aviso. Por isso o app precisa tratar qualquer resposta inesperada sem quebrar.

### 4.2 Credenciais

Arquivo: `~/.claude/.credentials.json` (ou `$CLAUDE_CONFIG_DIR/.credentials.json`, se a variável existir).

Campos usados:

- `claudeAiOauth.accessToken`: token Bearer.
- `claudeAiOauth.expiresAt`: expiração em milissegundos Unix.
- `claudeAiOauth.subscriptionType`: tipo do plano.
- `claudeAiOauth.rateLimitTier`: nível do plano (ex.: `default_claude_max_20x`).

Conta (nome/e-mail, opcional para exibir no menu): arquivo `~/.claude.json`, chave `oauthAccount` (`accountUuid`, `emailAddress`).

### 4.3 Requisição

```
GET https://api.anthropic.com/api/oauth/usage
Authorization: Bearer <accessToken>
anthropic-beta: oauth-2025-04-20
User-Agent: <nome-da-extensao>/1.0
```

### 4.4 Resposta (campos relevantes)

Cada janela é um objeto com `utilization` (0 a 100) e `resets_at` (data ISO):

| Campo | Significado | Uso no app |
| --- | --- | --- |
| `five_hour` | janela de 5 horas | barra principal |
| `seven_day` | limite semanal geral | barra principal |
| `seven_day_opus` | semanal, Opus | menu |
| `seven_day_sonnet` | semanal, Sonnet | menu |
| `limits[]` com `kind: "weekly_scoped"` | semanal por modelo (formato mais novo) | menu; campo `percent`, nome em `scope.model.display_name` |

Clampar `utilization` entre 0 e 100. Entradas de `limits` com nome de modelo já presente em `seven_day_*` não devem duplicar.

### 4.5 Erros e limites de taxa

| Situação | Comportamento esperado |
| --- | --- |
| Token ausente ou sem `claudeAiOauth` | estado "não logado": "Rode `claude` e faça login" |
| Token expirado (`expiresAt` menor que agora + 30 s) | estado "login expirado", **não** tentar renovar; "Abra o Claude Code uma vez" |
| `401` ou `403` | igual ao anterior |
| `429` | respeitar `Retry-After`; não consultar de novo antes disso; manter a última leitura |
| Outros erros de rede ou HTTP | mostrar erro discreto; manter a última leitura, esmaecida |
| JSON sem nenhuma janela reconhecida | "resposta sem janelas de uso" |

Intervalo padrão de consulta: 2 minutos (o endpoint responde com `429` quando recebe chamadas demais).

---

## 5. Estrutura planejada

Pasta da extensão no repositório: `extension/`. A instalação final vai para `~/.local/share/gnome-shell/extensions/<uuid>/`.

```
claude-usage-gnome/
├── README.md                 este documento
└── extension/
    ├── metadata.json         uuid, nome, descrição, shell-version
    ├── extension.js          ponto de entrada: cria e remove o indicador
    ├── indicator.js          PanelMenu.Button, barras e menu
    ├── usageClient.js        lê credenciais, faz a requisição, interpreta a resposta
    ├── parser.js             funções puras: JSON → modelo de janelas (testável sem o shell)
    ├── format.js             funções puras: horário de reset ("03:00", "2d", "40m"), porcentagens
    ├── prefs.js              tela de preferências (intervalo, mostrar "usado" ou "restante")
    ├── schemas/
    │   ├── org.gnome.shell.extensions.claude-usage.gschema.xml
    │   └── gschemas.compiled (gerado, não versionar)
    ├── stylesheet.css        cores e tamanhos das barras
    └── tests/
        └── parser.test.js    testes das funções puras, rodados fora do shell
```

UUID: `claude-usage@codefrez`.

### 5.1 `metadata.json` (esboço)

```json
{
  "uuid": "claude-usage@codefrez",
  "name": "Claude Usage",
  "description": "Mostra o uso da janela de 5 horas e semanal do Claude Code na barra superior.",
  "shell-version": ["45", "46", "47", "48", "49", "50"],
  "settings-schema": "org.gnome.shell.extensions.claude-usage",
  "url": ""
}
```

### 5.2 Responsabilidades

- `extension.js`: classe `Extension` com `enable()` (criar `ClaudeUsageIndicator`, iniciar timer) e `disable()` (parar timer, destruir indicador, liberar referências). **Não** deixar timers ou conexões ativos após `disable()`.
- `usageClient.js`: sem lógica de interface. Retorna um objeto com `status` (`ok`, `not-logged-in`, `expired`, `rate-limited`, `error`), `windows` e `retryAfter`.
- `parser.js`: funções puras. Recebe o JSON já lido e devolve janelas normalizadas. É a parte que deve ter testes.
- `indicator.js`: só desenho. Recebe o estado e renderiza as duas barras e o menu.

---

## 6. Resultado esperado

### 6.1 Barra superior

Um item pequeno no painel, à direita, com duas barras finas lado a lado, uma para a janela de 5 horas e outra para a semana:

```
[ ▮▮▮▯▯ ▮▮▯▯▯ ]  Claude
```

Cores (sugestão, pode ajustar):

- Até 70%: cor neutra do tema.
- 70% a 90%: âmbar.
- Acima de 90%: vermelho.

Quando o status não for `ok`, a barra fica esmaecida e aparece um ponto âmbar ao lado.

### 6.2 Menu (ao clicar)

```
Claude Code · Max 20x
conta@exemplo.com

Janela de 5 horas        42%   reinicia em 40m
Semana                   18%   reinicia em 3d
  Opus                    9%   reinicia em 3d
  Sonnet                  4%   reinicia em 3d

Atualizado às 14:32            [Atualizar agora]
Preferências...
```

### 6.3 Dica ao passar o mouse

Opcional nesta fase. Se o GNOME permitir, mostrar a mesma informação resumida como tooltip.

### 6.4 Preferências

- Intervalo de atualização (mínimo 2 minutos).
- Exibir porcentagem como "usado" ou "restante".
- Mostrar ou não a barra semanal na barra superior.

---

## 7. Como testar

**Nunca** testar pela primeira vez na sessão principal. Uma extensão com erro pode travar o shell.

1. Testes unitários do `parser.js` e do `format.js`, rodados com Node (`node --test extension/tests/*.test.js`), sem depender do shell. Os módulos que importam `gi://` não devem ser carregados nesses testes.
2. Sessão isolada para testar a extensão. No GNOME 50 o `--nested` não existe mais (só `--devkit`, que exige o pacote `mutter-devkit`). Sem ele, use um shell headless numa sessão D-Bus própria:
   ```
   export XDG_CONFIG_HOME=$(mktemp -d)   # isola o dconf da sessão principal
   dbus-run-session gnome-shell --headless --wayland --no-x11 --virtual-monitor 1280x720
   ```
   Em outro terminal, com o mesmo `DBUS_SESSION_BUS_ADDRESS`, ative com `gnome-extensions enable claude-usage@codefrez`. Não há janela visível; para ver o resultado, capture a tela de dentro do shell com `Shell.Screenshot` (o D-Bus de screenshot é bloqueado fora da sessão real).
3. Verificar logs com `journalctl --user -f /usr/bin/gnome-shell` ou `journalctl -f | grep -i claude-usage`.
4. Testar os estados de erro simulando as credenciais: renomear temporariamente o arquivo, ou editar `expiresAt` para o passado, e confirmar o texto e a cor do estado. Restaurar depois.
5. Só depois de passar nos itens acima, ativar na sessão principal.

### 7.1 Testar em outras versões do GNOME

`shell-version` declara 45 a 50. Cada versão nova precisa de pelo menos um teste manual: ativar, abrir o menu, abrir as preferências e conferir o journal.

| GNOME | Distro para testar | Sessão isolada |
| --- | --- | --- |
| 45 | Fedora 39 | `gnome-shell --nested --wayland` |
| 46 | Fedora 40, Ubuntu 24.04 | `gnome-shell --nested --wayland` |
| 47 | Fedora 41, RHEL 10 | `gnome-shell --nested --wayland` |
| 48 | Fedora 42, Debian 13 | `gnome-shell --nested --wayland` |
| 49 | Fedora 43 | `gnome-shell --devkit` (pacote `mutter-devkit`) |
| 50 | Fedora 44 | `--devkit` ou headless (item 2 acima) |

O jeito mais simples é uma VM com a distro da tabela: instalar o zip de `dist/` com `gnome-extensions install --force`, sair e entrar de novo na sessão e ativar.

O que muda entre essas versões e foi conferido no código: `add_actor()` saiu no 46 (o código usa `add_child()`), `Clutter.Color` saiu no 47 (não é usado), `St.BoxLayout.vertical` ficou obsoleto no 48 (não é usado).

Empacotar: `gnome-extensions pack extension --out-dir dist --force --extra-source=indicator.js --extra-source=usageClient.js --extra-source=parser.js --extra-source=format.js --extra-source=credentials.js`.

Ferramentas úteis já instaladas no ambiente: `gnome-extensions`, `journalctl`. Verificar se `node` está disponível para os testes unitários.

---

## 8. Riscos e cuidados

- **Endpoint interno.** Pode mudar ou exigir outro header. Tratar a resposta com defensiva e não assumir a presença de campos.
- **Token sensível.** Nunca logar o `accessToken`, nem na saída do journal, nem em arquivos de cache. O cache, se houver, deve guardar só as janelas e as datas.
- **Não gravar credenciais.** O app só lê. Não renovar nem reescrever `.credentials.json`.
- **Limite de taxa.** Respeitar `Retry-After` mesmo após reiniciar o shell. Guardar o instante de liberação em arquivo de cache, se necessário.
- **Versão do GNOME.** Quebras entre versões são comuns. Antes de incluir uma versão nova em `shell-version`, testar nela (seção 7.1) e conferir o guia de migração em https://gjs.guide/extensions/upgrading/.
- **Tema claro.** O texto do menu herda a cor do tema; não fixar `color: #ffffff` em itens do menu, senão some em tema claro.
- **Dependência de Soup 3.** Confirmar a importação com `gi://Soup?version=3.0` na versão 50.

---

## 9. Pontos a confirmar no início da implementação

- Versão exata da API de GJS e St para o GNOME 50 (conferir na documentação do GNOME Shell ou nas extensões oficiais, sem depender de memória).
- Se o `expiresAt` vem sempre em milissegundos no Linux (o TokenTray assume isso).
- Se o endpoint responde no Linux com a mesma estrutura do Windows. O TokenTray é testado no Windows, então a primeira requisição real no Fedora é o teste de verdade.
- Comportamento do `limits[]` quando o plano não tem limites por modelo.

---

## 10. Referências

- Código de referência (MIT, não copiar): https://github.com/emrecengdev/tokentray, em `src/TokenTray.Core/Providers.cs` (classe `ClaudeProvider`) e `src/TokenTray.Core/Pace.cs`.
- Credenciais do Claude Code: `~/.claude/.credentials.json`.
- Documentação de extensões do GNOME Shell: https://gjs.guide/extensions/ (conferir a versão).

---

## 11. Próximos passos

Status: passos 1 a 6 feitos e testados em shell headless isolado; resta o 7 (ativar na sessão principal). Instalação: `ln -s "$PWD/extension" ~/.local/share/gnome-shell/extensions/claude-usage@codefrez`, rodar `glib-compile-schemas extension/schemas` se `gschemas.compiled` não existir, e reiniciar a sessão (logout/login) para o shell descobrir a extensão.


1. Criar `extension/metadata.json` e um `extension.js` mínimo que só mostre um rótulo "Claude" na barra. Testar na sessão aninhada.
2. Implementar `parser.js` e `format.js` com testes.
3. Implementar `usageClient.js` e conectar ao indicador.
4. Desenhar as barras e o menu.
5. Adicionar preferências e schema.
6. Testar os estados de erro e o `429`.
7. Ativar na sessão principal e observar por um dia de uso real.
