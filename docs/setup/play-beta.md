# בטא סגורה ב-Google Play: runbook (ספרינט 13, AC-19)

הצעדים לביצוע **אחרי** שיוסי פותח חשבון Google Play Console (‏25$ חד-פעמי). הכול כבר מוכן, ראו "מה מוכן". ליד כל צעד כתוב מי מבצע אותו. **Claude לא מזין סיסמאות, לא יוצר חשבונות ולא רוכש.**

## מה מוכן (ספרינט 13)
- **AAB חתום ב-upload key:** ‏`travel-app-v0.14.0.aab`. ה-upload key ו-ADR-020 מתארים איך הוא נוצר ואיפה הגיבוי.
- **טקסטים ונכסים:** ‏`docs/release/play-store-listing.md`, ‏`docs/release/assets/`.
- **Data safety:** ‏`docs/release/data-safety-draft.md`.
- **טיוטות:** מדיניות פרטיות, תנאי שימוש ודף מחיקה (`docs/legal/`). **ממתינות לעו"ד.**

## הצעדים

1. **יוסי: פתיחת החשבון.** ‏play.google.com/console, חשבון **אישי** או **ארגוני**.
   - **בחשבון אישי חדש** Play מחייב בדיקה סגורה עם **12 בודקים לפחות, במשך 14 ימים ברצף**, לפני שאפשר לבקש production.
   - **בחשבון ארגוני** (נדרש D-U-N-S) הדרישה הזו לא חלה.
   - **המלצה:** חשבון אישי, אם אין כבר חברה רשומה.
2. **יוסי: אימות זהות** בקונסול. זה לוקח כמה ימים.
3. **יוסי ו-Claude: יצירת האפליקציה.**
   - שם, שפת ברירת מחדל עברית, App ולא Game, חינמית.
   - שם החבילה `com.travelapp.companion`. **אחרי ההעלאה הראשונה אי אפשר לשנות אותו.**
4. **יוסי: Play App Signing.** מקבלים את ברירת המחדל: Google מנהלת את מפתח החתימה, ואנחנו מעלים עם upload key.
5. **יוסי: העלאה ל-Closed testing.**
   - יוצרים track ‏"Closed testing" ומעלים את ה-AAB.
   - **שם הגרסה:** 0.14.0. **versionCode:** מה שבקובץ, וכל העלאה חייבת להיות גבוהה מהקודמת.
6. **יוסי: SHA-1 של App Signing.** אחרי ההעלאה, מעתיקים ב-Setup ← App signing את ה-SHA-1 של **App signing key certificate**, ומוסיפים אותו:
   - **ב-Google Cloud Console:** ‏OAuth client מסוג Android לחבילה `com.travelapp.companion`. בלי זה **ההתחברות עם Google לא תעבוד אצל הבודקים**.
   - **ב-Firebase:** Project settings ← האפליקציה ← Add fingerprint.
   - **מומלץ:** להוסיף גם את ה-SHA-1 של ה-upload key, לבדיקה מקומית של ה-AAB.
7. **יוסי: מסך ההסכמה של Google (OAuth consent screen).** היום הוא במצב Testing. כל בודק צריך להיות ברשימת Test users, עד 100.
   - **לבטא:** להוסיף את הבודקים.
   - **לפני production:** להעביר ל-"In production". עם scopes בסיסיים (email, ‏profile) זה בחינם ובלי אימות.
8. **יוסי: Store listing.** מעתיקים מ-`play-store-listing.md` ומעלים את הנכסים.
9. **יוסי: Policy.**
   - **Privacy policy URL:** אחרי עו"ד, מפרסמים את המדיניות ואת דף המחיקה ב-GitHub Pages (בחינם).
   - **Data safety:** לפי הטיוטה.
   - **שאר השאלונים:** דירוג התוכן (IARC), קהל יעד, ו-Ads: "No ads".
10. **יוסי: Testers.**
    - רשימת מיילים, או Google Group.
    - שולחים לבודקים את קישור ההצטרפות.
    - **12 לפחות, 14 ימים ברצף.**
11. **הבודקים:** מי שהתקין את ה-APK שלנו (חתום ב-debug key) **צריך להסיר אותו לפני ההתקנה מ-Play**, כי החתימה שונה ולכן אין עדכון. **ההסרה מוחקת את הדרכון המקומי ואת קובץ הפוליסה.** כדאי לצלם אותם לפני כן.
12. **Claude: אחרי 14 יום.**
    - קוראים את Android vitals בקונסול: קריסות ו-ANR. היעד הוא crash-free מעל 99.5% (אפיון 11.1).
    - מסכמים ליוסי, ורק אז מבקשים production.

## מחוץ ל-runbook הזה, לפני ההשקה
- **סביבת production ב-Supabase** (ספרינט 14). היום הבטא רצה מול `travel-app-dev`.
- **בדיקת חדירות חיצונית.**
- `docs/release/pre-launch-checklist.md`.
