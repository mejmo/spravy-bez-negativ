<p align="center"><img src="docs/logo.png" alt="Logo Správy bez negatív" width="112"></p>

<h1 align="center">Správy bez negatív</h1>

<p align="center">Chrome rozšírenie, ktoré na spravodajskom webe skryje negatívne a psychicky zaťažujúce správy.</p>

<p align="center"><img src="docs/screenshots/vysledok.jpg" alt="Titulka po filtrovaní" width="760"></p>

## Stiahnutie

**[Stiahnuť rozšírenie (ZIP)](https://github.com/mejmo/spravy-bez-negativ/releases/latest/download/spravy-bez-negativ.zip)**
· [všetky verzie](https://github.com/mejmo/spravy-bez-negativ/releases)

Inštalácia:
1. Rozbaliť ZIP do ľubovoľného priečinka.
2. Otvoriť `chrome://extensions` a zapnúť **Developer mode**.
3. Kliknúť na **Load unpacked** a vybrať rozbalený priečinok.

> Repozitár je súkromný, takže odkaz funguje len po prihlásení na GitHub s prístupom k nemu.

## Čo robí

- Nájde správy (dlaždice článkov aj príspevky „Minúta po minúte“, vrátane widgetu v shadow DOM),
  pošle ich titulky na vyhodnotenie a negatívne skryje.
- Tlačidlo „Zobraziť skryté správy“ ukáže pôvodný web s farebným označením hodnotenia.
- Skrýva reklamné bloky.
- Štatistiky (popup po kliku na ikonu): ušetrený „mentálny damage“, porovnanie s rozšírením a bez neho.

## Podporované weby

- dennikn.sk (vrátane poddomén `www.dennikn.sk` a `e.dennikn.sk`)

## Ukážky

### Porovnanie s pôvodným webom

Tlačidlo vľavo dole zobrazí pôvodný web a označí hodnotenie každej správy:
červená = negatívne (skryté), žltá = neutrálne, zelená = pozitívne.

<p align="center"><img src="docs/screenshots/porovnanie.jpg" alt="Pôvodný web s označením hodnotenia" width="760"></p>

### Štatistiky

<img src="docs/screenshots/statistiky.png" alt="Štatistiky" width="320">

## Spustenie zo zdrojového kódu

1. `chrome://extensions` → zapnúť Developer mode → **Load unpacked** → vybrať tento priečinok.
2. Otvoriť spravodajský web. Netreba žiadny kľúč.

## Súbory

| Súbor | Účel |
|---|---|
| `manifest.json` | oprávnenia a registrácia skriptov |
| `icons/` | ikony rozšírenia (16, 32, 48, 128 px) a zdroj `icon.svg` |
| `background.js` | klient AI proxy (installId, dávky, validácia odpovede) |
| `content.js` | hľadanie správ, skrývanie, indikátor načítania, tlačidlo |
| `stats.html` / `stats.js` | popup so štatistikami |
| `options.html` / `options.js` | nastavenia |

## Dáta

Na proxy sa posielajú len titulky (alebo úvodné vety krátkych príspevkov), ich ID a anonymné ID inštalácie.
Hodnotenia a štatistiky sa ukladajú lokálne v `chrome.storage.local`.
