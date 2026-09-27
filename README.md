<div align="center">

<img src="docs/assets/npu-icon.svg" width="96" height="96" alt="">

# Neptun PowerUp!

**Gyorsabb, átláthatóbb és kiszámíthatóbb Neptun — az új, Angular-alapú felülethez.**

[![Verify code](https://github.com/varannaibence/npu-uj-neptunhoz/actions/workflows/verify.yml/badge.svg)](https://github.com/varannaibence/npu-uj-neptunhoz/actions/workflows/verify.yml)
[![Latest release](https://img.shields.io/github/v/release/varannaibence/npu-uj-neptunhoz?label=kiad%C3%A1s)](https://github.com/varannaibence/npu-uj-neptunhoz/releases/latest)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Status: early phase](https://img.shields.io/badge/%C3%A1llapot-korai%20f%C3%A1zis-orange.svg)

[**Telepítés**](#telepítés) · [Funkciók](#funkciók) · [Rajtoló](#a-rajtoló) · [Adatvédelem](#adatvédelem) · [Hibaelhárítás](#hibaelhárítás) · [Közösség](https://github.com/varannaibence/npu-uj-neptunhoz/discussions)

_Az egyetem már így is elég nehéz. Ne a Neptun tegye nehezebbé._

</div>

---

A **Neptun PowerUp!** (NPU) egy böngészőben futó userscript, amely a Neptun
hallgatói felületét egészíti ki: kiírja a kurzusok férőhelyét és órarendi
ütközéseit, sorba rendezett tárgyfelvételt tesz lehetővé, és a felületet a
saját ízlésedre színezheted. Mindez helyben, a böngésződben fut — saját szerver,
fiók vagy jelszómentés nélkül.

A 3.x sorozat az **új Neptun NG felülethez** készült, a nulláról újraírva. A
régi felülethez tartozó 2.4.1-es kiadás az [eredeti
projektben](https://github.com/solymosi/npu) érhető el; az új Neptunon nem
működik.

> **Korai fejlesztési fázis.** A működés és a felület még változhat. Hogy melyik
> intézményen mit ellenőriztünk, azt a [docs/TESTED.md](docs/TESTED.md) mutatja.

## Funkciók

Minden funkció (a lábléc kivételével, mert azon át nyílik a panel) egyenként
kapcsolható a **Neptun PowerUp! beállítások**
panelben (a lap alján, **NPU beállítások**); a módosítás a következő
oldalbetöltéskor lép életbe. A panel minden funkciónál kiírja, hol találod a
Neptunban; ugyanez áll az alábbi táblázatok **Hol található** oszlopában.

Az NPU által az oldalra tett gombokon és kapcsolókon az NPU kék ikonja látszik,
fölé húzva pedig az „NPU-funkció” felirat. Ami nem ilyen, az a Neptun saját része.

A **Ki** alapállapot szándékos döntés, nem félkész funkciót jelez. Ezek a
modulok a Neptun megszokott elrendezését vagy munkafolyamatát változtatják meg,
vagy a háttérben maguktól indítanak kérést, ezért csak kifejezett bekapcsolás
után lépnek működésbe. Saját kérést néhány alapból bekapcsolt funkció is küld
(például a „Mi van ma?” a kezdőlapon, az Átlagkalkulátor és a Javaslatok
megnyitáskor); hogy pontosan mit, azt a [fejlesztői
leírás](docs/DEVELOPMENT.md) sorolja fel.

### Tárgyfelvétel

| Funkció | Leírás | Hol található | Alapállapot |
| --- | --- | --- | :---: |
| Férőhely és várólista | Kurzusonként jelzi a szabad helyet, a beteltséget és a várólistát; tárgyanként a betelt kurzusok számát. | Tárgyak › Tárgyfelvétel: a lenyitott tárgy kurzusai | Be |
| Órarendi ütközések | Megnevezi az ütköző tárgyat és időpontot a tervezőben lévő és a már felvett kurzusok alapján. | Tárgyak › Tárgyfelvétel: a lenyitott tárgy kurzusai | Be |
| ↳ Időpont a megjegyzésből | Ha a Neptun nem ad órarendi adatot, a kurzus megjegyzéséből olvassa ki a napot, az időt és a termet (pl. „Hétfő 14-15, A1/216”), és az ütközésvizsgálatban is felhasználja. | Tárgyak › Tárgyfelvétel: a lenyitott tárgy kurzusai | Be |
| Gyorsabb kurzuslista | Egy oldalon lényegesen több sort tölt be, így kevesebbet kell lapozni. | Tárgyak › Tárgyfelvétel: a tárgylista | Be |
| Betelt kurzusok hátra | A még felvehető kurzusokat előre rendezi a lenyitott listában. | Tárgyak › Tárgyfelvétel: gomb a szűrők mellett | Gombbal |
| Tárgylista automatikus betöltése | Külön keresés nélkül elindítja a tárgyak listázását. | Tárgyak › Tárgyfelvétel: az oldal megnyitásakor | Ki |
| Táblázatos kurzuslista | Szűrhető, rendezhető táblázatra cseréli a natív kurzuslistát: állapot a kód mellett, nap-chip és terem, telítettségi sáv, az ütköző tárgy neve, színkódolt sorok. | Tárgyak › Tárgyfelvétel: a lenyitott tárgy | Ki |
| Kompakt nézet | Sűrűbb elrendezés nagy asztali kijelzőkhöz. | Tárgyak › Tárgyfelvétel, nagy kijelzőn | Ki |

### Rajtoló

| Funkció | Leírás | Hol található | Alapállapot |
| --- | --- | --- | :---: |
| Sorba rendezett tárgyfelvétel | Mentett tárgy- és kurzussorrend, a megadott időpontban soros beküldéssel. [Részletek](#a-rajtoló) | Tárgyak › Tárgyfelvétel: **Rajtoló** gomb a szűrők mellett, **Rajtolóhoz** kapcsoló a kurzusoknál | Külön indítható |
| ↳ Órarendjavaslatok | **Javaslatok** gomb a Neptun Órarendtervezőjében: a felvett órák mellé ütközésmentes kurzusválasztást keres (kevesebb lyukas óra, több szabad nap vagy legkevesebb csere), a heti rácson előnézetben mutatja; megerősítés után a Neptun Tervezőjében is a javasolt kurzusokra cseréli a tervezetteket, és átrendezi a Rajtoló sorrendjét. | Tárgyak › Tárgyfelvétel: a lap alján nyíló Órarendtervező fejléce | Be |

### Mindennapok

| Funkció | Leírás | Hol található | Alapállapot |
| --- | --- | --- | :---: |
| Mi van ma? | A kezdőlap tetején, a Neptun kártyáival egyező három kártyán a mai órák teremmel, a befizetési határidők és a futó vagy közelgő tárgyfelvételi időszakok. Ha egy határidő vagy időszak 3 napon belül esedékes, naponta egyszer értesít. | Kezdőlap, a tetején | Be |
| ↳ Befizetendő tételek | Kártya a befizetendő tételekkel, összeggel és határidővel. | Kezdőlap | Be |
| ↳ Időszakok | Kártya a futó és 45 napon belül nyíló tárgy- és vizsgajelentkezési időszakokkal. | Kezdőlap | Be |
| ↳ Napi értesítés | Bejelentkezés után naponta egyszer jelez, ha egy befizetés vagy időszak 3 napon belül esedékes, vagy egy befizetés lejárt. | Bejelentkezés után, felugró értesítés | Be |
| Átlagkalkulátor | A Felvett tárgyak oldalon a várt jegyekből kiszámolja a félév súlyozott átlagát, kreditindexét és korrigált kreditindexét. Csak akkor mutat eredményt, ha egy lezárt félév újraszámolása egyezik a Neptun saját értékeivel. | Tárgyak › Felvett tárgyak: gomb a szűrő mellett | Be |

### Megjelenés és kényelem

| Funkció | Leírás | Hol található | Alapállapot |
| --- | --- | --- | :---: |
| Színtéma | A Neptun kékje helyett választható kiemelőszín (8 minta vagy egyéni); a fejléc és a lábléc ennek sötét árnyalatát kapja. | NPU beállítások (lábléc) | Neptun kék |
| Kreditbontás | A fejlécben tárgytípusonként bontja a ténylegesen felvett krediteket. | Tárgyak › Tárgyfelvétel: a fejléc kreditkártyája | Be |
| Visszatérés az előző oldalra | Bejelentkezés után felajánlja a legutóbb használt oldal megnyitását. | Bejelentkezés után, felugró értesítés | Be |
| Munkamenet életben tartása | A tárgyfelvételi oldalon tétlen fülnél is megakadályozza a kiléptetést: mielőtt a munkamenet lejárna (12,5 perc tétlenség, vagy 10 perce nem frissült token után), megnyomja a Neptun saját keresőgombját. | Tárgyak › Tárgyfelvétel, a háttérben | Ki |
| Verzió és hibabejelentés | Az NPU neve és verziója a bejelentkező oldalon és a láblécben, hibabejelentő linkkel. | Bejelentkező oldal és lábléc | Be |
| Frissítés jelzése | Amikor a Tampermonkey frissíti az NPU-t, a következő betöltéskor egyszer jelzi az új verziót, a változásnapló linkjével. | Frissítés utáni első betöltéskor | Be |

## Telepítés

Az NPU a **Tampermonkey** böngészőbővítménnyel fut. A telepítés néhány perc.

**1. Tampermonkey telepítése** —
[Chrome](https://chromewebstore.google.com/detail/tampermonkey/dhdgffkkebhmkfjojejmpbldmpobfkfo) ·
[Firefox](https://addons.mozilla.org/firefox/addon/tampermonkey/) ·
[Edge](https://microsoftedge.microsoft.com/addons/detail/tampermonkey/iikmkjmpaadaobahmlepeloendndfphd) ·
[Opera](https://addons.opera.com/en/extensions/details/tampermonkey-beta/) ·
[Safari](https://apps.apple.com/app/tampermonkey/id1482490089)

**2. Userscriptek engedélyezése (csak Chrome és Edge)** — az újabb verziók ezt
külön kérhetik; enélkül az NPU látszik a Tampermonkey menüjében, de a Neptunon
nem fut.

<details>
<summary>Lépések Chrome és Edge alatt</summary>

1. Nyisd meg a `chrome://extensions` (Edge: `edge://extensions`) oldalt.
2. A Tampermonkeynál kattints a **Részletek** gombra.
3. Kapcsold be a **Felhasználói szkriptek engedélyezése** / **Allow User
   Scripts** lehetőséget.
4. Ellenőrizd, hogy a Tampermonkey hozzáférhet a Neptun webhelyéhez.

Ha Edge alatt nem látsz ilyen kapcsolót, nincs vele teendőd. Firefox és Safari
alatt ez a lépés kimarad.

</details>

**3. Az NPU telepítése** —
[**Neptun PowerUp! telepítése**](https://github.com/varannaibence/npu-uj-neptunhoz/releases/latest/download/npu.user.js),
majd a Tampermonkey ablakában **Telepítés** / **Install**. Ha a böngésző csak
letölti az `npu.user.js` fájlt, nyisd meg, és engedd a Tampermonkeynak
telepíteni.

**4. Neptun megnyitása** — az NPU 3 csak az új felületen működik, amelynek
címében szerepel a `/hallgato_ng/` rész. Nyisd meg, és töltsd újra egyszer.

**5. Ellenőrzés** — a telepítés akkor sikeres, ha a Neptun oldalán:

- a Tampermonkey ikonján megjelenik az `1`-es jelzés,
- a menüben látszik a **Neptun PowerUp! beállítások** pont,
- a bejelentkező oldalon vagy a lap alján olvasható a **Neptun PowerUp!
  v3.x.x** felirat.

> **Fejlesztőknek:** fejlesztéshez ne a release-t telepítsd: a helyi loader, a build, a tesztek és
> a kiadási folyamat a [fejlesztői útmutatóban](docs/DEVELOPMENT.md) található.

<!-- releases:start -->
## Legfrissebb kiadások

A legutóbbi három stabil kiadás. A **Telepítés** link Tampermonkey mellett
közvetlenül telepíthető.

<details open>
<summary><strong>v3.1.3</strong> · 2026. szept. 27.</summary>

**Rajtoló**

- Javítva: ha az új félév tárgylistája üres volt, az előző félév terve
  megmaradt, és a Rajtoló azzal elindítható volt.
- Futás közbeni leállítás után a státusz „Leállítva”, nem „Kész”.
- Ha egy tárgy rangsorolt kurzusát már felvetted, vagy várólistán vagy rá, a
  Rajtoló kihagyja a tárgyat. Eddig a következő kurzust küldte be, ami
  lecserélhette a már felvettet.
- Egy csoporton belül a szabad helyes kurzus megelőzi a feljebb rangsorolt, de
  csak várólistát adó kurzust; ha egyikben sincs hely, a várólista marad.
- Élesített Rajtoló mellett más NPU-ablak (például a beállítások) nem nyílik
  meg, mert a Rajtoló ablakának bezárása leállítaná a futást.
- Másik felhasználó belépése után a kredit-előrejelzés nem mutatja az előző
  felhasználó kreditjeit, félévváltás után pedig a másik félévét.

**Órarendjavaslatok**

- Alkalmazáskor a Rajtoló sorrendjéből kikerülnek a javaslattal ütköző
  tartalék kurzusok; eddig a sor végén maradtak, így betelt első választásnál a
  Rajtoló ütköző kurzusra jelentkezhetett. A megerősítés megnevezi őket, és
  visszavonható.
- Üres tárgylistájú új félévre váltáskor a javaslatok már nem a régi félév
  Tervezőjéből számolnak, és nem azt módosítják.
- Futó Rajtoló mellett az alkalmazás csak a Tervezőt módosítja, a Rajtoló
  sorrendjét nem.

**Egyéb**

- Két nyitott Neptun-fülnél az egyik fül mentése már nem írja felül a másikban
  mentett adatot, például a Rajtoló tervét.
- Ha egy felvett vagy tervezett kurzusodnak nincs időpontja, az ütközésjelzés
  „Nincs ismert ütközés” feliratot mutat, és megnevezi ezeket a kurzusokat.

- Kilépés vagy másik bejelentkezés után egy késve érkező régi `UserInfo`
  válasz már nem állítja vissza az előző Neptun-kódot.
- Átlagkalkulátor: félévváltás után nem mutatja az előző félév tárgyait.
- „Mi van ma?”: éjfél után nem mutat tegnapi adatot a gyorsítótárból.

[Release megnyitása](https://github.com/varannaibence/npu-uj-neptunhoz/releases/tag/v3.1.3) · [Telepítés](https://github.com/varannaibence/npu-uj-neptunhoz/releases/download/v3.1.3/npu.user.js)

</details>
<details>
<summary><strong>v3.1.2</strong> · 2026. szept. 27.</summary>

- Frissítés jelzése: az „Újdonságok” link a változásnaplóban az új verzió
  teljes leírására visz; eddig a GitHub release-oldalára, ahol csak a
  beolvasztott PR-ek listája látszott.

[Release megnyitása](https://github.com/varannaibence/npu-uj-neptunhoz/releases/tag/v3.1.2) · [Telepítés](https://github.com/varannaibence/npu-uj-neptunhoz/releases/download/v3.1.2/npu.user.js)

</details>
<details>
<summary><strong>v3.1.1</strong> · 2026. szept. 27.</summary>

**Órarendjavaslatok**

- Javítva: ha egy tárgy egyik kurzusa (például az előadás) a Rajtolóban, a
  másik (például a labor) csak a Neptun Tervezőjében szerepelt, a labor kimaradt
  a számításból, így egy valódi ütközést is ütközésmentesnek mutatott.
- Ha egy csoport nem fér be ütközés nélkül, a javaslat nem alkalmazható: a
  kimaradó csoport kurzusa a Tervezőben maradna, és ütközhetne az újakkal. Az
  előnézet és a részletek továbbra is látszanak.
- Ritkábban jelzi tévesen, hogy „A Neptun nem adott friss munkamenetet”, ha a
  gép órája kicsit eltér a szerverétől.

**Rajtoló**

- Élesített vagy futó Rajtolónál a „Rajtolóhoz” kapcsoló nem módosítja a
  tervet, hanem szól, hogy előbb állítsd le. Eddig a kapcsoló látszólag
  kivette vagy hozzáadta a kurzust, a futás mégis az indításkori tervet
  küldte be.
- Ha egy beküldés időtúllépéssel ér véget, a státusz azt mondja: „A szerver nem
  válaszolt időben. A jelentkezés állapota bizonytalan.” – eddig csak általános
  hibaüzenet jelent meg. A kérést továbbra sem küldi újra.
- Javítva: token-frissítés után a sikertelenül betöltött kurzusadatok
  újratöltése elmaradhatott, ha közben másik betöltés futott.

**Egyéb**

- Férőhely: ha két tárgynak azonos a kurzuskódja (például „01”), ezeknél a
  soroknál nem jelenik meg létszám, és a „Betelt kurzusok hátra” rendezés sem
  mozgatja őket. Eddig az egyik tárgy kurzusa a másik tárgy létszámát és betelt
  állapotát mutathatta.
- Mi van ma?: a határidő nélküli befizetendő tétel is megjelenik („határidő
  nélkül”); eddig kimaradt, és a kártya azt írhatta, hogy nincs befizetendő tétel.

[Release megnyitása](https://github.com/varannaibence/npu-uj-neptunhoz/releases/tag/v3.1.1) · [Telepítés](https://github.com/varannaibence/npu-uj-neptunhoz/releases/download/v3.1.1/npu.user.js)

</details>

[Összes kiadás megtekintése](https://github.com/varannaibence/npu-uj-neptunhoz/releases)
<!-- releases:end -->

## A Rajtoló

A Rajtoló előre összeállított tervvel, a tárgyfelvétel nyitásakor, a megadott
sorrendben küldi be a jelentkezéseket.

1. Jelentkezz be, és maradj bejelentkezve a tervezett kezdésig.
2. A **Tárgyfelvétel** oldalon listázd a tárgyakat, és a kívánt kurzusoknál
   kapcsold be a **Rajtolóhoz** kapcsolót.
3. Nyisd meg a Rajtolót a szűrő melletti gombbal: rendezd sorba a tárgyakat és
   kurzusokat, válaszd ki a nyitás időpontját a Neptun saját tárgyfelvételi
   időszakaiból, és nézd át az ütközéseket és a kredit-előrejelzést.
4. Indítsd el, és kövesd az eredményeket. Minden beküldés után a Rajtoló egyszer
   újra lekéri a tárgy kurzuslistáját: ha a Neptun szerint minden beküldött
   kurzusod felvett, **Felvéve**, ha valamelyiken várólistán vagy, **Várólistára
   került** jelzést kapsz. Ha ez nem dönthető el, **Beküldve** marad, és a
   Neptunban kell ellenőrizned.

Az időpontok magyar idő szerint értendők akkor is, ha a gépedet más időzónára
állítottad (például külföldi részképzésen).

Elindítás után a Rajtoló életben tartja a munkamenetet, amíg az ablaka nyitva
van. Ehhez nem küld saját frissítő kérést: kb. 10 percenként megnyomja a Neptun
saját **Tárgy keresése** gombját, a Neptun pedig maga frissít. A nyitás előtti
másfél percben ugyanígy friss tokent kér, hogy az első jelentkezés ne akadjon
el. Ha a Neptun nem ad új munkamenetet, a visszaszámlálás mellett figyelmeztetés
jelenik meg. A hátralévő idő a böngészőfül címében is látszik, a futás végén
pedig a háttérben lévő fül címe **✔ Rajtoló kész** lesz.

A terv felhasználónként és félévenként a böngésződben tárolódik. A Neptun
**Tervezőhöz adás** kapcsolója ettől független funkció.

Az Órarendtervező **Javaslatok** gombja a Rajtolóban és a Neptun Tervezőjében
kiválasztott kurzuscsoportokhoz keres ütközésmentes kombinációt a már felvett
órák mellé. Három változatot kínál: kevesebb lyukas óra, több szabad nap, vagy
a lehető legkevesebb csere. A kiválasztott változat szaggatott keretes
kártyákként jelenik meg a heti rácson; ha a terved már a legjobb, ezt mondja
ki, és nem ajánl módosítást. Az **Alkalmazás** előbb felsorolja, mi változik:
a Neptun Tervezőjében lévő kurzusokat a javasoltakra cseréli (a szerveren, a
Neptun saját kéréseivel), a Rajtoló sorrendjét pedig átrendezi. Ha egy lépést
a Neptun elutasít, az addigiakat visszagörgeti; a panelen visszavonható. A
rács a frissült Tervezőt az oldal újratöltése után mutatja. Ha egy már felvett kurzus típusából (például laborból) egy másikat
teszel a Tervezőbe, azt cserének veszi, és megmutatja, megéri-e cserélni; a
cserét magát a Neptunban végezheted el. „Nincs ismert ütközés” azt jelenti, hogy
az ismert időpontok között nincs átfedés: az időpont nélküli kurzusokra külön
figyelmeztet.

> **Fontos:** a Rajtoló **nem** jelentkezik be helyetted, nem kér kétlépcsős kódot, nem
> kerüli meg a CAPTCHA-t és nem hágja át az egyetem szabályait. A
> **Leállítás** csak a további kéréseket állítja meg — ami már elment, azt nem
> lehet visszavonni. A várólistára kerülést a sikeres felvételtől külön jelzi,
> ismeretlen szerverválasznál pedig megáll, és nem könyvel el sikert.

## Fontos korlátok

- **Intézményi lefedettség.** Az ellenőrzött állapot a
  [docs/TESTED.md](docs/TESTED.md) lapon látható; ami nincs benne, arról nincs
  mérésünk.
- **A döntést a Neptun hozza.** Éles tárgyfelvételi időszakban még ellenőrizendő
  a sikeres beküldés, a ténylegesen betelt (nem várólistás) kurzus és a
  rangsoros kurzusok szerverválasza.
- **Tétlen munkamenet.** A magára hagyott fül munkamenete alapból lejár. Az
  elindított Rajtoló a visszaszámlálás alatt, a bekapcsolt **Munkamenet
  életben tartása** pedig mindig életben tartja, de csak a tárgyfelvételi
  oldalon. Mindkettő a Neptun saját keresőgombját nyomja meg. Más oldalon az NPU
  nem tudja megakadályozni a kiléptetést.
- **Ütközésjelzés.** Csak azokkal a kurzusokkal számol, amelyekhez a Neptun
  felismerhető azonosítót, és órarendi adatot vagy értelmezhető megjegyzést ad.
  Hiányzó időpontnál ezt jelzi, és nem állítja, hogy nincs ütközés.
- A régi, 2.4.1-es kiadás funkciólistája nem a v3 képességeit írja le.

## Adatvédelem

Az NPU a böngésződben fut, és semmilyen adatot nem küld saját szerverre. A
Rajtoló tervei, a beállítások és a legutóbb látott NPU-verzió helyben maradnak,
jelszót a v3 nem tárol.

<details>
<summary>Mi történik a régi (2.x) adatokkal?</summary>

- A régi `neptun.users` GM-kulcsot (a korábbi bejelentkezési mentést) a v3 nem
  olvassa, nem importálja és nem törli.
- A v3 saját `data.users` adataiban maradt bejelentkezési és hitelesítési
  mezőket induláskor kitisztítja; a terveket és az egyéb nem érzékeny adatokat
  meghagyja.
- A régi `neptun.courses` értékéből csak biztonságos kulcsú, nem érzékeny
  kurzusválasztás kerülhet a `courses._legacy` részbe. A régi GM-forrásokat a
  program nem törli.

</details>

A jelszavadat mindig a Neptun saját oldalán add meg — sem a programnak, sem egy
hibabejelentésnek ne küldd el.

## Hibaelhárítás

<details>
<summary><strong>A script ott van a Tampermonkeyben, de az oldalon semmi nem változik</strong></summary>

Nézd meg, van-e `1`-es jelzés a Tampermonkey ikonján. Ha nincs, a script
telepítve van, de nem fut: Chrome és Edge alatt ellenőrizd a userscript-engedélyt
és a Neptun webhelyéhez adott hozzáférést ([2. lépés](#telepítés)).

</details>

<details>
<summary><strong>Van <code>1</code>-es jelzés, de nincs NPU-felirat vagy beállítási menü</strong></summary>

Töltsd újra az oldalt. Ha továbbra sem jelenik meg, valószínűleg indulási hiba
történt: nyiss hibajegyet, és csatold a böngésző fejlesztői konzoljában
megjelenő első piros NPU-hibát.

</details>

<details>
<summary><strong>Az NPU fut, de valamelyik funkció hiányzik</strong></summary>

Ez lehet intézményi eltérés. Nézd meg az [ellenőrzött intézmények
listáját](docs/TESTED.md), majd írd meg, pontosan melyik funkció nem működik.

</details>

<details>
<summary><strong>A Rajtoló nem indul</strong></summary>

Töltsd újra az oldalt bejelentkezett állapotban, majd állítsd össze újra a
tervet.

</details>

**Hibabejelentés** a [GitHub issue trackerben](https://github.com/varannaibence/npu-uj-neptunhoz/issues):
add meg a verziót (a lap alján olvasható), az intézményt, az oldalt és a
reprodukálás lépéseit. Képernyőkép jöhet, de jelszót, sütit, belépési tokent vagy
teljes hálózati exportot ne csatolj.

## Közösség és közreműködés

- **Kérdés, ötlet, intézményi tapasztalat:** [GitHub
  Discussions](https://github.com/varannaibence/npu-uj-neptunhoz/discussions)
- **Új funkció:** modulként, pull requestben — lásd
  [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md).
- **Változásnapló:** [docs/CHANGELOG.md](docs/CHANGELOG.md)

## Szerzők és licenc

Az NPU eredeti szerzője Mate Solymosi; az új Neptun-felülethez készült v3-at
Varannai Bence írja.

[MIT License](LICENSE) — a program saját felelősségre használható.
