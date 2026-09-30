# Közreműködés

Van egy ötleted, ami megkönnyítené a Neptunt? Írd meg modulként. Az NPU
funkciói **modulok**: egy modul egy fájl, be- és kikapcsolható, és pull
requestben kerül be. Ez a lap arról szól, hogyan írj egyet.

A fejlesztői környezet, a build és a parancsok a
[DEVELOPMENT.md](DEVELOPMENT.md) lapon vannak.

## Miért nem futásidejű plugin?

A modulok a repóban élnek és a buildbe fordulnak, nem futásidőben töltődnek be
idegen forrásból. Ez tudatos: a szkript a felhasználó bejelentkezett
Neptun-munkamenetében fut, és bármilyen plugin API óhatatlanul odaadná az
`interceptor.getAuthHeader()` értékét és a saját hitelesített kérés jogát —
vagyis **idegen kód tudna tárgyat felvenni és leadni a felhasználó nevében**.

Ezért minden modul kódja átnézve kerül be. Cserébe a felhasználó minden modult
külön ki tud kapcsolni, tehát a „nem kérem ezt a funkciót" eset is meg van oldva.

## Egy modul szerződése

```js
// src/modules/példa.js

// Ez látszik a beállítás-panelen. Az `id` egyben a kapcsoló tárolási kulcsa is,
// úgyhogy ha egyszer kiadtuk, ne változzon.
const meta = {
  id: "példa",
  name: "Rövid, felhasználói név",
  description: "Egy mondat arról, mit csinál. Ezt olvassa a felhasználó.",
  // Hol jelenik meg a Neptunban, a menü neveivel („Tárgyak › Tárgyfelvétel: …”).
  // A panel „Hol:” sorként mutatja; a teszt minden modulnál és alopciónál
  // megköveteli.
  where: "Tárgyak › Tárgyfelvétel: gomb a szűrők mellett",
  // Csoport a panelen és a README-ben: registration, rajtolo, daily, comfort.
  group: "registration",
};

// Fusson-e ezen az oldalon? Olcsó és szinkron legyen.
function shouldActivate() {
  return true;
}

// Itt regisztrálj interceptor-kötést és DOM-figyelőt. Szinkron fut, az Angular
// első kérése előtt.
function initialize() {}

module.exports = { meta, shouldActivate, initialize };
```

Regisztrálni a [`src/index.js`](../src/index.js) `modules` tömbjében kell — az a
lista a funkciók egyetlen valódi forrása.

Ha a modul kinövi az egy fájlt, kaphat saját mappát `index.js`-szel, ahogy a
Rajtoló; a `require("./modules/valami")` így is működik.

### A be/kikapcsolás

A kapcsolókat a [`src/settings.js`](../src/settings.js) kezeli. Amit tudni érdemes:

- Csak az alapértéktől eltérő modulkapcsolók kerülnek tárolásra. A szokásos,
  alapból bekapcsolt modulnál ez a kikapcsolás, az opt-in modulnál a bekapcsolás.
  Egy később hozzáadott modul így a saját alapértékével indul.
- `meta.required: true` esetén a modul nem kapcsolható ki. Ezt csak akkor
  használd, ha a modul nélkül a többi elérhetetlen lenne — jelenleg egyedül a
  lábléc ilyen, mert azon keresztül nyílik a beállítás-panel.
- A flageket **szinkron** olvassuk `document-start`-kor. Ha van `GM_getValue`,
  közvetlenül abból; a csak Promise-alapú `GM.getValue`/`GM.setValue` API-t adó
  kezelőknél egy `localStorage`-cache-ből. Erre azért van szükség, mert egy
  interceptor-kötést regisztráló modulnak az Angular első kérése előtt kell
  lefutnia. A cache kizárólag modulazonosítókat és `false` értékeket tartalmaz;
  fiókadat, token és Rajtoló-terv nem kerül bele.
- A váltás **az oldal újratöltésekor** lép életbe. Egy futó modul már
  regisztrált kötéseket és figyelőket, amiket nem lehet tisztán visszavonni.

## Amit a PR-nek tartalmaznia kell

**1. A modult**, az alábbi invariánsok betartásával.
A négy, amin a legtöbb PR elbukna:

- Mért adat nélkül ne állíts semmit. Ha nem tudod, ne mutass helyette becslést.
- Ne rögzíts Angular `_ngcontent-*` / `_nghost-*` hasht — az minden buildnél
  változik. Klónozz élő elemet helyette.
- Megjelenítési feliratra ne építs **döntést**. A `type` csak megjelenítési
  szöveg; kurzuscsoportosításhoz a `comparationTypeId` az elsődleges kulcs. Ha az
  azonosító hiányzik, a kód csak ellenőrzött tartalékúton dönthet.
- Minden DOM-érintés legyen guardolva. Eltérő felületen a modul ne dobjon
  hibát, hanem csendben ne csináljon semmit.

Az oldalra tett minden NPU-vezérlőt (gomb, kapcsoló, indító) jelölj meg a
`utils.markNpu(elem, "mit csinál")` hívással, a `setButtonLabel` után. Ez az
NPU ikonját teszi a felirat elé, és „… – NPU-funkció” súgót ad, így senki sem
hiszi a Neptun sajátjának, és nem az egyetemnek jelenti a hibáját. A
`cloneButton` a jelölést leszedi, a `setButtonLabel` megtartja. Az NPU saját
paneljein és ablakaiban lévő gombokat nem kell jelölni.

**2. Legalább egy futtatható ellenőrzést** a `test/` alatt. A döntési logikát
szervezd tiszta, exportált függvényekbe, és azokra írj `assert`-et. A
DOM-illesztésre nem várunk tesztet — az a saját fake-jét ellenőrizné.

**3. Mérést, ha új Neptun-viselkedésre épül.** Új endpoint vagy válaszmező csak
akkor kerülhet kódba, ha a maszkolt sémája bekerül az [API.md](API.md)
katalógusba is. Találgatott mezőnév nem megy át. A maszkolásról:
`<guid>`, `<numeric-term-id>` — valódi azonosító, név, jegy nem kerülhet be.

**4. Zöld `npm run verify`-t** (eslint, prettier, selfcheck).

## A folyamat

1. Ha nem vagy biztos benne, hogy az ötlet belefér, **nyiss előbb egy issue-t**.
   Olcsóbb megbeszélni, mint megírni.
2. Nyiss PR-t. Írd le, mit csinál a modul, és min mérted.
3. Átnézzük, és **csak jóváhagyás után kerül be**.

Amit a review néz: a fenti négy pont, a biztonsági invariánsok, és hogy a
funkció valódi hiányt tölt-e be. Amit a Neptun natívan tud — naptár, tervező,
szerveroldali szűrés —, azt nem építjük újra.

## Amit nem építünk

Az NPU azért van, hogy a hallgatóknak kevesebb stresszt okozzon a Neptun, nem
azért, hogy az egyetemnek vagy a Neptun szervereinek ártson (lásd a README
[Amiért csináljuk](../README.md#amiért-csináljuk) részét). Nem kerül be olyan
modul, amely:

- a felhasználó kattintása nélkül, időzítve vagy a háttérben küld kérést;
- ismételgeti ugyanazt a kérést, vagy folyamatosan figyeli a férőhelyeket;
- a kézi használatnál jobban terheli a szervert;
- belépést, kétlépcsős azonosítást vagy CAPTCHA-t kerül meg.

Ha nem biztos, hogy az ötleted belefér, nyiss előbb egy beszélgetést.

## Amit soha ne küldj be

Jelszót, sütit, `Authorization` fejlécet, access tokent, teljes hálózati
exportot, valódi Neptun-kódot, nevet vagy jegyet — sem kódban, sem tesztadatban,
sem hibajegyben, sem képernyőképen. A tesztadat legyen mesterséges és minimális.

## Nem kód, de sokat ér

Ha nem modult írnál, hanem csak kipróbálnád a saját intézményeden: az a
legértékesebb visszajelzés, amit most kaphatunk. A [TESTED.md](TESTED.md) leírja,
mit nézz meg és hogyan jelezd.
