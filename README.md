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
| Frissítés jelzése | Amikor a Tampermonkey frissíti az NPU-t, a következő betöltéskor egyszer jelzi az új verziót, az újdonságok linkjével. | Frissítés utáni első betöltéskor | Be |

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
<summary><strong>v3.1.0</strong> · 2026. szept. 27.</summary>

**Rajtoló**

- Ha a Neptun egy kérésnél a lejárt token miatt 401-et ad, a Rajtoló friss
  tokent kér a Neptuntól, és a kérést egyszer újraküldi; eddig ez leállította a
  futást. Időtúllépéses kérést továbbra sem küld újra.
- A Leállítás tokenfrissítés közben is érvényes: ami a frissítésre várt, már nem
  megy ki. Ugyanez áll, ha közben más felhasználó lép be.
- Olyan egyetemen, ahol a token nem hordoz munkamenet-azonosítót, a futás már nem
  áll le minden tokenfrissítéskor.
- Beküldés után a Rajtoló egyszer újra lekéri a tárgy kurzuslistáját, és a
  Neptun saját állapotmezői alapján „Felvéve” vagy „Várólistára került”
  eredményt mutat. Ha ez nem dönthető el, „Beküldve” marad, és a futás ettől
  nem áll le.
- Javítva: a tervező csak az első tárgy kurzusadatait töltötte be, a többinél
  a „Kurzusadat betöltése…” felirat és az ütközésjelzés nem frissült.
- Javítva: a kurzusok sorrendjét állító ▲/▼ gombok a kurzusadatok betöltése
  után nem mentették az új sorrendet.
- Az időpontokat magyar idő szerint értelmezi akkor is, ha a böngésző más
  időzónában van; eddig ilyenkor egy vagy több órával később indult volna.
- Az időszakválasztó a folyamatban lévő vagy következő időszakot jelöli ki
  alapból, nem a lista elsőjét, ami gyakran már lezárult.
- A visszaszámláló egy napnál hosszabb várakozásnál napokat is mutat.
- Javítva: a „Rajtolóhoz” kapcsoló „A felhasználó azonosítása még nem készült
  el” hibát adott, és a terv nem volt menthető. Két ok volt. Az oldal betöltéskor
  küld egy bejelentkezés nélküli kérést, és az NPU ezt kijelentkezésnek vette.
  A Neptun 5 percenként új tokent kér, és ezt az NPU felhasználóváltásnak vette,
  ami a futó Rajtolót is leállította („Új munkamenet érzékelve”). Most csak a
  kijelentkezés vagy egy másik bejelentkezés számít váltásnak.
- Javítva: a „Rajtolóhoz” kapcsoló minden váltáskor „A Rajtoló terve nem
  menthető” hibát jelzett, pedig a terv elmentődött. A Tampermonkey mentése nem
  ad vissza értéket, és az NPU ezt sikertelenségnek olvasta.
- Elindítás után a Rajtoló életben tartja a munkamenetet, és a nyitás előtt
  friss tokent kér. Mindkettőhöz a Neptun saját „Tárgy keresése” gombját nyomja
  meg, így a Neptun maga frissít. Hosszú futás közben is megújítja a lejárt
  tokent, mielőtt a kérés elakadna.
- Háttérben lévő fülön a Chrome percenként egyszer futtatja a láncolt
  időzítőket, ezért az indulás akár egy percet is késhetett. Most egyetlen
  időzítő indítja a futást.
- Javítva: ha a visszaszámlálás alatt leállítottad a futást, a státusz
  „Leállítás folyamatban…” állapotban ragadt.
- A visszaszámlálás a böngészőfül címében is látszik. Ha a futás háttérben ér
  véget, a fül címe **✔ Rajtoló kész** lesz, amíg meg nem nézed.

**Új**

- Órarendjavaslatok: az Órarendtervező új **Javaslatok** gombja a felvett órák
  mellé ütközésmentes kurzusválasztást keres a Rajtolóban és a Neptun
  Tervezőjében kiválasztott csoportokhoz. Három változatot ad (kevesebb lyukas
  óra, több szabad nap, legkevesebb csere), a heti rácson előnézetben mutatja,
  és figyelmeztet a betelt, várólistás, rangsoros és időpont nélküli
  kurzusokra. Az **Alkalmazás** előbb felsorolja a változásokat, majd a Neptun
  Tervezőjében a javasolt kurzusokra cseréli a tervezetteket, és a Rajtoló
  sorrendjét is átrendezi. Ha a Neptun egy lépést elutasít, az addigiakat
  visszagörgeti; a panelen visszavonható. Ha egy már felvett kurzus típusából (például laborból)
  teszel egy másikat a Tervezőbe, cserének veszi, és megmondja, megéri-e
  cserélni. Ha a terved már a legjobb, ezt mondja, és nem ajánl átírást. A Rajtoló
  sorrendjének módosítása is megerősítést kér, és külön jelzi, ha egy kurzus eddig
  nem volt a sorrendedben. Ha a Tervező nem olvasható vissza, ezt mondja ki, nem
  állítja, hogy nem módosult. A
  javaslat egy keskeny sávban jelenik meg a naptár fölött, a részletek
  lenyithatók. A számolás előtt mindig frissen újraolvassa a Tervezőt, lejárt
  munkamenetnél pedig előbb a Neptunnal frissítteti.
- Egységes jelölés: az NPU által az oldalra tett minden gomb és kapcsoló (a
  Rajtoló, a „Rajtolóhoz” kapcsoló, a „Betelt kurzusok hátra”, az
  Átlagkalkulátor és a Javaslatok) az NPU ikonjával és „NPU-funkció” súgóval
  jelenik meg, hogy ne lehessen a Neptun sajátjával összekeverni. A Rajtoló
  gombján ezért nincs már „(NPU)” felirat.
- Mi van ma?: a kezdőlapon a „Tisztelt …!” köszöntés helyett, a Neptun saját
  kártyáival egyező három kártyán látszanak a mai órák teremmel (vagy a következő, ha ma nincs), a befizetési határidők és
  a futó vagy közelgő tárgyfelvételi időszakok. Ha egy befizetés vagy időszak 3
  napon belül esedékes, naponta egyszer értesítés jelzi bármelyik oldalon.
- Átlagkalkulátor: a Felvett tárgyak oldalon a várt jegyekből kiszámolja a félév
  súlyozott átlagát, kreditindexét és korrigált kreditindexét. Előbb egy lezárt
  féléven ellenőrzi, hogy az NPU képlete egyezik-e a Neptun saját értékeivel; ha
  nem, nem mutat számot.

**Egyéb**

- A beállítások panel minden funkciónál és alopciónál kiírja, hol található a
  Neptunban (például „Hol: Tárgyak › Tárgyfelvétel: a lenyitott tárgy
  kurzusainál”); a README táblázatai is kaptak egy **Hol található** oszlopot.
- Táblázatos kurzuslista: öt átláthatóbb oszlop (az állapot a kód mellett, nap-chip
  és terem az időpontnál, telítettségi sáv a létszám alatt, az ütköző tárgy neve),
  a felvett és a felvehető sorok színes szegélyt kapnak, a betelt és ütköző sorok
  halványabbak, a szakaszcímek számláló chipeket.
- Az NPU saját ablakai akkor is kitöltik a helyüket, ha előtte a Neptun egy kis
  ablaka nyílt meg; a rövid megerősítések keskenyebb ablakban jelennek meg.
- Javítva: bejelentkezés után az első kérés törölte a Neptun-kódot, ezért a
  Rajtoló terve, a „Mi van ma?” kártyái és a napi értesítés nem működtek az oldal
  újratöltéséig.
- A Munkamenet életben tartása akkor is közbelép, ha a legutóbbi tokenfrissítés
  10 percnél régebbi; a 12,5 perces tétlenség önmagában sokszor túl későn jött.
- Az átlagkalkulátor képletellenőrzése nem függ a félév feliratától, és teljesített
  kredit nélküli félévet nem fogad el bizonyítéknak.
- Beállítások: a kapcsolók a README-vel egyező csoportokban jelennek meg
  (Tárgyfelvétel, Rajtoló, Mindennapok, Megjelenés és kényelem). A „Mi van ma?”
  Befizetendő és Időszakok kártyája, valamint a napi értesítés külön
  kapcsolható.

- Munkamenet életben tartása: már tétlen fülnél is működik, de csak a
  tárgyfelvételi oldalon. Nem küld saját frissítő kérést: 12,5 perc tétlenség
  után, vagy ha a legutóbbi tokenfrissítés 10 percnél régebbi, röviddel a
  kiléptetés előtt megnyomja a Neptun „Tárgy keresése” gombját,
  és a Neptun maga frissít. Ettől a tárgylista újratöltődik; aki közben
  kattintgat, annál nem nyom, de aki csak olvas, annál előfordulhat. A régi
  módszer nem
  állította vissza a Neptun kiléptetési számlálóját, és ha egyszerre futott a
  Neptun saját frissítésével, a munkamenet elveszhetett.

- Beállítások: a csak színtémát érintő mentés nem tölti újra az oldalt, és
  változtatás nélkül a gomb egyszerűen bezárja a panelt.
- Javítva: a Neptun ötpercenkénti tokenfrissítésekor eltűntek az
  ütközésjelzések, és az NPU újra lekérte a felvett kurzusokat.
- Táblázatos kurzuslista: bekapcsolt szűrő mellett minden újrarajzolás
  áthelyezte a sorokat, ami a billentyűzetfókuszt is elvihette. Javítva.

[Release megnyitása](https://github.com/varannaibence/npu-uj-neptunhoz/releases/tag/v3.1.0) · [Telepítés](https://github.com/varannaibence/npu-uj-neptunhoz/releases/download/v3.1.0/npu.user.js)

</details>
<details>
<summary><strong>v3.0.4</strong> · 2026. szept. 26.</summary>

- Frissítés jelzése: amikor a Tampermonkey frissíti az NPU-t, a következő
  betöltéskor egy értesítés jelzi az új verziót, az „Újdonságok” linkkel. Csak
  egyszer jelenik meg, első telepítéskor nem. A beállításokban kikapcsolható.
- A frissítési és hibabejelentő linkek az új repócímre (`npu-uj-neptunhoz`)
  mutatnak; eddig a régi cím átirányítása miatt működtek.

[Release megnyitása](https://github.com/varannaibence/npu-uj-neptunhoz/releases/tag/v3.0.4) · [Telepítés](https://github.com/varannaibence/npu-uj-neptunhoz/releases/download/v3.0.4/npu.user.js)

</details>
<details>
<summary><strong>v3.0.3</strong> · 2026. szept. 26.</summary>

- Rajtoló: javítva, hogy egyes egyetemek Neptunján (pl. ME) a kurzus Rajtolóhoz
  adásakor „A Rajtoló terve nem menthető” hibát kaptál. A hiányzó félév-azonosítót
  az NPU most a kurzuslista kéréséből pótolja.

[Release megnyitása](https://github.com/varannaibence/npu-uj-neptunhoz/releases/tag/v3.0.3) · [Telepítés](https://github.com/varannaibence/npu-uj-neptunhoz/releases/download/v3.0.3/npu.user.js)

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
