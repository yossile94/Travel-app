# ADR-022: כיוון הפריסה נקבע בקוד נייטיב לפי שפת המכשיר

**תאריך:** 2026-11-08
**סטטוס:** התקבל (ספרינט 14, F-044, ‏AC-6)

## הקשר

- **מה השתנה:** עד ספרינט 14 האפליקציה הייתה עברית בלבד. הכיוון נכפה ל-RTL דרך `forcesRTL` של expo-localization.
- **מה יוסי ביקש:** ממשק באנגלית לפי שפת המכשיר. עברית מימין לשמאל, וכל שפה אחרת באנגלית משמאל לימין.
- **הבעיות בפתרון ב-JS:**
  - **React Native:** מדליק RTL לבד לכל שפת מכשיר שנכתבת מימין לשמאל (ערבית, פרסית, אורדו). כך טלפון בערבית היה מקבל טקסט אנגלי בפריסה מימין לשמאל.
  - **`I18nManager.forceRTL` מ-JS:** נכנס לתוקף רק בהפעלה הבאה. אין `expo-updates` שיטען את האפליקציה מחדש.
  - **expo-localization:** מפעיל `allowRTL`/`forceRTL` משלו ב-`OnCreate` של המודול, בפעם הראשונה אחרי כל שינוי בהגדרות שלו (המפתחות `…SetByConfig` ב-SharedPreferences שלו).

## ההחלטה

1. **Config plugin** (`plugins/withLayoutDirection.js`) מוסיף קוד ל-`MainApplication.onCreate`, אחרי `super.onCreate()` ולפני ש-React עולה:
   - `hebrew` הוא שפת המכשיר `he`, או `iw` במכשירים ישנים.
   - הוא כותב `false` למפתחות `supportsRTLSetByConfig` ו-`forcesRTLSetByConfig` של expo-localization, וכך המודול לא נוגע בכיוון.
   - הוא קורא ל-`I18nUtil.allowRTL(hebrew)` ול-`forceRTL(hebrew)`.
2. **ב-JS** השפה נלקחת מ-`I18nManager.isRTL` (`src/i18n/language.ts`), ולא משפת המכשיר. כך הטקסט והפריסה אף פעם לא חלוקים.
3. **`app.json`:** בלי `forcesRTL`, ובלי `supportsRTL: false`. בדיקה ב-`withLayoutDirection.test.js` שומרת על זה. ערך שאינו ברירת המחדל גורם ל-expo-localization להתעלם מהמפתחות ולדרוס את הכיוון בכל הפעלה.
4. **iOS:** ‏`supportedLocales: { ios: ['he', 'en'] }` כותב `CFBundleLocalizations`. כך iPhone בעברית מקבל RTL, וכל שפה אחרת מקבלת אנגלית.

## חלופות שנשקלו

- **להשאיר את `supportsRTL`/`forcesRTL` של expo-localization:** אין בהם אפשרות של "RTL רק בעברית". טלפון בערבית היה מקבל RTL.
- **`forceRTL` מ-JS עם הפעלה מחדש:** ההפעלה הראשונה בשפה החדשה הייתה בכיוון הלא נכון, והייתה דורשת `expo-updates` או הנחיה למשתמש.
- **בחירת שפה בתוך האפליקציה:** מחוץ לתכולה של ספרינט 14. תישקל לפי הבטא.

## השלכות

- **מתי זה נכנס לתוקף:** שינוי שפת המכשיר משנה את האפליקציה בהפעלה הבאה של התהליך.
- **שדרוג מגרסה עם `forcesRTL=true`:** הקוד מוחק את ההגדרה הישנה לפני ש-expo-localization קורא אותה (סקירת רז, PR 34).
- **שדרוג של expo-localization:** אם המודול ישנה את שמות המפתחות, הבדיקה ב-`withLayoutDirection.test.js` תיכשל.
- **ב-iOS:** אין עדיין בנייה. ההגדרה נבדקת לפני ההשקה ב-iOS.
- **טלפון בערבית:** דיאלוגים של המערכת (Alert, בורר תאריכים) נשארים בפריסה מימין לשמאל סביב טקסט אנגלי, בגלל `supportsRtl=true` במניפסט. זה מקובל.
