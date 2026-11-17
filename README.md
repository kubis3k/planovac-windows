# Plánovač pro Windows

Desktopová aplikace týmového kalendáře Globaal Elevate (kalendar.globaalelevate.com).

**Stažení:** [Planovac-Setup.exe](https://github.com/kubis3k/planovac-windows/releases/latest/download/Planovac-Setup.exe)

- ikona u hodin, spouštění po startu Windows
- Ctrl+Alt+Mezerník = nový úkol
- upozornění na úkoly přiřazené tobě

Instalátor není podepsaný – Windows ukáže „Systém Windows ochránil váš počítač“ → Další informace → Přesto spustit.

## Nová verze
1. Zvyš `version` v `package.json`.
2. Releases → Draft a new release → tag `v<verze>` → Publish.
3. GitHub Actions sestaví `Planovac-Setup.exe` a přiloží ho k vydání (cca 5 min).
