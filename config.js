// Setările aplicației. Restul fișierelor nu conțin nimic specific — la actualizări, config.js rămâne cel de aici.

// Numele afișat în aplicație și în numele fișierelor exportate
window.APP_NAME = "Activitate-bu8";

// Depozitele: aplicația și baza de date sunt comune; la intrare se alege depozitul, apoi numele și PIN-ul.
// "id" nu se mai schimbă după ce depozitul are date (se poate schimba doar "name"). Primul din listă
// este depozitul inițial: pontajele și utilizatorii făcuți înainte de împărțire rămân la el.
window.APP_SITES = [
  { id: "tc",  name: "TC" },
  { id: "lcw", name: "LCW" },
  { id: "amb", name: "Ambient" }
];

// Proiectul Firebase (unul singur pentru toate depozitele) (apiKey nu e secretă — accesul la date e controlat de regulile Firestore).
// Dacă pui null, aplicația pornește în MOD DEMO.
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCSBLny3LaeRZnpybX1LrkRxc3nZqTMeg8",
  authDomain: "pontaj-tc.firebaseapp.com",
  projectId: "pontaj-tc",
  storageBucket: "pontaj-tc.firebasestorage.app",
  messagingSenderId: "255800141117",
  appId: "1:255800141117:web:cd478d89f626a9acc4d154"
};
