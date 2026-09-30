# Változásnapló

## Következő kiadás

- Új logó: dőlt N, a jobb szára felfelé mutató nyíl, a bal szára villám. Ez
  jelöli az NPU gombjait a Neptunban, és ez látszik a Tampermonkeyben is.

## 3.3.0 — 2026. szept. 30. <a name="v3.3.0"></a>

**Rajtoló**

- Új, gyors, kattintásos felvétel: a Rajtoló ablakában tárgyanként egy
  **Felvétel** gomb van. Egy kattintásra friss kurzuslistát kér, a sorrended
  szerinti szabad kurzusokkal felveszi a tárgyat, és kiírja a Neptun válaszát.
  Utána a következő tárgy gombja kap fókuszt.
- Ha a beküldött kurzus közben betelt, ugyanazon a kattintáson belül a
  következővel próbálja, legfeljebb négyszer, és ugyanazt a kurzust soha nem
  küldi el kétszer. Hogy betelt-e, azt a friss kurzuslistából dönti el, nem az
  üzenet szövegéből.
- A Rajtoló többé nem küld magától tárgyfelvételt: megszűnt az időzített
  indítás, a nyitás körüli újraküldés, a betelt tárgyak figyelése, a
  munkamenet életben tartása és a nyitási emlékeztető. Egy kattintás egy tárgy,
  egyszerre egy. Utánanéztünk: az ilyen scriptek terhelik a szervert, és volt
  már miattuk fegyelmi eljárás, ezért így a legbiztonságosabb.
- Letisztult ablak: a tárgyak sorrendje és a **Felvétel** gombok, a sorrend
  szerkesztése tárgyanként lenyitható, a kurzuskódok és időpontok saját kérés
  nélkül látszanak. A **Kurzusválasztás**, az ütközésjelzés és a
  kredit-előrejelzés megmaradt.

**Egyéb**

- Új [Felelősség és használat](FELELOSSEG.md) lap: mit vállalunk, mire
  figyelj, és miért nézd meg az intézményed Neptun-szabályzatát.
- Új, alapból kikapcsolt **Fejlesztői mód** („Fejlesztői eszközök” csoport):
  napló az API-hívásokról (metódus, státusz, időtartam, időtúllépés), a
  munkamenet-váltásokról, az útvonalakról, a szerveróra-eltérésről, a Rajtoló
  lépéseiről és az eddig csendben elnyelt hibákról, szerveridővel; állapotlap a
  token lejártáról és a bekapcsolt modulokról. A Tampermonkey menüjéből
  („NPU fejlesztői eszközök”) nyílik. A **Beküldés GitHubon** gomb a vágólapra
  másolja, és megnyitja a GitHub „Mérés” űrlapját, ahová csak be kell illeszteni.
  Csak memóriában él, maszkolva, és magától semmit nem küld el.
- A Fejlesztői mód része a **Mérőmód**: maszkolva elmenti a Neptun még nem mért
  tárgyfelvételi válaszait (sikeres jelentkezés, betelt kurzus elutasítása,
  leadás, kurzuscsere), kézi és Rajtolós felvételnél egyaránt.
- Ha egy modul indításkor hibára fut, a többi modul ettől még elindul.

## 3.2.0 — 2026. szept. 29. <a name="v3.2.0"></a>

**Rajtoló**

- Megújult ablak: fent egy panel mondja meg, mikor nyit a tárgyfelvétel és hol
  tart a Rajtoló, alatta a hiányzó feltételek (bejelentkezés, tárgyak, időpont,
  lezárt időszak) – ugyanazok, amiket az Élesítés ellenőriz. Az időszak
  kiválasztása magától kitölti a nyitás időpontját (a „Nyitás kitöltése” gomb
  megszűnt), a kurzusoknál látszik az időpont és a férőhely, a stratégia
  kapcsolói egy sorban választhatók. A gomb neve **Élesítés**, ha a nyitás
  még előttünk van. Futás után a felső panel a legutóbbi futás összegzését
  mutatja.
- Az ablak és a README is jelzi, hogy a Rajtoló még nincs minden helyzetben
  élesben letesztelve, ezért nyitáskor készülj a kézi felvételre. Ha a futás
  ismeretlen hiba miatt áll le, az összegzés is ezt kéri.
- Új **Kurzusválasztás** kapcsoló: szabad hely előnyben (végső esetben
  várólista, ez az eddigi viselkedés), pontosan a megadott sorrend, vagy csak
  szabad hely, várólistára soha. Mindhárom csak a bejelölt kurzusok közül
  választ.
- A tárgyak között nincs többé szünet: a következő tárgy azonnal megy, amint az
  előző választ kapott. A „Késleltetés” mező megszűnt.
- Gyorsabb nyitás: a kurzuslistákat 20 másodperccel a nyitás előtt előre
  betölti, így nyitáskor tárgyanként csak a jelentkezés megy ki; az eredmény
  ellenőrzése az összes beküldés után jön.
- Ha a Neptun a nyitás pillanatában még zárva van („nincs tárgyjelentkezési
  időszak”), a Rajtoló fél percig 0,3 másodpercenként újraküldi, ahelyett hogy
  leállna.
- Új figyelés: ha egy tárgy minden bejelölt kurzusa betelt, a Rajtoló a
  választott ideig (5–60 perc) másodpercenként újraolvassa, és szabad helynél
  azonnal jelentkezik.
- Pontosabb indulás: a szerveróra-eltolást már csak a Neptun API-válaszaiból
  számolja (egy gyorsítótárból érkező fájl régi dátuma eltolhatta a kezdést), a
  legutóbbi mérések közül a legpontosabbat veszi (a Neptun csak egész
  másodpercet küld), és ha a nyitás korábbra kerül, a visszaszámlálás maga
  indítja a futást.

**Egyéb**

- Az Órarendjavaslatok akkor is működnek, ha a Férőhely és az Ütközés modul ki
  van kapcsolva.
- A „Vissza a legutóbbi oldalra” intézményenként jegyzi meg az oldalt.
- Javítva: ha két mentés közvetlenül egymás után történt, a második változás
  ritkán elveszhetett.

## 3.1.3 — 2026. szept. 27. <a name="v3.1.3"></a>

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

## 3.1.2 — 2026. szept. 27. <a name="v3.1.2"></a>

- Frissítés jelzése: az „Újdonságok” link a változásnaplóban az új verzió
  teljes leírására visz; eddig a GitHub release-oldalára, ahol csak a
  beolvasztott PR-ek listája látszott.

## 3.1.1 — 2026. szept. 27. <a name="v3.1.1"></a>

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

## 3.1.0 — 2026. szept. 27. <a name="v3.1.0"></a>

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

## 3.0.4 — 2026. szept. 26. <a name="v3.0.4"></a>

- Frissítés jelzése: amikor a Tampermonkey frissíti az NPU-t, a következő
  betöltéskor egy értesítés jelzi az új verziót, az „Újdonságok” linkkel. Csak
  egyszer jelenik meg, első telepítéskor nem. A beállításokban kikapcsolható.
- A frissítési és hibabejelentő linkek az új repócímre (`npu-uj-neptunhoz`)
  mutatnak; eddig a régi cím átirányítása miatt működtek.

## 3.0.3 — 2026. szept. 26. <a name="v3.0.3"></a>

- Rajtoló: javítva, hogy egyes egyetemek Neptunján (pl. ME) a kurzus Rajtolóhoz
  adásakor „A Rajtoló terve nem menthető” hibát kaptál. A hiányzó félév-azonosítót
  az NPU most a kurzuslista kéréséből pótolja.

## 3.0.2 — 2026. szept. 23. <a name="v3.0.2"></a>

- A színtéma a fejléc jobb felső sarkában lévő üzenetszámlálót is átszínezi: a
  menta helyett a választott szín világos árnyalatát kapja.
- A Neptun halványkék felületei (kezdőlapi sáv, felhasználói gomb, kiemelések,
  linkkék) is a választott színárnyalatot veszik fel, a saját világosságukat
  megtartva. A férőhely-jelvények színei nem változnak.
- Saját NPU-logó: a láblécben és a bejelentkező oldalon a felirat előtt, a
  README fejlécében és a Tampermonkey-listában is.

## 3.0.1 — 2026. szept. 23. <a name="v3.0.1"></a>

**Megjelenés**

- Színtéma: a Neptun kékje helyett választható kiemelőszín (8 előre beállított
  árnyalat vagy tetszőleges egyéni szín). A fejléc és a lábléc ennek sötét
  árnyalatát kapja. A beállításokban élőben látszik, a Mégse visszaállítja.
- Átdolgozott beállításpanel: kapcsolók jelölőnégyzetek helyett, csoportonként
  kártya, animált lenyitás.
- Az NPU ablakainak címe már nem tapad a felső szélhez, és a gombjaik a
  kezdőlapon is mind a négy sarkukon kerekek.

**Tárgyfelvétel**

- Időpont a megjegyzésből: ha egy kurzusnak nincs órarendi adata, de az oktató
  a megjegyzésbe írta az időpontot (pl. „Hétfő 14-15, A1/216”), az NPU onnan
  olvassa ki a napot, az időt és a termet. Kiírja a kurzus alá, és az
  ütközésvizsgálat, valamint a Rajtoló is számol vele. Az órarendi ütközések
  alopciójaként kikapcsolható.

**Kiadás**

- A kiadás verzióját a tag adja; a GitHub felületén létrehozott release elég,
  a `package.json` utána automatikusan igazodik.

## 3.0.0 — 2026. szept. 20. <a name="v3.0.0"></a>

Az első v3-fejlesztési kiadás az új, Angular-alapú Neptun-felülethez. A v3 külön
kódra épül; a régi WebForms-modulok nem részei ennek a verziónak.

**Tárgyfelvétel**

- A kurzussorokon megjelenik, ha az adott időpont a Neptun natív tervezőjében
  lévő vagy már felvett kurzussal ütközik, a másik tárgy és időpont nevével.
- Alapból kikapcsolt, beállításból bekapcsolható, csak asztali tárgyfelvételnél
  működő kompakt nézet. Ez NPU-specifikus elrendezés, ezért nem írja át
  automatikusan a megszokott felületet; hogy kinek melyik nézet kényelmes,
  szubjektív.
- Alapból kikapcsolt táblázatos kurzuslista, mert a natív kurzuslistát NPU-
  specifikus nézetre cseréli, és a megszokott munkafolyamatot nem akarjuk
  automatikusan megtörni.
- A Rajtoló és a kurzussori jelzések ugyanazt az órarendi ütközésvizsgálatot
  használják.
- A modulkapcsolók már alapból kikapcsolt, külön bekapcsolható modulokat is
  kompatibilisen tudnak tárolni.

**További tárgyfelvételi változások**

- Alapból kikapcsolt, beállítással bekapcsolható tárgylista-automatikus betöltés,
  hogy ne indítson a felhasználó helyett automatikus keresést és extra kérést.
- A kurzusok mellett látszik a férőhely, a betelt állapot és a várólista;
  a tárgyakon az, hogy hány kurzusuk telt már be.
- A „Betelt kurzusok hátra" kapcsoló előre rendezi azt, amire még lehet
  jelentkezni, és a kapcsolása vissza is fordítható.
- A listák egy lapon lényegesen több sort töltenek be.

**Rajtoló**

- Saját, felhasználó és félév szerint tárolt terv, soros beküldéssel.
- Időszakválasztó a Neptun saját tárgyfelvételi időszakaiból, szerverhez
  igazított visszaszámlálással.
- Órarendütközés-jelzés és kredit-előrejelzés a terven belül.
- A várólistára kerülést külön jelzi a sikeres felvételtől.
- Ismeretlen szerverválasznál megáll, nem könyvel el találgatott sikert.

**Egyéb**

- Kreditbontás tárgytípusonként a fejléc saját kártyájában.
- Alapból kikapcsolt munkamenet-frissítés, mert háttérforgalmat indít; aktív
  használat mellett megújítja a közeli lejáratú munkamenetet, tétlen lapot nem
  tart életben.
- Bejelentkezés után felajánlja a visszatérést a legutóbbi oldalra.
- Az NPU neve és verziója a bejelentkező oldalon és a láblécben, a lábléc
  hibabejelentő linkjével együtt.

**Ami szándékosan kimaradt**

- `autoLogin`: a 2FA, a karbantarthatóság és a jelszókezelés kockázatai miatt.
- A bizonytalan adatokra épülő mintatantervi hiány-nézet.
- Az üzenetek tömeges olvasottra állítása kimaradt. Az alapja elkészült, de az
  élő oldalon nem találtunk hozzá biztonságosan használható lapozási végpontot.

**Adatvédelem**

- A régi `neptun.users` GM-kulcsot az új kód nem olvassa, nem importálja és nem
  törli. A saját `data.users` rekordokban maradt érzékeny bejelentkezési
  mezőket induláskor kitisztítja, a nem érzékeny terveket és adatokat megtartja.

**Korlátok**

- Az intézményenkénti működési állapotot a [TESTED.md](TESTED.md) tartalmazza.
- A sikeres és a ténylegesen betelt tárgyfelvételi válasz éles ellenőrzése még
  hátra van; ezek csak nyitott tárgyfelvételi időszakban mérhetők.

## 2.x és korábbi kiadások — történeti archívum

Az alábbi bejegyzések a korábbi README-ből kerültek át.
A régi WebForms-funkciók történetét őrzik, nem a jelenlegi v3 funkciólistáját.

### 2024. augusztus 23.

- **Javítva:** Az automatikus átirányítás a legutóbb megtekintett Neptun oldalra néha hibásan működött.

### 2022. december 9.

- **Újdonság:** A belépéskor mostantól lehetőség van bekapcsolni az automatikus átirányítást a legutóbb megtekintett Neptun oldalra. – _FeaXR_
- **Fejlődés:** A fejléc eltüntetéséhez a szkript mostantól a Neptun beépített funkcióját használja, így az szükség esetén ismét megjeleníthető. – _FeaXR_

### 2021. december 21.

- **Újdonság:** A vizsgajelentkezés oldalon mostantól lehetőség van a nem jelentkezett vizsgák elrejtésére. – _FeaXR_
- **Újdonság:** A Neptun PowerUp! verziója most már a Neptun bejelentkezési oldalán is megjelenik.
- **Javítva:** Egy Neptun-frissítés elrontotta a felvett vizsgák oldalon a teljesített vizsgák hátterének színezését.

### 2021. december 3.

- **Javítva:** Az ELTE Neptun legutóbbi frissítése megakadályozta a szkript helyes működését. A probléma javításra került. – _MSZGs_

### 2021. január 30.

- **Fejlődés:** A szkript használata most már valamivel nehezebben észlelhető az üzemeltetők által.

### 2021. január 26.

- **Újdonság:** Az "önnek kitöltendő kérdőíve van" felugró ablak mostantól automatikusan elrejtésre kerül. – _nyuszika7h_
- **Fejlődés:** A szkript forráskódja teljesen át lett szervezve, ezzel megkönnyítve a jövőbeni módosításokat.

### 2020. szeptember 1.

- **Javítva:** A Corvinus Neptun-jának címe megváltozott, emiatt a szkript egyes böngészőkben nem működött. Ez a frissítés javítja a problémát.

### 2020. április 23.

- **Újdonság:** A szkript most már a legtöbb egyetem oktatói Neptun felületén is működik.

### 2018. december 19.

- **Javítva:** A legutóbbi Neptun frissítés (ismét) megakadályozta a szkript megfelelő működését a “felvett vizsgák” oldalon. – _Whisperity_

### 2018. május 29.

- **Javítva:** A legutóbbi Neptun frissítés megakadályozta a szkript megfelelő működését a “felvett vizsgák” oldalon. – _Whisperity_

### 2018. január 7.

- **Fejlődés:** Ez a frissítés javítja a vizsgaeredmények sikeres és sikertelen kategóriákba való besorolását, hogy a vizsgák színezése lehetőség szerint minden egyetemen jól működjön.
- **Javítva:** A vizsgajelentkezés oldalon a “teljesített tárgyak vizsgáinak elrejtése” funkció tévesen elrejtette a már sikeresen teljesített tárgyak felvett, de még eredménnyel nem rendelkező javítóvizsgáit.
- **Javítva:** A felvett vizsgák oldalon bizonyos vizsgák mellett a szkript hibás működése miatt nem jelent meg a “részletek” menü ikonja.

### 2017. december 8.

- **Javítva:** A vizsgajelentkezés oldal bizonyos esetekben teljesítettnek tekintett “nem vizsgázott” státuszú vizsgákat. Ez a frissítés javítja a problémát, és megakadályozza a jövőben a nem teljesített vizsgák téves elrejtését.
- **Javítva:** A szkript hibásan színezte a tárgyválasztó menü elemeit a vizsgajelentkezés oldalon.

### 2017. november 27.

- **Javítva:** A Firefox 57-es frissítése és a GreaseMonkey új 4-es verziója elrontott pár dolgot a szkript működésében. Ez a frissítés javítja a problémát.

### 2017. szeptember 11.

- **Újdonság:** A szkript hozzáad egy “most nem érdekel” gombot az “új hivatalos üzenet” értesítés ablakához, amelyet megnyomva az értesítés eltüntethető az üzenet megtekintése nélkül is.
- **Javítva:** Egyes esetekben a tárgyjelentkezés oldalon lévő táblázat fejlécében nem jelent meg a szűrés jelölőnégyzet és a törlés link.

### 2017. január 16.

- **Javítva:** Bizonyos esetekben az átsorolási kérelem Neptun-oldal nem működött megfelelően. Ez a frissítés javítja a hibát.

### 2017. január 15.

- **Újdonság:** A vizsgajelentkezés oldalon található tárgylistában mostantól nem jelennek meg azok a tárgyak, melyekhez nem tartozik vizsga. – _Whisperity_
- **Javítva:** A legutóbbi Neptun-frissítés elrontotta a félévválasztó menü szűrését. Ez a frissítés javítja a hibát. – _Whisperity_

### 2016. augusztus 17.

- **Újdonság:** A félévválasztó menüben csak a képzés felvétele utáni félévek jelennek meg. – _Whisperity_

### 2016. július 24.

- **Javítva:** A tárolt kurzusok bizonyos esetekben nem töltődtek vissza megfelelően. Ez a frissítés javítja a problémát.

### 2016. június 15.

- **Javítva:** A felvett de még nem teljesített vizsgák most már helyesen színeződnek. – _Whisperity_

### 2016. június 13.

- **Újdonság:** Mostantól lehetőség van elrejteni a sikeresen teljesített tárgyak vizsgáit a vizsgajelentkezés oldalon. – _Whisperity_
- **Újdonság:** A vizsgajelentkezés oldalon a szkript zöldre színezi a már sikeresen teljesített tárgyakat és pirosra a csak sikertelen vizsgákkal rendelkezőket. Az először felvett vizsgák továbbra is sárga színnel jelennek meg. – _Whisperity_
- **Újdonság:** A felvett vizsgák oldal is színesebb lett, a vizsgajelentkezés oldalhoz hasonló színezési szabályokkal. – _Whisperity_

### 2016. május 23.

- **Javítva:** Chrome alatt a szkript most már nem dobál figyelmeztetéseket minden oldalbetöltés után.

### 2015. szeptember 3.

- **Javítva:** Telt ház esetén az automatikus újrapróbálkozás egy hiba miatt bizonyos esetekben egyáltalán nem működött Firefox alatt. Ez a frissítés várhatóan javítja a problémát.
- **Javítva:** A Neptun Meet Street menüelem nem működött Firefox alatt.

### 2015. augusztus 28.

- **Javítva:** A szkript bizonyos esetekben egyáltalán nem volt hajlandó futni. Ez a frissítés remélhetőleg javítja a problémát.

### 2015. január 27.

- **Javítva:** A tárgyak tárolása nem működött megfelelően, ha a tárgyfelvétel oldalon a _minden további intézményi tárgy_ lehetőség volt kiválasztva.
- **Javítva:** A szkript problémába ütközött a tárolandó tárgy kódjának megállapításakor, ha a tárgykódban több zárójel is szerepelt. Mivel ez már legalább a harmadik ilyen jellegű probléma, a tárgykódot megállapító algoritmust teljesen újraírtam.

### 2015. január 14.

- **Fejlődés:** A szkript mostantól csak akkor lép működésbe, ha meggyőződött arról, hogy egy Neptun oldalon fut éppen. Erre azért van szükség, mert egyes felhasználók kézzel átállították a szkript beállításait, hogy az ne csak a Neptun-os oldalakon fusson, amelynek hatására a felhasználói statisztika tele lett szemetelve oda nem illő weboldalak címeivel.

### 2014. december 20.

- **Javítva:** A szkript hibásan tárolta a tárgyakat, ha a tárgynévben zárójelek is szerepeltek. Az új verzió javítja ezt a problémát. A frissítés után a hibásan tárolt tárgyaknál törölni kell a tárolt kurzusokat, majd ismét tárolni kell őket ahhoz, hogy immár helyesen kerüljenek mentésre.

### 2014. november 30.

- **Javítva:** A Neptun legutóbbi frissítése olyan módosításokat tartalmazott, melyek miatt nem lehetett többé tárgyakat tárolni a tárgyfelvétel oldalon. Ez a frissítés javítja a problémát.
- **Újdonság:** Mivel van pár egyetem, ahol használják a Neptun Meet Street-et, a menüsor végére felkerült egy Meet Street link, amellyel át lehet váltani rá, ha már a szkript eltünteti a fejlécet. A Meet Street felületén szintén ugyanitt található egy másik link a tanulmányi rendszerre való visszaváltáshoz.

### 2014. szeptember 6.

- **Javítva:** A Firefox 30-as frissítése jelentősen megváltoztatott bizonyos dolgokat a motorháztető alatt, melyek teljesen elrontották a szkript működését. Ez a frissítés remélhetőleg javítja a problémát, és ismét működőképessé teszi a programot a Firefox újabb verziói alatt.
- **Fejlődés:** A tárgyfelvétel oldalon a “csak a meghirdetett tárgyak” jelelőnégyzet működése megváltozott. Az automatikus tárgylistázás most már a négyzet ki- és bepipálásakor is megtörténik.
- **Eltávolítva:** A képzésválasztó menü megjelenítését kijavították a Neptun fejlesztői, így már nincs szükség beavatkozásra ahhoz, hogy az oldal újratöltése nélkül jelenjen meg.

### 2014. február 6.

- **Javítva:** A szkript hibásan tárolta a tárgyakat, ha a tárgykódban zárójelek is szerepeltek. Az új verzió javítja ezt a problémát. A frissítés után a hibásan tárolt tárgyaknál törölni kell a tárolt kurzusokat, majd ismét tárolni kell őket ahhoz, hogy immár helyesen kerüljenek mentésre.

### 2014. január 30.

- **Újdonság:** A szkript mostantól minden oldalon megjegyzi, hogy utoljára melyik félév volt kiválasztva, és automatikusan visszavált rá, ha a Neptun okosabbnak hiszi magát, és elállítja.
- **Újdonság:** A képzésválasztó menü az oldal újratöltése nélkül jelenik meg.
- **Újdonság:** A program lecseréli a Neptun teljes képernyős betöltés-jelzőjét egy “Kis türelmet” feliratra, amely kevésbé zavaró.
- **Fejlődés:** A félévválasztó menüben való kattintáskor a kijelölés azonnal átáll az új félévre, ezzel kellemesebb felhasználói élményt biztosítva.

### 2013. december 24.

- **Újdonság:** Az órarend megnyitáskor automatikusan a mai napra ugrik, ha esetleg nem lenne ott, javítva ezzel a Neptun idegesítő hibáját.
- **Újdonság:** A szkript módosít néhány színt a leckekönyv oldalon, hogy jobban látszódjon, melyik tárgy lett már teljesítve: ezek zölddel jelennek meg.

### 2013. december 14.

- **Újdonság:** A szkript módosít néhány színt az előrehaladás oldalon (amely a tanulmányok menüben található), hogy jobban látszódjon, melyik tárgy lett már felvéve (sárga) és teljesítve (zöld).

### 2013. december 7.

- **Újdonság:** A tárgyak listája fölött megjelenik egy jelölőnégyzet, mellyel beállítható, hogy csak a tárolt kurzussal rendelkező tárgyak jelenjenek meg a listában. Ezt bepipálva még gyorsabbá válik a tárgyfelvétel.

### 2013. december 6.

- **Fejlődés:** A mentett bejelentkezési adatokat a program egyetemenként külön-külön tárolja, így a bejelentkezésnél most már csak az adott egyetemen használt felhasználónevek jelennek meg.
- **Fejlődés:** A tárolt kurzusokat a program mostantól csak azon a képzésen jelzi, amelyen el lettek tárolva, a párhuzamos szakokkal rendelkezők nagy örömére. Az új verzió telepítése előtt eltárolt kurzusok továbbra is megjelennek az összes szaknál, amíg nem törlöd őket.

### 2013. augusztus 20.

- **Fejlődés:** A tárgyfelvételnél a program pótolja a kurzusok jelölőnégyzeteit, ha azok esetleg nem jelennének meg. Így a tárgyak tárolása és az 1 kattintásos tárgyfelvétel most már elvileg az összes egyetemen működik.

### 2013. július 19.

- **Javítva:** A legutóbbi Neptun verziófrissítés működésképtelenné tette a szkript néhány funkcióját. Ez a frissítés javítja a problémát.
- **Javítva:** A tárgyfelvétel oldalon a szkript bizonyos (meglehetősen ritka) esetekben hibásan módosította a színeket.

### 2013. január 31.

- **Fejlődés:** A tárgyak listája fölött megjelenik egy link, amellyel a tárgyak sikeres felvétele után az összes tárolt kurzus egyszerűen törölhető.
- **Fejlődés:** Apróbb változások a tárolt tárgyak funkció működésében.

### 2013. január 30.

- **Fejlődés:** A tárgyfelvételnél a program engedélyezi a letiltott kurzusok jelölőnégyzeteit, hogy azokat is el lehessen tárolni 1 kattintásos tárgyfelvétel céljából, ezzel lehetővé téve a funkció használatát egyes egyetemeken.

### 2013. január 28.

- **Újdonság:** A tárgyfelvételnél a bejelölt kurzusok listája tárolható a helyi gépen, a tárolt kiválasztás pedig egy kattintással visszaállítható a tárgyak ablakában. Ezzel a tárgyak felvétele két kattintásra rövidül.

### 2013. január 26.

- **Javítva:** A szabad helyre várakozásnál eddig előfordulhatott, hogy a szkript meghülyül, és egyre gyorsuló ütemben néhány perc alatt több ezer kísérletet tesz a belépésre. Az új verzió remélhetőleg javítja a problémát.

### 2013. január 25.

- **Fejlődés:** A kidobás elleni védelem sokkal intelligensebb lett, ugyanis most már figyelembe veszi azt is, hogy az adott egyetemen pontosan hány perc inaktivitás van engedélyezve.
- **Fejlődés:** A program belső struktúrája jelentős változtatásokon esett át, így a forráskód most már sokkal könnyebben olvasható. Emiatt a későbbi fejlesztések remélhetőleg gyorsabbak és egyszerűbbek lesznek.

### 2013. január 14.

- **Fejlődés:** Új, különálló menüelemek helyett a program mostantól a menüsor meglévő elemeit alakítja át gyorslinkekké. A _Tanulmányok_ szövegre kattintva a _Leckekönyv_ oldal, a _Tárgyak_ szövegre kattintva a _Tárgyjelentkezés_ oldal, míg a _Vizsgák_ szövegre kattintva a _Vizsgajelentkezés_ oldal jelenik meg. Egyedül az _Órarend_ menüelem maradt meg különállóként.

### 2012. december 1.

- **Javítva:** Az automatikus bejelentkezés nem működött az ELTE szerverén.

### 2012. november 16.

- **Javítva:** A legutóbbi Neptun verziófrissítés működésképtelenné tette a szkript néhány funkcióját. Ez a frissítés javítja a problémát.

### 2012. szeptember 7.

- **Újdonság:** A tárgyfelvétel oldalon a felvett tárgyak sárga háttérrel, míg a teljesített tárgyak zöld háttérrel jelennek meg; így egyszerűbb különbséget tenni közöttük.
- **Fejlődés:** Az egységesség kedvéért a felvett vizsgák zöld helyett sárga háttérrel jelennek meg a vizsgajelentkezés oldalon. Sajnos arra nincs mód, hogy a program más színnel jelölje a sikeres vizsgákat.

### 2012. augusztus 26.

- **Újdonság:** Tetszőleges számú automatikus próbálkozás a szabad helyre várakozásnál, az eredeti 30 helyett, valamint próbálkozás 5 másodpercenként, az eredeti 10 helyett.
- **Újdonság:** Az oldalméret minden egyes listánál automatikusan 500-ra áll be, és a program elrejti az oldalméret-választó mezőt.

### 2012. augusztus 25.

- **Javítva:** A szakirányjelentkezés oldalon nem működött az új félévválasztó.
- **Javítva:** Az új félévválasztó egyes oldalakon felesleges lekéréseket küldött a Neptun szerverének. Ez a frissítés javítja a problémát.
- **Fejlődés:** Az új félévválasztó gombjai az új verzióban sokkal jobban néznek ki.
- **Fejlődés:** A tárgyfelvétel oldal kurzusválasztó ablakában a kurzusok színezését végző kód egyszerűbb és gyorsabb lett.

### 2012. augusztus 21.

- **Javítva:** Egy Neptun frissítés néhány hibát okozott az automatikus bejelentkezés működésében. Az új verzió már megfelelően működik.
- **Újdonság:** A program az összes oldalon lecseréli a félévválasztó menüt egy könnyebben használható listára, ezzel megspórolva néhány kattintást a félévváltáskor. Keresd a kék félév-gombsort.

### 2011. december 21.

- **Javítva:** A tárgyfelvétel oldal kiegészítései egyes egyetemek Neptun-jain nem működtek, mert ott más beállításai voltak a rendszernek.
- **Újdonság:** A menüben a hülye javascript-es linkeket a szkript lecseréli hagyományos linkekre, melyek megnyithatók új lapon a jobb gombos menüből, vagy a középső gombra kattintva. Ezen kívül a lap címe tartalmazza az aktuálisan megnyitott Neptun oldal címét.

### 2011. december 13.

- **Javítva:** Az automatikus bejelentkezésnél bizonyos esetekben a program feleslegesen kérdezett rá a jelszó módosítására.

### 2011. szeptember 14.

- **Javítva:** Az előző verzió bizonyos esetekben felesleges lekéréseket küldött a Neptun szerverének. Ez a frissítés javítja a problémát.
