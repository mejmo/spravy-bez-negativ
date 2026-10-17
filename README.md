# Správy bez negatív

Chrome rozšírenie (Manifest V3), ktoré na spravodajskom webe skrýva negatívne a psychicky zaťažujúce správy.

## Podporované weby
- dennikn.sk (vrátane poddomén `www.dennikn.sk` a `e.dennikn.sk`)

## Čo robí
- Nájde správy (dlaždice článkov aj príspevky „Minúta po minúte“, vrátane widgetu v shadow DOM),
  pošle ich titulky na vyhodnotenie a negatívne skryje.
- Tlačidlo „Zobraziť skryté správy“ ukáže pôvodný web s farebným označením hodnotenia.
- Skrýva reklamné bloky.
- Štatistiky (popup po kliku na ikonu): ušetrený „mentálny damage“, porovnanie s rozšírením a bez neho.

## Spustenie lokálne
1. `chrome://extensions` → zapnúť Developer mode → **Load unpacked** → vybrať tento priečinok.
2. Otvoriť spravodajský web. Netreba žiadny kľúč.

## Súbory
| Súbor | Účel |
|---|---|
| `manifest.json` | oprávnenia a registrácia skriptov |
| `background.js` | klient AI proxy (installId, dávky, validácia odpovede) |
| `content.js` | hľadanie správ, skrývanie, indikátor načítania, tlačidlo |
| `stats.html` / `stats.js` | popup so štatistikami |
| `options.html` / `options.js` | nastavenia |

## Dáta
Na proxy sa posielajú len titulky (alebo úvodné vety krátkych príspevkov), ich ID a anonymné ID inštalácie.
Hodnotenia a štatistiky sa ukladajú lokálne v `chrome.storage.local`.
