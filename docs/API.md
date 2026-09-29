# Neptun NG API-katalógus

Ez a fejlesztői katalógus a Neptun PowerUp! által olvasott vagy mért NG
endpointokat és a hozzájuk tartozó, maszkolt sémát rögzíti. A `[Mért]` jelölés
azt jelenti, hogy a kérést vagy a választ láttuk egy valódi, belépett példányon;
nem jelenti azt, hogy minden üzleti kimenetet (például sikeres tárgyfelvételt)
is láttunk. Az `[Ismeretlen]` adatot a kód nem találhatja ki: hiányos vagy új
formátumnál csendben leáll.

## Mérési határ

Az alapmérés 2026. szeptember 15-én történt egy belépett NG-példányon, a
`/hallgato_ng/` útvonalon. A későbbi, 2026. szeptember 16-i és 17-i méréseket a
címsor külön jelzi. A mért válaszok eltérő konfiguráció vagy API-verzió esetén
változhatnak. A példákban a személyes vagy munkamenet-adat helyén mindig
`<guid>`, `<numeric-term-id>` vagy más `<placeholder>` szerepel.

## Közös szerződés

Az API alapútvonala:

```text
/hallgato_ng/api/<Controller>/<Action>
```

A legtöbb válasz a következő burkot használja:

```json
{
  "data": "<payload vagy tömb>",
  "notification": []
}
```

A `notification[]` üzleti hibát is jelenthet, akár HTTP 500 mellett. HTTP 200
önmagában ezért nem bizonyít sikeres műveletet, és HTTP 500 sem jelenti azt,
hogy a választest érdektelen. A `request.*` és `sortAndPage.*` query-paraméterek
ASP.NET Core model bindinget követnek. A tárgylista kérésének
`request.termId` értéke a mért numerikus kérés-ID (`<numeric-term-id>`). Ettől
külön namespace a válaszsorok saját `termId` mezője, amely GUID-formájú lehet;
a Rajtoló `SubjectSignin` kérése ezt a válaszból származó GUID-ot használja. A
két értéket nem szabad felcserélni.

Az Angular a saját XHR-kéréseihez `Authorization` fejlécet és munkamenet-sütit
használ. A katalógus nem tartalmaz valódi fejlécet, sütit vagy tokent. Az NPU a
fejlécet az oldal saját kéréseiből veszi át; token-tárat nem olvas.

## Tárgyfelvétel

### `GET SubjectApplication/SchedulableSubjects` — [Mért]

**Használat:** a tárgyfelvételi lista és a tárgyazonosítók forrása.

```http
GET /hallgato_ng/api/SubjectApplication/SchedulableSubjects?
  request.termId=<numeric-term-id>&
  sortAndPage.firstRow=0&sortAndPage.lastRow=<row>&...
```

Ebben a kérésben a `<numeric-term-id>` kifejezetten a query
`request.termId` értéke. A válasz `"termId": "<term-guid>"` mezője másik,
GUID-formájú azonosító; az nem helyettesíthető be ebbe a kérésbe.

Az NPU a mért `SchedulableSubjects` kérés `sortAndPage.lastRow` ablakát
legfeljebb 500 sorra szélesíti, az első sort megtartva. Ismeretlen lapozott
endpointot nem ír át. A mért sorok fontosabb mezői:

```json
{
  "id": "<subject-guid>",
  "title": "<subject title>",
  "code": "<subject-code>",
  "credit": 0,
  "type": "<subject-type>",
  "termId": "<term-guid>",
  "curriculumTemplateId": "<guid>",
  "curriculumTemplateLineId": "<guid>",
  "isRegistered": false,
  "isCompleted": false,
  "isInProgress": false,
  "isWaiting": false,
  "scheduledSubjectId": "<guid-or-null>",
  "scheduledCourseIds": ["<guid>"]
}
```

Az `id` az NPU join-kulcsa; név vagy kód alapján nem azonosítunk tárgyat.
`scheduledCourseIds` a Neptun natív tervezőjének kurzusazonosító-forrása, de nem
a Rajtoló inputja. A `courseConflictHints` csak az itt ténylegesen megkapott
azonosítókat veti össze a kurzussorokkal. A tárgylistán élőben külön látszott
`isRegistered: true` felvett tárgy és natív tervezőhöz adott tárgy is, de az még
`[Ismeretlen]`, hogy minden felvett tárgy kitölti-e hozzá a
`scheduledCourseIds` mezőt. A kód ezért nem állít teljes órarendi lefedettséget.
A Rajtoló továbbra is a felhasználó által külön kijelölt saját tervet használja.

<a id="api-getsubjectscourses"></a>

### `GET SubjectApplication/GetSubjectsCourses` — [Mért]

**Használat:** egy tárgy kurzusai, férőhelye és órarendi adatai. Az NPU ezt a
végpontot nem járatja végig háttérben: a Neptun saját kérését
figyeli, amikor a hallgató lenyit egy tárgyat. A **Betelt kurzusok hátra**
kapcsoló csak a már betöltött kurzuslistát rendezi.

```http
GET /hallgato_ng/api/SubjectApplication/GetSubjectsCourses?
  subjectId=<subject-guid>&termId=<term-guid>&
  curriculumTemplateId=<guid>&curriculumTemplateLineId=<guid>
```

Mért kurzussor:

```json
{
  "id": "<course-guid>",
  "subjectId": "<subject-guid>",
  "code": "<course-code>",
  "type": "<group-label>",
  "isFull": false,
  "registeredStudentsCount": 0,
  "maxLimit": 0,
  "willBeOnWaitingList": false,
  "isRankingCourse": false,
  "classInstanceInfos": [
    {
      "dayOfWeek": 1,
      "dayOfWeekText": "<label>",
      "startTime": "HH:MM",
      "endTime": "HH:MM",
      "rooms": "<room-or-empty>",
      "repetition": true
    }
  ]
}
```

`isFull` és `willBeOnWaitingList` külön állapot. Egy várólistás példában
`isFull: false, willBeOnWaitingList: true` értékkel engedélyezett a jelentkezés. A
rangsoros kurzusok éles jelentése és beküldési eredménye `[Ismeretlen]`.

### A kurzussor teljes mezőlistája — [Mért]

A fenti séma a használt mezőket sorolta. A teljes, élőben mért mezőlista ennél
sokkal bővebb; az alábbiak eddig kihasználatlanok voltak:

| Mező                                                                                 | Mit ad                                                                | Állapot                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- | ------------------------------ |
| `isSigned`                                                                           | **igaz pontosan azokra a kurzusokra, amelyeket a hallgató felvett**   | használjuk (ütközés-alapvonal) |
| `isOnWaitingList`                                                                    | a hallgató várólistán van-e ezen a kurzuson                           | használjuk (Rajtoló-eredmény)  |
| `comparationTypeId`                                                                  | a kurzustípus GUID-ja (Labor és Elmélet külön érték)                  | használjuk (csoportkulcs)      |
| `room`                                                                               | kurzusszintű terem, a `classInstanceInfos[].rooms` mellett            | használjuk                     |
| `note`                                                                               | „Megjegyzés”; üres órarendnél ebből olvassuk ki a napot, időt, termet | használjuk (órarend-tartalék)  |
| `tutorName`, `language`, `title`, `description`                                      | a Neptun sora részben mutatja                                         | kihasználatlan                 |
| `waitingStudentsCount`, `minLimit`, `maxWaitingStrength`                             | várólista-hossz és alsó létszámhatár                                  | kihasználatlan                 |
| `rankPoint1`, `rankPoint2`, `rankOrder`, `expectedRankOrder`, `expectedRankingPoint` | rangsoros kurzusok pontjai                                            | kihasználatlan                 |
| `teachingMethod`, `teachingMethodId`, `isOnline`                                     | oktatási forma                                                        | kihasználatlan                 |
| `signinRequirementText`, `isNotStarted`, `isEndorsementRequired`                     | jelentkezési feltételek                                               | kihasználatlan                 |
| `classInstanceTimeTableList`                                                         | második órarendi forrás a `classInstanceInfos` mellett                | kihasználatlan                 |
| `typeIdentifier`                                                                     | megjelenítési érték, **nem** használható kulcsként                    | —                              |

**Fontos mérési tény:** a `SchedulableSubjects[].scheduledCourseIds` a Neptun natív
_tervezőjének_ listája, **nem** a felvett kurzusoké. A kód ezért nem következtet
felvett kurzusra ebből a mezőből, hanem a kurzussor `isSigned` / `isRegistered`
állapotát használja, amikor az elérhető.

A `classInstanceInfos[].rooms` mezőt a Neptun saját kurzussora nem mindig írja ki
— az NPU ezért a kurzuskód alá teszi, ha elérhető. A kód az egy- és többalkalmas
kurzusokat is kezeli, és csak akkor ír saját sort, ha a Neptunén felül tud mondani
valamit.

A `repetition` jelentése nem elég stabil ahhoz, hogy az ütközésvizsgálat döntést
építsen rá. A kód ezt a mezőt ezért szándékosan nem olvassa: egy téves riasztás
látható és javítható, egy elmaradt nem.

<a id="api-subjectsignin"></a>

### `POST SubjectApplication/SubjectSignin` — [Mért kérés, részben ismeretlen válasz]

**Használat:** a Rajtoló által küldött, soros tárgyjelentkezés.

```http
POST /hallgato_ng/api/SubjectApplication/SubjectSignin
Content-Type: application/json
Authorization: <Angular által látott fejléc>
```

```json
{
  "subjectId": "<subject-guid>",
  "termId": "<term-guid>",
  "curriculumTemplateId": "<guid>",
  "curriculumTemplateLineId": "<guid>",
  "courseIds": ["<course-guid>", "<course-guid>"]
}
```

Mért, zárt időszak alatti hiba:

```json
{
  "data": null,
  "notification": [{ "description": "Jelenleg nincs tárgyjelentkezési időszak!", "type": 3 }]
}
```

A sikeres választest és a valóban betelt, nem várólistás elutasítás teljes
formája `[Ismeretlen]`, mert ezeket csak éles tárgyfelvételi időszakban lehet
felelősen mérni. A Rajtoló ismeretlen vagy időtúllépéses válasznál megáll, nem
könyvel találgatott sikert, és a már elküldött kérést nem próbálja visszavonni.

`401` (lejárt token) esetén a Rajtoló friss tokent kér a Neptuntól, és a kérést
**egyszer** újraküldi, hacsak közben le nem állították. Hogy egy 401-es
`SubjectSignin` semmit sem dolgozott fel, az **következtetés, nem mérés**: a
JWT-ellenőrzés az action előtt fut, és a Tervező-hívásoknál mértük, hogy a
Neptun maga is újraküldi a 401-es kérést. Élő tárgyfelvételi időszakban mérendő.

A fenti, mért „nincs tárgyjelentkezési időszak” választ a Rajtoló a futás első
30 másodpercében 300 ms-onként, egyesével újraküldi: ez a válasz semmit nem
dolgozott fel, így egy kicsit később nyitó intézménynél a beküldés a nyitás
pillanatában ér be. A 30 másodperc után ugyanez a válasz leállítja a futást.

### `GET SubjectApplication/ScheduledSubjectsWithScheduledCourses` — [Mért]

**Használat:** a fejléc és a Rajtoló kredit-előrejelzésének forrása.

```http
GET /hallgato_ng/api/SubjectApplication/ScheduledSubjectsWithScheduledCourses?
  request.termId=<numeric-term-id>&request.withRegisteredSubjects=true
```

A `<numeric-term-id>` itt is a tárgylista kéréséből átvett numerikus
`request.termId`; a válasz tárgysorának GUID-formájú `termId` mezője nem erre a
paraméterre való.

A válasz felvett és pusztán tervezett tárgyakat is tartalmazhat. Kreditet csak
`isRegistered: true` sorból számolunk. Ha a `type` hiányzik, az NPU a megjelenítés
kedvéért „Szabadon választható” csoportba teszi; ez NPU-következtetés, nem a
szerver által garantált tárgytípus.

### `GET SubjectApplication/GetScheduledCourses` — [Mért]

**Használat:** a Neptun saját, szűrésfüggetlen órarendi válaszának figyelése. A kérés
intézményi és verziófüggően oldalbetöltéskor vagy csak az Órarendtervező panel
megnyitásakor mehet ki. Az NPU először az alkalmazás saját válaszát figyeli; ha a
félév numerikus ID-ja már ismert, de rövid időn belül nincs válasz, a
`registrationData` legfeljebb egy késleltetett, ugyanazon originű fallback GET-et
indít. A minta nem bizonyítja, hogy az endpoint tervezett vagy várólistás sorokat
is visszaad.

```http
GET /hallgato_ng/api/SubjectApplication/GetScheduledCourses?
  request.termId=<numeric-term-id>
```

**Válasz:** `{ "data": [ ...kurzussorok... ], "notification": [] }`

Mért kurzussor mezői: `subjectId`, `id` (kurzusazonosító), `type`, `typeIdentifier`, `code`, `tutorName`, `title` (a TÁRGY neve), `language`, `waitingStudentsCount`, `maxLimit`, `registeredStudentsCount`, `strength`, `classInstanceInfos[]`, `classInstanceTimeTableList[]`, `scheduledSubjectId`, `scheduledCourseId`, `comparationTypeId`, `isSigned`, `isFull`, `willBeOnWaitingList`, `isOnWaitingList`, `signinRequirementText`, `isNotStarted`, `isEndorsementRequired`, `minLimit`, `rankPoint1`, `rankPoint2`, `rankOrder`, `teachingMethodId`, `teachingMethod`, `room`, `isRankingCourse`, `maxWaitingStrength`, `indexLineId`, `isRegistered`, `termId`, `curriculumTemplateId`, `curriculumTemplateLineId`, `note`, `description`, `subjectCredit`, `expectedRankOrder`.

**Mért tények:**

- A `classInstanceInfos[]` alakja **pontosan azonos** a `GetSubjectsCourses`-éval: `{ startTime, endTime, dayOfWeek, dayOfWeekText, rooms, repetition }`. Az ott alkalmazott `normaliseSlot` változtatás nélkül ráhúzható.
- A sor `termId` mezője **GUID** (`<term-guid>`), **nem** a kérés numerikus `request.termId` paramétere (ugyanaz a csapda, mint `SchedulableSubjects`-nél).
- A `classInstanceTimeTableList[]` konkrét dátumokat ad (`substituteDate`, `fromTime`, `toTime`).
  Ez ma kihasználatlan. Elemei: `{ classInstanceCourseId, courseTimeTableInformationId,
  dayOfWeekText, substituteDate: "YYYY-MM-DDT00:00:00", fromTime/toTime: "YYYY-MM-DDTHH:MM:SS" }`,
  alkalmanként egy elem. (Mérve 2026/27/1-ben, 13 tervezői sor alapján.)
  - Minden mért sornál `repetition === true`, és a dátumok hete a `classInstanceInfos`
    `dayOfWeek`/`startTime`/`endTime` hetét követi. A/B hetes (`repetition: false`)
    kurzust nem láttunk, ezért annak jelentése ismeretlen.
  - A dátumok közti 14 napos rés az őszi szünet hete. Ezt egyes kurzusok kihagyják,
    mások nem, tehát a lista kurzusonként eltérhet.
  - A csak vizsgakurzusos tárgynál (`GetSubjectsCourses`) mindkét lista üres. Az ilyen
    kurzusnak nincs ismert időpontja, így ütközést sem jelent.

#### Felvett / Tervezőben / Várólistán — [Mért, részben ismeretlen]

A kód az `isRegistered`, `isSigned`, `isOnWaitingList`, `scheduledSubjectId` és
`scheduledCourseId` mezőket külön kezeli. A hiányzó vagy ismeretlen állapotot nem
alakítja automatikusan felvett, tervezett vagy várólistás státusszá.

**Mért:**

- Az `isRegistered: true` és `isSigned: true` együtt jelölheti a felvett
  állapotot. A kód ezt használja a felvett kurzusok felismeréséhez és az
  ütközésjelzés szűréséhez, ha a válasz ezt az alakot adja.

**Még nem mért állapotok:**

- A „tervezőben” kurzusok: létezik a `scheduledSubjectId` / `scheduledCourseId` mező,
  de eltérő válaszalak esetén a pontos jelentés külön ellenőrzendő. [Ismeretlen]
- A „várólistán” kurzusok: az `isOnWaitingList` mező külön állapotot ad, amelyet
  nem szabad `isFull`-ból vagy férőhelyszámokból kikövetkeztetni. [Ismeretlen]
- `willBeOnWaitingList`: **ELŐREJELZÉS** egy új jelentkezésre, nem aktuális állapot. A mért mintában három sor `willBeOnWaitingList: true` volt, miközben `isRegistered: true` — ezt soha nem szabad állapotnak használni.

**Szükséges további mérés:** olyan mintában, ahol a hallgatónak van tervezőbe tett kurzusa és/vagy várólistás kurzusa, hogy az `isRegistered`, `scheduledSubjectId` / `scheduledCourseId`, illetve `isOnWaitingList` mezők tényleges értékei nyilvánvalóak legyenek. A kód csak az egyértelműen jelölt `isRegistered` vagy `isSigned` sorokat kezeli felvettként.

### A Neptun Tervező írása („Tervezőhöz adás”) — [Mért, unideb, 2026-09-26]

A natív „Tervezőhöz adás” kapcsoló ezt a két kérést küldi. Az NPU csak az
Órarendjavaslatok megerősített alkalmazásakor hívja őket.

```http
POST /hallgato_ng/api/SubjectApplication/ScheduleSubjectAndCourses
{ "subjectId": "<guid>", "termId": "<term-guid>", "curriculumTemplateId": "<guid>",
  "curriculumTemplateLineId": "<guid>", "courseIds": ["<guid>"] }
→ 200 { "data": { "scheduledSubjectId": "<guid>",
                  "scheduledCourses": [{ "courseId": "<guid>", "scheduledCourseId": "<guid>" }] },
        "notification": [] }

POST /hallgato_ng/api/SubjectApplication/UnScheduleCourse
{ "courseId": "<guid>", "subjectId": "<guid>", "termId": "<term-guid>" }
→ 200 { "data": null, "notification": [] }
```

- A `termId` itt a GUID, nem a numerikus félév-azonosító.
- Lejárt tokennél a kérés 401-et kap; a Neptun ekkor maga hív `GetNewTokens`-t, és
  megismétli a kérést.
- A Neptun a kapcsolás után **nem** kéri le újra a `GetScheduledCourses`-t, és a
  Tervező bezárása-megnyitása vagy a „Tárgy keresése” sem. A rács a saját
  memóriájából frissül, ezért egy kívülről írt változás csak az oldal újratöltése
  után látszik rajta.
- Az elutasító válasz (`notification[]` nem üres) alakja nem mért; az NPU minden
  ilyet elutasításnak vesz, és az addigi lépéseket visszagörgeti.
- Ismeretlen: mit tesz a `ScheduleSubjectAndCourses`, ha ugyanabból a típusból
  már van tervezett kurzus. Az NPU ezért előbb levesz, aztán tesz fel, és
  utána visszaolvassa a Tervezőt.

### `GET Periods/GetPeriods` — [Mért kérés és időpontmezők]

**Használat:** a Rajtoló időszakválasztója. Az endpointot a tárgyfelvételi
oldal nem minden esetben kéri magától; a Rajtoló a tervező megnyitásakor, aktív
sessionnel kéri le.

```http
GET /hallgato_ng/api/Periods/GetPeriods?
  request.termId=<term-guid>&sortAndPage.firstRow=0&
  sortAndPage.lastRow=500&sortAndPage.fromDate=asc
```

```json
{
  "periodId": "<period-guid>",
  "periodName": "<period-name>",
  "periodType": "<period-type>",
  "fromDate": "YYYY-MM-DDTHH:MM:SS",
  "toDate": "YYYY-MM-DDTHH:MM:SS",
  "termName": "<term-name>"
}
```

A dátum a mért példányban helyi falióraidő, timezone-suffix nélkül. A Rajtoló
nem a `periodName` alapján választ automatikusan; a felhasználó választ a listából.

## Hitelesítés és munkamenet

### `POST Account/Authenticate` — [Mért flow, v3-ban nem használja automatikus login]

A login form mért mezői `userName` és `password`; a tényleges értékek és a
teljes request-body szándékosan nincsenek dokumentálva. A mért folyamat első
válasza `202 Accepted` és `isTwoFactorRequired: true`, majd a 2FA-lépés után
teljesül a munkamenet. A válasz `neptunCode` és `sessionTimeoutInMinutes`
mezője a kód számára releváns lehet.

Mért ki- és bejelentkezés (unideb, 2026-09-27): a **kijelentkezés nem küld API-kérést**
(sem XHR, sem fetch), csak a `/login` útvonalra vált. A belépés fejléc nélküli
kérései: `General/Institute`, majd `Account/Authenticate` (`202`, a 2FA után még
egyszer `200`). Az NPU ezért a kijelentkezést a `/login` útvonalból, az új
munkamenetet az `Account/Authenticate`-ből ismeri fel; más fejléc nélküli
`Account/*` hívást nem vesz munkamenet-határnak.

Az `autoLogin` v3-ból szándékosan kimarad 2FA, karbantarthatóság és a jelszó
helyi tárolásának biztonsági kockázata miatt. Ez az endpoint tehát katalógusba
vett mérés, nem v3-funkció.

### `UserInfo` — [Metódus és válaszséma ismeretlen]

**HTTP-metódus:** ismeretlen (nem mérve). **Válaszséma:** ismeretlen (nem
mérve).

Az NPU figyeli az `UserInfo` nevű alkalmazáskérést, és ha annak válaszában
előfordul egy nem üres `neptunCode`, azt használja a felhasználó- és
domain-alapú helyi tárolási kulcshoz. A jelenlegi mérés nem rögzítette biztosan
az HTTP-metódust, a teljes envelope-t vagy a mező pontos útját; ezekre itt nem
állítunk `GET`/`POST` szerződést. Hiányzó vagy null értéknél nincs találgatás.

<a id="api-getnewtokens"></a>

### `POST Account/GetNewTokens` — [Mért]

```http
POST /hallgato_ng/api/Account/GetNewTokens
Content-Type: application/json
Authorization: <Angular által látott fejléc>

{}
```

A mért válaszban `accessToken` és `sessionTimeoutInMinutes` szerepel. A token
értéke soha nem kerül forrásba vagy naplóba.

#### Token és munkamenet — [Mért, unideb, 2026-09-26]

- Az `Authorization` fejléc `Bearer <jwt>`. A payload mezőnevei: `SessionId`,
  `WebSessionType`, `jti`, `role`, `nbf`, `exp`, `iat`, `iss`, `aud`. Nincs benne
  `sub` és Neptun-kód sem. `exp - iat` = 300 mp, vagyis az access token 5 percig él.
- Egy `GetNewTokens` után csak a `jti`, `nbf`, `exp` és `iat` változik. A
  `SessionId` ugyanaz marad, ez azonosítja a bejelentkezést. Az NPU csak a
  `SessionId`-t, az `iat`-ot és az `exp`-et olvassa, csak memóriában.
- A munkamenet egy HttpOnly, Secure, SameSite=Strict sütiben tárolt frissítő
  token, 15 perces lejárattal. A `GetNewTokens` 200-as válasza `Set-Cookie`-val
  újabb 15 percre cseréli.
- A Neptun nem frissít előre. Egy saját kérés előtt veszi észre a lejárt
  tokent, és akkor a még régi fejléccel küldi a `GetNewTokens`-t. Mért sorrend
  lejárt tokennél a „Tárgy keresése” (`#filter-table`) gomb megnyomásakor:
  `POST Account/GetNewTokens` → kb. 2 mp → új fejléccel
  `POST ContextUserProfile/SaveFilter`, `GET SubjectApplication/SchedulableSubjects`.
  Érvényes tokennél ugyanez a gomb csak `SaveFilter`-t küldött, `GetNewTokens`-t
  nem.
- A frissítés után nem jön új `UserInfo`. Ami a felhasználót a tokencseréhez
  köti, annak a `SessionId`-ra kell támaszkodnia, nem egy újabb `UserInfo`-ra.
- Nem minden saját API-kérés visz `Authorization`-t: betöltéskor a
  `GET General/GetHWebErrorReportingEmailSystemParameter` fejléc nélkül megy, és
  200-at kap. Fejléc nélküli kérés tehát nem jelent kilépést. Az NPU
  munkamenet-határnak csak a fejléc nélküli `Account/Authenticate`-et és a
  `/login` útvonalat veszi (a kijelentkezés mért módon nem küld kérést).
- Oldal-újratöltéskor a Neptun nem kér új tokent: a még élő tokent használja
  tovább (a mérésben 186 mp-cel a lejárata előtt).
- A fejléc „Munkamenet lejárata” számlálója bármely API-kérésnél 15 percre
  ugrik vissza, `GetNewTokens` nélkül is. Ebben a mérésben egy `SaveFilter`
  után. A számláló tehát nem a süti lejáratát mutatja, hanem az utolsó kérés
  óta eltelt időt.
- Lejárt access tokennél a Neptun akkor is saját `GetNewTokens`-t küldött
  (200-as válasz, a hívó stackje a Neptun Angular chunkjára mutatott), amikor a
  felhasználó kattintás nélkül visszaváltott a háttérben lévő fülre. Ez a 2
  perces figyelmeztetés előtt történt, kb. 3 perccel a számláló vége előtt.
- Ugyanabban a pillanatban (16 ms-mal később) az `infiniteSession` saját
  `GetNewTokens`-e **401**-et kapott. A Neptun kérése épp előtte cserélte le a
  frissítő sütit, az NPU kérése a régivel ment ki. A párhuzamos saját frissítés
  tehát versenyhelyzet. Kb. 6 perccel később a Neptun következő, szabályos
  frissítése is 401-et kapott, és az oldal a `/login`-ra dobott. Valószínű, de
  nem bizonyított ok: a szerver a lecserélt frissítő token újrahasználatára a
  teljes munkamenetet visszavonja.
- Az Angularon kívüli saját `GetNewTokens` 200-at kap, de a „Munkamenet
  lejárata” számlálót **nem** állítja vissza (14:19 → 14:16). A számláló nullán
  a Neptun kiléptet, így ez AFK-nál nem tart életben.
- A lejárat előtti figyelmeztetés nem modális ablak, hanem értesítés a
  `#push-notifications` panelen (`role="dialog"`, `aria-label="Értesítések"`).
  Az elem `role="alert"` szövege: „Figyelmeztetés – Kijelentkezés automatikusan
  ennyi idő múlva: <m:ss>”. A panelnek egyetlen gombja van
  (`aria-label="Bezárás"`).
- Valódi egérkattintás erre a gombra: a Neptun saját `GetNewTokens`-e (200), a
  számláló 15 percre áll vissza, és a panel bezárul. Programból hívott
  `button.click()` ugyanerre: nincs kérés, és a panel sem zárul be. A Neptun
  tehát a felhasználói aktivitásra frissít, nem a gomb click eseményére.
- Programból küldött `mousemove`, `mousedown`, `pointerdown`, `keydown`,
  `wheel`/`scroll`, `focus` és `visibilitychange` esemény lejárt tokennél sem
  indított frissítést. Szkriptből általános, minden oldalon működő kiváltó nincs.
  Mért kiváltó a Neptun saját API-kérése, például a „Tárgy keresése” gombé.

Az NPU nem küld saját `GetNewTokens`-t. A tárgyfelvételi oldalon a Neptun saját
„Tárgy keresése” gombját nyomja meg, és így a Neptun maga frissít. Az élesített
Rajtoló akkor, ha a token 10 percnél régebben készült. A bekapcsolt
`infiniteSession` akkor, ha az oldal 12,5 perce nem küldött saját API-kérést,
vagy ha a legutóbbi tokenfrissítés 10 percnél régebbi és a token lejárt: a
munkamenet-süti a frissítéstől számít 15 percet, ami a legutóbbi kérésnél
korábbi is lehet. (Élőben látva: 6,5 perc oldalcsendnél, 10 perces tokennél nyomott.)

## Naptár, befizetendő tételek és törzslap — [Mért, unideb, 2026-09-26]

Csak olvasó `GET`-ek. A dátumok időzóna nélküli magyar faliórás idők
(`YYYY-MM-DDTHH:mm:ss`).

<a id="api-calendar"></a>

### `GET Calendar/GetStudentTrainings` — [Mért]

Nincs query. `data[]`: `studentTrainingId` (`<guid>`), `studentTrainingName`,
`actualStudentTraining` (boolean).

### `GET Calendar/GetCalendarEvents` — [Mért]

```http
GET /hallgato_ng/api/Calendar/GetCalendarEvents
  ?startDate=<ISO, ezredmásodperccel>&endDate=<ISO>
  &studentTrainingIds[0]=<guid>
  &isClassesVisible=true&isExamsVisible=true&isFinalExamsVisible=false
  &isOnlineMeetingsVisible=false&isOtherEventsVisible=true
  &isPeriodsVisible=true&isTasksVisible=false
```

A kapcsolók csak a válaszra hatnak. A naptárnézet szerveroldali beállítását a
`ContextUserProfile/GetCalendarSelectedTypes` tárolja, és ezt a kérés nem
módosítja. A `data[]` elemei `eventTypeId` szerint:

| `eventTypeId` | Jelentés | Mért mezők a közöseken túl |
| --- | --- | --- |
| hiányzik a mérésből | óra (`isClassesVisible`) | `classInstanceId`, `courseCode`, `courseType`, `courseTutor`, `rooms`, `isOnline`, `onWaitingList`, `subjectId`, `courseId` |
| `1` | vizsga | `examId`, `examType`, `examTutor`, `rooms`, `isOnline`, `onWaitingList` |
| `6` | időszak | `periodId`, `term`, `intervalType` (pl. „Vizsgajelentkezési időszak”, „Kurzusjelentkezési időszak”, „Végleges tárgyjelentkezés”, „Bejelentkezési időszak”) |
| `8` | szünnap | `holidayId` |

Közös mezők: `name`, `startDate`, `endDate`, `studentTrainingId`,
`fromOtherTraining`, `eventTypeId`. Az órák `eventTypeId` értéke az órás
mérésből nem került rögzítésre, ezért az NPU az órát a `classInstanceId`
jelenlétéből ismeri fel. A még meg nem hirdetett időszak egyszerűen hiányzik; a
mérés napján a 2026/27/1 vizsgajelentkezése még nem szerepelt.

A Naptár oldal natív exportot is kínál (`Calendar/GetLinksForCalendarExport`).

### `GET FinancialItem/GetItemsToBePayed` — [Mért]

Query: `sortAndPage.firstRow`, `sortAndPage.lastRow`. `data[]`: `impositionId`,
`name`, `value` (szám), `currency`, `latestExecutionDate` (határidő),
`creationDate`, `term`, `type`, `subjectName`, `subjectCode`,
`isDHPayingInProgress`, `createdByStudent`, `uiDisplayState`.

A kezdőoldali `Dashboard/GetImpositions` csak a végösszeget adja
(`impositions[]`: `imposition`, `currency`), határidőt nem.

### `GET Dashboard/GetUpcomingEvents` — [Mért]

Nincs query. `data.gridData[]` legfeljebb 3 elem (`courseCode`, `name`,
`startDate`, `endDate`, `type`, `online`, terem nélkül), és
`data.additionalData.additionalUpComingEventsCount`.

<a id="api-registry-sheet"></a>

### Törzslap: félévenkénti átlagok és jegyek — [Mért]

- `GET RegistrySheet/GetAdditionalStudentTrainingTermData`, query nélkül:
  félévenként `term` (pl. `2025/26/2`), `termId` (szám),
  `studentTrainingTermDataId` (`<guid>`), `termDataStatus`, és
  `uiDisplayState.reasons[]` (az aktuális félévnél „Aktuális félév”).
- `GET RegistrySheet/GetStudentTrainingTermData?studentTrainingTermDataId=<guid>`:
  az `averagesCreditIndicies[]`, `furtherHalfYearAverages[]` és
  `furtherCumulativeAverages[]` elemei `{ field, translation, value }`
  alakúak. A mért `field` értékek: `Credit` (teljesített kredit), `CreditAll`
  (felvett kredit), `SumCredit`, `SumCreditAll`, `Average` (súlyozott
  tanulmányi átlag), `SumAverage` (halmozott), `KreditIndex`,
  `KorrigaltKreditIndex`, `SchoolarshipKey` (ösztöndíjindex),
  `SumKorrigaltKreditIndex`. A folyamatban lévő félévnél az értékek `null`-ok.
- `GET RegistrySheet/GetStudentTakenSubjectsByTerm?request.studentTrainingTermDataId=<guid>&filter.firstRow=0&filter.lastRow=<n>`:
  `data[]`: `subjectName`, `subjectCode`, `subjectCredits`, `signupType`,
  `result` (pl. „<Címke> (<n>)”, „Teljesítette”, vagy `null`),
  `uiDisplayState.reasons[]` („Teljesítve” / „Nem teljesített”).

Unideben két lezárt félévre egyezően igazolt képlet:

- jegy: a `result` végén álló `(n)`; a „Teljesítette” 5-nek számít, a `null`
  nem teljesített;
- `Credit` = a teljesített (jegy ≥ 2) tárgyak kreditje, `CreditAll` = az összes
  felvett tárgy kreditje;
- `Average` = Σ(kredit × jegy) / Σ(kredit), a teljesített tárgyakon;
- `KreditIndex` = Σ(kredit × jegy) / 30, a teljesített tárgyakon;
- `KorrigaltKreditIndex` = `KreditIndex` × `Credit` / `CreditAll`.

A `SchoolarshipKey` az egyik félévben a kreditindexszel egyezett, a másikban
nem; a képlete ismeretlen. Más intézmény képlete eltérhet, ezért az NPU egy
lezárt félévre mindig újraellenőrzi.

A „Tanulmányok → Felvett tárgyak” oldal `GET TakenSubjects` válasza a
tárgyankénti krediteket adja (`subjectCredit`, `requirementType`, `termId`),
jegyet nem. A `GET TakenSubjects/Terms` félévenként `creditSum` és
`completedCredit` értéket ad.

## Korábbi mintatantervi mérés és további útvonalak

<a id="api-getstudentcurriculumtemplates"></a>

### `GET Advancement/GetStudentCurriculumTemplates` — [Korábbi mérés, részleges séma]

**Státusz:** korábbi, csak olvasható mérés. A kísérleti mintatantervi
hiány-nézetet eltávolítottuk, ezért a v3 runtime nem indít ilyen kérést. A
mért kérésnek nincs query-paramétere:

```http
GET /hallgato_ng/api/Advancement/GetStudentCurriculumTemplates
```

A korábbi válasz `data[]` soraiban numerikus `curriculumTemplateId` és
`advancementRowId` mezőket láttunk. A név, kód és az egyedi aktuális-jelző csak
akkor használható, ha a felület megjeleníti vagy kiválasztja őket; a teljes
sablonlista-séma nincs igazolva.

```json
{
  "data": [
    {
      "curriculumTemplateId": 0,
      "advancementRowId": 0,
      "name": "<template-name>",
      "code": "<template-code>",
      "isCurrent": false
    }
  ],
  "notification": []
}
```

Az `isCurrentTraining` mező jelenlétét nem tekintjük mért szerződésnek.

<a id="api-getstudenthierarchicaladvancements"></a>

### `GET Curriculum/GetStudentHierarchicalAdvancements` — [Korábbi mérés, szigorúan részleges séma]

Ez egy korábban felmért, csak olvasható válaszséma. A v3 runtime jelenleg nem
használja; a következő mezők kizárólag referenciaértékűek:

```http
GET /hallgato_ng/api/Curriculum/GetStudentHierarchicalAdvancements?
  request.curriculumTemplateId=<numeric-template-id>&sortModel.name=asc
```

A `<numeric-template-id>` a sablonlista numerikus `curriculumTemplateId`
értéke. Nem azonos a tárgylista sorainak GUID-formájú
`curriculumTemplateId` mezőjével.

```json
{
  "data": [
    {
      "curriculumTemplateLineId": "<guid>",
      "name": "<group-name>",
      "signupType": "<type>",
      "curriculumStatuses": {
        "isSuccessful": false,
        "isOverachieved": false,
        "isStarted": false,
        "isTakenInCurrentSemester": false,
        "isTakenInNextSemester": false
      },
      "mandatorySubjects": [
        {
          "subjectId": "<subject-guid>",
          "name": "<subject-name>",
          "code": "<subject-code>",
          "credit": 0,
          "recommendedTerm": 0,
          "curriculumTemplateLineId": "<guid>",
          "curriculumStatuses": {
            "isSuccessful": false,
            "isOverachieved": false,
            "isStarted": false,
            "isTakenInCurrentSemester": false,
            "isTakenInNextSemester": false
          }
        }
      ],
      "childSubjectGroups": []
    }
  ],
  "notification": []
}
```

Ismeretlen státusz-, csoport- vagy tárgyformánál a v3 nem rajzol bizonyított
mintatantervi hiányt. Ezek a mezők csak a korábbi mérés referenciái, a v3 jelenleg
nem használja ezt az útvonalat.

### Vizsgák — [Endpoint mért, sor-séma ismeretlen]

Az alábbi kéréseket láttuk, de érvényes vizsgajelentkezési időszakban nem volt
használható sorlista:

```text
GET /hallgato_ng/api/Exam/GetTerms
GET /hallgato_ng/api/ExamRegistration/GetExamsList
GET /hallgato_ng/api/ExamOverview/GetAvailableExamsCount
```

Az `data: []` üres válasz nem bizonyítja a sor-séma kompatibilitását. A v3-ban
nincs ezekre épülő vizsgamodul.

### Feladatok — [Endpoint mért, határidő-séma ismeretlen]

```text
GET /hallgato_ng/api/Tasks/GetDashboardExpiringTasksData
GET /hallgato_ng/api/Tasks/GetDashboardTasksData
```

A mért dashboardon nem volt aktuális, jövőbeli határidős minta. Dátum- és
időzóna-jelentés nélkül a v3 nem mutat visszaszámlálót.

### Már felvett kurzusok — a szűrésfüggetlen órarendi mérés

```text
GET /hallgato_ng/api/SubjectApplication/GetScheduledCourses
GET /hallgato_ng/api/RegisteredCourses/GetRegisteredCourses
```

A `GetScheduledCourses` kérést a Neptun saját oldala vagy az Órarendtervező
panel indíthatja; az interceptor ezt a választ figyeli. Ha egy példány rövid időn
belül nem küldi el, a `registrationData` a már ismert félév-ID-val legfeljebb egy
késleltetett, ugyanazon originű fallback GET-et indít. A válasz alakja alapján
felvett-órarendi alapvonal építhető, de a végpont más állapotokban való viselkedése,
illetve a tervezett és várólistás sorok visszaadása külön ellenőrzendő.

Ez azért fontos, mert a régi, csak `GetSubjectsCourses`-ra épülő útvonal az
aktuális szűrésen kívüli felvett tárgyakat nem látta. A `GetScheduledCourses`
válasza a mért mintában ilyen tárgyak órarendjét is elérhetővé tette az
ütközésjelzés alapvonalához.

A `RegisteredCourses/GetRegisteredCourses` endpoint továbbra is létezik az API-ban,
de a tárgyfelvételi oldal nem indítja. A v3 a mért `GetScheduledCourses` választ
használja a felvett kurzusok szűrésére.

## Kapcsolódó dokumentumok

- Felhasználói útmutató: [README.md](../README.md)
- Fejlesztői setup és release: [DEVELOPMENT.md](DEVELOPMENT.md)
