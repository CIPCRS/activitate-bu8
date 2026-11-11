# Activitate — instalare (o singură dată, ~20 de minute)

Aceeași rețetă ca la aplicația de copacking: **Firebase (plan gratuit Spark) + GitHub Pages**.
Până completezi `config.js`, aplicația merge în **mod demo** (date de probă, doar pe dispozitivul pe care o deschizi).

## Ce e în pachet

| Fișier | Rol |
|---|---|
| `index.html`, `app.js` | aplicația |
| `config.js` | setările: numele aplicației, lista depozitelor, configurarea Firebase |
| `firestore.rules` | regulile de acces (se lipesc în Firebase) |
| `sw.js`, `manifest.webmanifest`, `icon-*.png` | instalare pe ecranul telefonului + deschidere fără semnal |
| `vendor/` | bibliotecile Firebase și Excel (incluse, nu depind de alte site-uri) |

## 1. Proiectul Firebase

1. https://console.firebase.google.com → **Add project** → nume: ex. `activitate-bu8` → fără Google Analytics.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable** (doar prima opțiune, fără „Email link”).
3. **Build → Firestore Database → Create database** → locație **eur3 (Europe)** → *Start in production mode*.
4. Firestore → tab **Rules** → șterge tot, lipește conținutul din `firestore.rules` → **Publish**.
5. ⚙ **Project settings → Your apps → Web (`</>`)** → nume `activitate` → *Register app* (fără Hosting) → copiază obiectul `firebaseConfig`.

## 2. config.js

Deschide `config.js`: numele aplicației la `window.APP_NAME`, depozitele la `window.APP_SITES` și obiectul copiat la `window.FIREBASE_CONFIG`:

```js
window.APP_NAME = "Activitate-bu8";
window.APP_SITES = [ { id: "tc", name: "TC" }, { id: "lcw", name: "LCW" }, { id: "amb", name: "Ambient" } ];
window.FIREBASE_CONFIG = {
  apiKey: "AIza...",
  authDomain: "activitate-bu8.firebaseapp.com",
  projectId: "activitate-bu8",
  storageBucket: "activitate-bu8.firebasestorage.app",
  messagingSenderId: "...",
  appId: "1:...:web:..."
};
```

(Cheia `apiKey` nu e secretă — accesul la date e controlat de regulile de la pasul 1.4.)

## 3. GitHub Pages

1. Repo nou **public** pe GitHub (ex. `activitate-bu8`) → **Add file → Upload files** → urcă tot conținutul folderului (inclusiv folderul `vendor`).
2. **Settings → Pages → Deploy from a branch → main / (root) → Save**. Adresa va fi `https://<user>.github.io/activitate-bu8/`.
3. Înapoi în Firebase: **Authentication → Settings → Authorized domains → Add domain** → `<user>.github.io`.

## 4. Prima pornire (imediat după pasul 3)

1. Deschide adresa. Apare **„Configurare inițială”**: numele tău, PIN admin (4 cifre) și **codul echipei** (minim 4 caractere).
   Primul care completează ecranul acesta devine admin — fă-o imediat după publicare.
2. **Echipă → + Utilizator nou**: nume, PIN de 4 cifre, opțional ID-ul de user din WMS (apare în exportul Excel, foaia „Ore picking”).
3. **Setări**: durata normală a zilei (implicit 8 ore 30 min de prezență) și lista de activități / motive de pauză.

## 5. Pe telefoanele oamenilor

1. Deschid linkul (Android: Chrome; iPhone: **Safari**).
2. Prima dată scriu **codul echipei**, apoi își apasă numele și introduc PIN-ul.
3. Instalare ca aplicație: Android → meniul ⋮ → *Adaugă pe ecranul de pornire / Instalează aplicația*; iPhone → butonul Partajare → *Adaugă la ecranul principal*.
4. Telefonul ține minte omul: la următoarele deschideri cere doar PIN-ul.

## Cum funcționează, pe scurt

- **Ora oficială** este ora serverului Google (aplicația corectează ceasul telefonului la fiecare deschidere). Dacă telefonul nu are semnal, apăsarea se salvează pe telefon și pleacă singură când revine semnalul; adminul vede în ziua omului câte apăsări au ajuns cu peste 5 minute întârziere.
- **Ore suplimentare** = prezența (sosire → plecare) care trece de norma zilnică din Setări.
- **Picking propriu-zis** = doar timpul în starea „Picking”. Pauza oficială și celelalte activități se contorizează separat; timpul la muncă fără nimic pornit apare ca „Fără activitate”.
- **Plecare nebifată**: după 16 ore tura se consideră neînchisă și apare cu roșu; adminul pune ora de plecare din ziua omului („Corectează pontajul”). Rândurile corectate rămân marcate cu numele adminului.
- **Lucru peste miezul nopții**: tura rămâne pe ziua în care a început.
- **Resetare PIN** (admin): omul își alege din nou numele din listă dacă telefonul nu-l mai recunoaște.
- **Dezactivare cont**: omul dispare din listă și nu mai poate intra; istoricul rămâne în rapoarte.

## Limitele planurilor gratuite

**Firebase Spark** (pe zi): 50.000 citiri, 20.000 scrieri, 1 GB stocare.
Limita e **comună pentru toate depozitele** (o singură bază de date).
Estimare pentru **~130 de oameni în total**: ~4.500–5.000 scrieri și 25.000–35.000 citiri pe zi (≈ 25% și ≈ 50–70% din limită). Un an de pontaj ocupă ~100 MB. Sunt estimări — după prima săptămână reală, cifra exactă se vede în Firebase → Firestore → Usage.
Un raport lunar pe un depozit de 45 de oameni costă ~1.000 de citiri; unul pe un an întreg ~11.000 — aplicația avertizează înainte să ruleze un raport mare. La 130 de oameni rezerva la citiri e de 30–50%: rapoartele pe perioade lungi se rulează după program.
Plasa de siguranță, dacă Usage arată că ești aproape de limită: planul Blaze (se plătește doar ce depășește cota gratuită), cu alertă de buget setată.
Dacă limita zilnică s-ar atinge, aplicația nu mai salvează până a doua zi dimineață (ora 10:00 în România) — de aceea merită verificat din când în când în Firebase → Firestore → **Usage**.

**GitHub Pages**: repo public (codul e vizibil, datele nu), 100 GB trafic/lună — aplicația are sub 1 MB și se descarcă o singură dată pe telefon.

Conturile vechi rămase în Authentication după resetări de PIN / schimbarea codului echipei nu mai au acces la nimic; le poți șterge din consolă când vrei.

## Depozite

Aplicația și baza de date sunt **comune**; la intrare omul apasă depozitul (TC / LCW / Ambient), apoi numele și PIN-ul.

- **Operatorii** țin de un singur depozit și apar doar în lista lui. Adminul îi poate muta din Echipă → om → „Depozit”.
- **Trei niveluri de acces** (le dă adminul universal, din Echipă → om → „Rol”):
  - *Operator* — își vede doar pontajul lui.
  - *Admin depozit* — vede și administrează doar depozitul lui: „Azi”, rapoarte, corecții, setările depozitului, adaugă operatori / resetează PIN-uri / dezactivează conturi la depozitul lui. Apare doar în lista de logare a depozitului lui. Nu vede alte depozite și nu poate crea sau modifica admini.
  - *Admin universal* — vede toate depozitele (le schimbă din butonul cu numele depozitului, din antet), dă roluri, mută oameni între depozite, schimbă codul echipei.
- Separarea adminilor de depozit este făcută **în ecranele aplicației**. Baza de date e comună și regulile ei tratează toți adminii la fel, deci un admin de depozit cu cunoștințe tehnice ar putea ajunge și la datele altui depozit. Pentru șefi de tură de încredere e suficient; o separare impusă și de server înseamnă restructurarea bazei de date.
- **Fiecare depozit are setările lui**: durata normală a zilei și lista de activități / motive de pauză (Setări). „Azi”, Rapoartele, Echipa și exportul Excel sunt pe depozitul curent.
- **Codul echipei** e același pentru toate depozitele.
- **Depozit nou sau redenumit**: se schimbă lista `window.APP_SITES` din `config.js`. `id`-ul unui depozit care are deja date nu se mai schimbă (doar `name`). Primul din listă e depozitul inițial — la el rămân utilizatorii și pontajele făcute înainte de împărțire.

## Actualizări

Când primești o versiune nouă: urci fișierele peste cele vechi în repo — **toate, mai puțin `config.js`**, care are setările tale. În `sw.js` numărul de versiune (`VERSION`) trebuie să fie altul decât cel vechi, altfel telefoanele pot păstra versiunea veche.

## De știut

- PIN-ul de 4 cifre al adminului protejează tot (utilizatori, corecții, rapoarte). Firebase blochează temporar contul după mai multe PIN-uri greșite la rând.
- Aplicația este o evidență operațională; dacă vrei să înlocuiască foaia oficială de pontaj, verifică forma cu HR/salarizare.
