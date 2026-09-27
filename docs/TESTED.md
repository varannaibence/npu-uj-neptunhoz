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
