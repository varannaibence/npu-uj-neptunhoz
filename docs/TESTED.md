# Hol működik a Neptun PowerUp!?

Minden intézmény a saját Neptun NG-példányát futtatja, ezért csak ott tudjuk a
működést ellenőrizni, ahol tényleg megnéztük. Ami nincs a táblázatban, arról
nincs mérésünk; ez nem azt jelenti, hogy nem működik.

Ez a fájl a projekt intézményi kompatibilitásának egyetlen nyilvántartása.

## Jelmagyarázat

- ✅ **Alapfunkciók ellenőrizve**
- 🟡 **Részlegesen ellenőrizve**
- ❌ **Nem működik**
- 🐛 **Nem működik, hibák jelezve** — van róla nyitott issue

## Állapot

| Intézmény | Neptun NG host | Állapot | Ellenőrizve |
| --- | --- | --- | --- |
| Debreceni Egyetem | `www-h-ng.neptun.unideb.hu` | 🟡 Részlegesen ellenőrizve | 2026-09-19 |
| Miskolci Egyetem | `neptunweb1.uni-miskolc.hu` | 🟡 Részlegesen ellenőrizve | 2026-09-29 |

## Működik nálad? Jelezd

Nyisd meg a **Tárgyfelvétel** oldalt, és nézd meg ezt a négyet:

1. Ha bekapcsoltad az automatikus betöltést, magától elindul-e a tárgyak
   listázása.
2. Ott van-e a **Rajtoló** (NPU-ikonnal) és a **Betelt kurzusok hátra** gomb a szűrő mellett.
3. Egy tárgyat lenyitva látszik-e a kurzusok férőhelye (pl. `regisztrált / limit`).
4. A lap alján ott van-e a `Neptun PowerUp!` felirat.

Ha mind a négy megvan, nyiss egy [issue-t](https://github.com/varannaibence/npu-uj-neptunhoz/issues)
`Ellenőrizve: <intézmény>` címmel, és írd bele a Neptun webcímét és az NPU
verzióját, amely a lap alján olvasható. A négy pont önmagában csak részleges
ellenőrzés, ezért a táblázatba is így kerül be.

## Mérőmód: minta a még nem mért válaszokról

Néhány Neptun-választ csak éles tárgyfelvételkor lehet látni: a sikeres
jelentkezését, a betelt kurzus elutasítását, a tárgyleadásét és a
kurzuscseréét. Ezekből egyetlen minta is sokat segít.

1. Az NPU beállításaiban (a lap alján, **NPU beállítások**) kapcsold be a
   **Fejlesztői mód** kapcsolót a Fejlesztői eszközök csoportban (alatta a
   **Mérőmód** alapból be van kapcsolva), és mentsd.
2. Vedd fel a tárgyaidat úgy, ahogy amúgy is tennéd: kézzel, vagy a Rajtoló
   **Felvétel** gombjával.
   A Mérőmód csak figyel, magától semmit nem küld el. Új mintánál értesítést
   látsz.
3. A Tampermonkey menüjében válaszd az **NPU fejlesztői eszközök** pontot, és a
   **Minták** fülön nézd át a mintákat.
4. Nyomd meg a **Beküldés GitHubon** gombot. A minták, a napló (időpontok
   szerveridőben, API-hívások időtartammal) és az állapotlap a vágólapra
   kerülnek, és megnyílik a GitHub [„Mérés” űrlapja](https://github.com/varannaibence/npu-uj-neptunhoz/issues/new?template=measurement.yml)
   `Mérés: <intézmény>` címmel. Illeszd be a naplót a mezőbe (Ctrl+V / Cmd+V),
   nézd át, és küldd el. Ehhez GitHub-fiók kell; ha nincs, a **Minden másolása**
   gombbal kimásolt szöveget más úton is elküldheted.

A minták maszkoltak: az azonosítók, dátumok, tárgynevek és -kódok helyén
`<guid>`, `<date>`, `<string>` áll, a Neptun-kódod helyén `<neptun-code>`.
Csak a Neptun hibaüzeneteinek szövege marad meg, mert épp az a kérdés. Küldés
előtt azért nézd át, és töröld, amit nem akarsz megosztani.

## Nem megy? Előbb ezt nézd meg

- **Semmi nem látszik.** A Tampermonkey be van kapcsolva, és a szkript
  engedélyezve van? Utána töltsd újra az oldalt.
- **A Neptunod címében nincs benne a „neptun” szó.** A szkript csak a
  `https://*neptun*/hallgato_ng/*` címekre tölt be. Írd meg a webcímet egy
  issue-ban, és bővítjük a mintát.
- **Régi felületű Neptun.** A 3-as sorozat csak az új, Angular-alapúhoz készült
  (a webcímben `/hallgato_ng/`). A régihez a
  [2.4.1](https://github.com/solymosi/npu) való.
- **Csak egy-két dolog hiányzik.** Ez a hasznos eset: nyiss issue-t
  `Nem működik: <intézmény>` címmel, és írd le, a fenti négyből melyik ment és
  melyik nem, plusz egy képernyőképet.

Jelszót, sütit, belépési tokent vagy teljes hálózati exportot soha ne csatolj, és
olyan képernyőképet se, amin más hallgató adata látszik.
