# Fejlesztői útmutató

Ez a fájl a Neptun PowerUp! fejlesztéséhez szól. A felhasználói telepítés a
[README.md](../README.md), a mért endpointok és válaszmezők az
[API.md](API.md) oldalon vannak.

## Dokumentációs térkép

- [README.md](../README.md) – telepítés és használat hallgatóknak.
- [CHANGELOG.md](CHANGELOG.md) – a 2011–2024-es kiadástörténet és a v3
  fejlesztés alatti változásai.
- [API.md](API.md) – az egyetlen kanonikus, maszkolt endpoint- és
  válaszséma-katalógus.
- [TESTED.md](TESTED.md) – intézményenkénti működési állapot.
- [CONTRIBUTING.md](CONTRIBUTING.md) – hogyan írj és küldj be egy modult.

## Környezet és parancsok

Node.js 20 vagy újabb és npm szükséges. A függőségeket a lockfile alapján
telepítsd:

```sh
npm ci
```

A fontos parancsok:

```sh
npm run build          # dist/npu.user.js létrehozása
npm run verify         # ESLint, Prettier és selfcheck
node selfcheck.js      # a tiszta logikai és wrapper-ellenőrzés önállóan
```

A selfcheck futtató a `selfcheck.js`, az ellenőrzések a `test/` alatt vannak.
Nincs keretrendszer: minden fájl a beolvasásakor futtatja az `assert`-jeit, és
ha van awaitolni valója, `run()` néven exportálja. Új ellenőrzés a tárgykörének
megfelelő `test/*.test.js` fájlba megy, a közös böngésző-fake-ek pedig a
`test/helpers.js`-be.

A `dist/` generált kimenet, nem forrásfájl, és a Git nem követi. A kiadott
userscriptet mindig a buildből kell előállítani; a repógyökérben nincs külön
telepítési artifact.

## Helyi fejlesztői loader

Egyszeri helyi telepítéshez:

```sh
npm run build
npm run dev:loader
```

Ez létrehozza a `dist/npu.dev.user.js` Tampermonkey-stubot. A stub nem másolja
be a bundle-t, hanem `file://` `@require`-ral a helyi
`dist/npu.user.js`-t tölti be. Tampermonkeyban ezt a stubot kell egyszer
telepíteni. Chromium-alapú böngészőben engedélyezd a Tampermonkey helyi fájlokhoz
való hozzáférését, ha a böngésző letiltja a `file://` betöltést.

Folyamatos buildhez:

```sh
npm run dev
```

A parancs újraírja a stubot és watch módban futtatja a webpacket. Forrásmentés
után töltsd újra a Neptun lapját. A fejlesztői stub szándékosan `0.0.0`-s, így
nem keveredik a kiadott verzióval.

## Build és release

A webpack belépési pontja a `src/index.js`, a metadata a `src/meta.txt` fájlból
érkezik, a kimenet pedig `dist/npu.user.js`. A build a verziót a
`package.json`-ból olvassa.

A `.github/workflows/release.yml` `v*` tag pusholásakor (ide tartozik az is, ha a
tagot a GitHub felületén, új release létrehozásakor hozod létre):

1. Node 20 környezetben lefuttatja az `npm ci` parancsot;
2. a verziót a tagből veszi (`v3.0.2` → `3.0.2`); a tag csak `vX.Y.Z` alakú lehet;
3. buildel és lefuttatja az `npm run verify` ellenőrzést;
4. a `dist/npu.user.js` fájlt `npu.user.js` néven feltölti a GitHub release-be;
5. a default branchen a `package.json` verzióját a taghez igazítja (visszafelé
   sosem lépteti), és a README legfeljebb három legfrissebb stabil release-ét
   frissíti a `docs/CHANGELOG.md` megfelelő verziószakaszaival együtt.

Release előtt lokálisan legalább ezt futtasd:

```sh
npm run build
npm run verify
git diff --check
```

A kiadás maga: írd meg a [CHANGELOG.md](CHANGELOG.md) bejegyzését, majd GitHubon
hozz létre egy új release-t új `vX.Y.Z` taggel a master branchre. A verziót nem
kell kézzel átírni. Parancssorból ugyanez:

```sh
git tag -a v3.0.2 -m "Release v3.0.2"
git push origin v3.0.2
```

GitHubon a kiadási asset csak a tag feldolgozása után jön létre (kb. egy perc);
a workflow futását az Actions fülön látod.

Kiadási assetként ne tölts fel személyes adatot, tokent, sütit vagy fejlesztői
`file://` stubot.

## Rövid architektúra

```text
Neptun Angular XHR/fetch
          │
          ▼
  src/interceptor.js ──► JSON-válaszok, Date, Authorization-fejléc
          │
          ├── src/router.js ──► valódi SPA pathname-váltások
          └── src/modules/* ──► kis, route- és API-alapú funkciók
                               │
                               └── src/storage.js ──► Tampermonkey GM-tár
```

Az `index.js` az Angular első kérései előtt telepíti az interceptort és a
route-figyelőt, majd regisztrálja a modulokat. A modulok szerződése a
`shouldActivate()` és `initialize()` export.

Egy modul egy fájl, egy kivétellel: a Rajtoló elég nagy ahhoz, hogy saját mappát
kapjon, és a részei külön is érthetők maradjanak.

```text
src/modules/rajtolo/
  index.js      állapot, interceptor-kötések, mountolás
  plan.js       a terv adatai és minden tiszta transzformációja
  protocol.js   mit jelentenek a szerver válaszai, mi menjen legközelebb
  engine.js     maga a futás, injektált hatásokkal
  net.js        a modul saját hitelesített kérései
  ui.js         a tervező dialógus
  rows.js       a kapcsoló és a badge az oldalon
  constants.js  mért horgonyok és hangolható értékek
```

A `plan.js`, a `protocol.js` és az `engine.js` DOM- és hálózatmentes, ezért a
selfcheck közvetlenül hajtja őket. A hálózati adatfeldolgozás a mért
JSON-válaszokra épül; a DOM csak a Neptun meglévő elemeihez való óvatos
illesztésre szolgál.

Az `src/storage.js` inicializáláskor megtisztítja a korábbi v1/v3
`data.users` rekordokban maradt credential mezőket, miközben a terveket és más
nem érzékeny adatot megtartja. A régi `neptun.users` GM-kulcsot nem olvassa,
nem importálja és nem törli. A régi `neptun.courses` értékből csak biztonságos
kulcsokkal kerülhet nem érzékeny kurzusválasztás a `courses._legacy` alá; a
régi GM-források érintetlenek maradnak.

Az interceptor az oldal saját XHR-kéréseiből jegyzi meg az `Authorization`
fejlécet, mert az API ugyanazon originről érkező saját kéréshez is elvárja ezt.
Az NPU nem keres tokent `sessionStorage`-ban és nem továbbítja azt külső
szerverre. A saját hálózati kérések teljes, UI-triggerhez kötött leltára a
következő; a végpontok maszkolt sémája az [API.md](API.md) kanonikus
helyén van.

## Saját hitelesített kérések

A modulok többsége csak a Neptun alkalmazás saját forgalmát figyeli, illetve
azt módosítja. Az alábbiak azok a kérések, amelyeket az NPU maga indít. Mindegyik
ugyanazon originre megy, és kizárólag az alkalmazás korábban látott
`Authorization` fejlécét használja; token-tárból nincs olvasás.

| Modul                                      | Saját kérés és indítási feltétel                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `occupancy`                                | A **Betelt kurzusok hátra** kapcsoló csak a már betöltött kurzuslisták sorrendjét módosítja. A `GetSubjectsCourses` válaszait passzívan figyeli, és nem indít teljes tárgykatalógus-scan-t.                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `courseConflictHints` / `registrationData` | A `GetScheduledCourses` szűrésfüggetlen válaszát figyeli, és a felvett állapothoz csak ismert válaszmezőket használ. Ha az intézmény csak a planner megnyitásakor küldi a választ, a félév-ID ismeretében legfeljebb egy késleltetett fallback GET-et indít. A `GetSubjectsCourses` válaszait passzívan átveszi a Neptun saját tárgynyitásából; a teljes tárgykatalógust nem járatja végig háttérben.                                                                                                                                                                                                                               |
| `creditBreakdown`                          | Miután az app saját `SchedulableSubjects` kéréséből látja a numerikus `request.termId` értéket, modulindításonként egyszer indít `GET SubjectApplication/ScheduledSubjectsWithScheduledCourses?request.termId=<numeric-term-id>&request.withRegisteredSubjects=true` kérést. A `<numeric-term-id>` itt a kérésből jön, nem a válaszsor GUID-formájú `termId` mezőjéből.                                                                                                                                                                                                                                                             |
| `rajtolo`                                  | A tervező megnyitásakor `GET Periods/GetPeriods`, valamint szükség esetén a mentett kurzusok címkéihez `GET SubjectApplication/GetSubjectsCourses`; futtatáskor ugyanez frissíti a kurzusállapotot. A beküldés külön, soros `POST SubjectApplication/SubjectSignin`; minden megválaszolt beküldés után egy ellenőrző `GET SubjectApplication/GetSubjectsCourses` ugyanarra a tárgyra (Leállítás után nincs). Elindítva, a munkamenethez nem küld saját `GetNewTokens`-t: lejárt tokennél a nyitás előtti 90 mp-ben, illetve 10 percnél régebbi tokennél megnyomja a Neptun saját `#filter-table` gombját, és a Neptun maga frissít. Az Órarendtervező **Javaslatok** gombjára egy `GET SubjectApplication/GetScheduledCourses` (friss Tervező), majd tárgyanként egy-egy, soros `GET SubjectApplication/GetSubjectsCourses` a kiválasztott tárgyakra. Megerősített alkalmazáskor és visszavonáskor soros `POST SubjectApplication/UnScheduleCourse` és `POST SubjectApplication/ScheduleSubjectAndCourses` a Neptun Tervezőjére, majd egy visszaolvasó `GetScheduledCourses`. |
| `infiniteSession`                          | Saját kérést nem küld. A tárgyfelvételi oldalon, ha az oldal 12,5 perce nem küldött saját API-kérést, vagy a legutóbbi tokenfrissítés 10 percnél régebbi és a token lejárt, megnyomja a Neptun saját `#filter-table` gombját, és a Neptun maga frissít; más oldalon nem csinál semmit.                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `dailyOverview`                            | A kezdőlap megnyitásakor (és bejelentkezés után naponta legfeljebb egyszer, az értesítéshez) `GET Calendar/GetStudentTrainings`, `GET Calendar/GetCalendarEvents` (órák, vizsgák, időszakok, szünnapok, −60…+45 nap), `GET FinancialItem/GetItemsToBePayed`; 10 percig gyorsítótárazva.                                                                                                                                                                                                                                                                                                                                             |
| `gradeCalculator`                          | Csak az Átlagkalkulátor megnyitásakor, oldalbetöltésenként egyszer: `GET RegistrySheet/GetAdditionalStudentTrainingTermData`, majd legfeljebb két lezárt félévre `GET RegistrySheet/GetStudentTrainingTermData` és `GET RegistrySheet/GetStudentTakenSubjectsByTerm` a képlet ellenőrzéséhez. A tárgylistát a `TakenSubjects` válaszából passzívan veszi.                                                                                                                                                                                                                                                                           |

Az `paginationFixes`, a `courseAutoList` és a többi passzív modul az app saját
kéréseit figyeli vagy módosítja, de nem kerül külön saját GET-leltári sorba.

## Modulkapcsolók

Minden modul exportál egy `meta` objektumot (`id`, `name`, `description`), és a
felhasználó a lábléc „NPU beállítások" pontjából külön ki tudja kapcsolni őket.
Az opcionális `defaultEnabled: false` mezővel egy modul külön bekapcsolhatóként
indulhat; ezt használja a kompakt tárgyfelvételi nézet.

A kapcsolókat a `src/settings.js` kezeli, a panelt a `src/settingsPanel.js`
rajzolja. Két dolog nem nyilvánvaló benne:

- A flageket **szinkron** olvassuk `document-start`-kor, még a
  modulregisztráció előtt. Ha van `GM_getValue`, közvetlenül abból; a csak
  Promise-alapú `GM.getValue`/`GM.setValue` API-t adó kezelőknél egy
  `localStorage`-cache-ből. Így az interceptor-kötések az Angular első kérése
  előtt létrejönnek, miközben a panel a GM-tár tartós példányát olvassa és írja.
  A cache-ben csak modulazonosítók és `false` értékek vannak, fiókadat, token és
  Rajtoló-terv nincs.
- Csak az adott modul alapértékétől eltérő boolean kerül tárolásra. A szokásos,
  alapból bekapcsolt moduloknál ez `false`, az opt-in moduloknál `true`. A régi
  `false` értékek változatlanul kompatibilisek; a `meta.required` modul nem
  kapcsolható ki.

A váltás az oldal újratöltésekor lép életbe: egy futó modul már regisztrált
kötéseket és figyelőket, amiket nem lehet tisztán visszavonni.

## Közreműködés

Új modul beküldéséről a [CONTRIBUTING.md](CONTRIBUTING.md) szól: a modul
szerződése, a PR négy követelménye és a review folyamata.

## Változtatási szabályok

Módosítás előtt olvasd el a [mért API-katalógust](API.md). Neptun- vagy
intézményi állítást csak mért adat alapján írj le; a bizonytalan válaszra a kódnak
és a dokumentációnak is fail-closed módon kell viselkednie. A Rajtoló élő
sikeres beküldése és a valóban betelt kurzus elutasítása külön éles mérési kapu,
nem helyettesíti őket egy unit teszt vagy egy zárt időszak hibaválasza.

A munkafa többi módosítását őrizd meg, és munkafeladatból ne készíts automatikus
commitot. A felhasználó által beküldött hibajegybe ne kerüljön hitelesítési
fejléc, jelszó, süti vagy teljes hálózati export.
