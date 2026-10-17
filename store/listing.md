# Záznam v Chrome Web Store: texty a podklady

Hotové texty na copy-paste do Developer Dashboardu. Obrázky sú v tomto priečinku.

## Základné údaje

| Pole | Hodnota |
|---|---|
| Názov | Správy bez negatív |
| Jazyk | slovenčina |
| Kategória | vyber v dashboarde podľa ponuky (napr. Productivity) |
| Webová stránka | https://mejmo.github.io/spravy-bez-negativ/ |
| Zásady ochrany súkromia (URL) | https://mejmo.github.io/spravy-bez-negativ/privacy.html |
| Podpora (URL) | https://github.com/mejmo/spravy-bez-negativ/issues |

## Krátky popis (max 132 znakov)

```
Skryje správy, čo ti môžu pokaziť náladu. Hodnotí ich AI a pôvodný web ukážeš jedným klikom.
```

## Detailný popis

```
Správy bez negatív skryje správy, ktoré ti môžu pokaziť náladu, a nechá ti len to, čo ťa zbytočne nezaťaží.

AKO TO FUNGUJE
• Rozšírenie nájde na stránke správy (titulku aj rubriku Minúta po minúte).
• Umelá inteligencia ohodnotí každú správu: pozitívna, neutrálna alebo negatívna, a pridá skóre „mentálneho damage“ od 0 do 10.
• Negatívne správy sa skryjú. Hodnotenia sa pamätajú, takže ďalšia návšteva je okamžitá.

ČO EŠTE VIE
• Pôvodný web na požiadanie: jedným tlačidlom ukážeš všetko, čo sa skrylo, s farebným hodnotením každej správy.
• Štatistiky: koľko správ sa skrylo, koľko „damage“ sa ušetrilo a porovnanie s tým, ako by si na tom bol bez rozšírenia (orientačné odhady).
• Možnosť ponechať aj neutrálne správy.
• Skrýva reklamné bloky na podporovaných weboch.

PODPOROVANÉ WEBY
dennikn.sk

SÚKROMIE
Na vyhodnotenie sa posielajú len nadpisy správ (alebo úvodné vety krátkych príspevkov) a anonymné náhodné ID inštalácie. Žiadna história prehliadania, cookies ani osobné údaje. Zdrojový kód je otvorený.

Nezávislý projekt, nie je spojený so žiadnym spravodajským webom ani vydavateľom.
```

## Single purpose (účel rozšírenia)

```
Skrývať na podporovanom spravodajskom webe negatívne správy podľa hodnotenia umelej inteligencie.
```

> Riziko pri kontrole: skrývanie reklám a štatistiky môžu vyzerať ako ďalšie účely. Ak ťa vrátia, vypusti jednu z vecí.

## Zdôvodnenie oprávnení

**Prístup k hostiteľom `dennikn.sk`, `www.dennikn.sk`, `e.dennikn.sk`**

```
Rozšírenie funguje na podporovanom spravodajskom webe dennikn.sk (vrátane poddomén www a e). Číta nadpisy správ na stránke, aby ich mohlo ohodnotiť, a skrýva negatívne správy a reklamné bloky úpravou zobrazenia stránky.
```

**Prístup k hostiteľovi `nonegative.replit.app`**

```
Adresa vlastnej služby, ktorá pre rozšírenie vyhodnocuje nadpisy správ pomocou AI. Rozšírenie na ňu posiela nadpisy správ a anonymné ID inštalácie a prijíma kategóriu a skóre hodnotenia.
```

**Oprávnenie `storage`**

```
Ukladá nastavenia, lokálnu cache hodnotení (aby sa tá istá správa nehodnotila dvakrát) a štatistiky zobrazené v okne rozšírenia.
```

**Vzdialený kód**

```
Nie. Všetok kód je súčasťou balíka rozšírenia. Zo siete sa sťahujú len dáta (JSON s hodnotením), nie spustiteľný kód.
```

## Vyhlásenie o používaní dát (Privacy practices)

Zaškrtni jedinú kategóriu zbieraných dát:

- **Website content** (text správ z navštívenej stránky: nadpisy, ktoré sa posielajú na vyhodnotenie)

Nezaškrtávaj: osobne identifikovateľné údaje, zdravotné údaje, finančné a platobné údaje, údaje na overenie, osobná komunikácia, poloha, história webu, aktivita používateľa.

Potvrdenia (všetky tri platia):

- údaje nepredávame tretím stranám mimo schválených prípadov použitia,
- údaje nepoužívame ani neprenášame na účely nesúvisiace s jediným účelom rozšírenia,
- údaje nepoužívame ani neprenášame na posúdenie úverovej bonity ani na pôžičky.

## Obrázky

| Podklad | Súbor | Rozmer |
|---|---|---|
| Screenshot 1 | `screenshots/1-vysledok.png` | 1280×800 |
| Screenshot 2 | `screenshots/2-porovnanie.png` | 1280×800 |
| Screenshot 3 | `screenshots/3-minuta-po-minute.png` | 1280×800 |
| Screenshot 4 | `screenshots/4-statistiky.png` | 1280×800 |
| Malá propagačná dlaždica | `promo-tile-440x280.png` | 440×280 |
| Ikona 128 px | `../icons/icon-128.png` | 128×128 (je aj v balíku) |

Balík na nahratie: `spravy-bez-negativ-chrome.zip` z [releasu](https://github.com/mejmo/spravy-bez-negativ/releases/latest).
