# ADR-020: מפתח העלאה ל-Google Play, מחוץ ל-Git

**תאריך:** 2026-10-31
**סטטוס:** התקבל (ספרינט 13, AC-16)

## הקשר

- **היום:** כל APK לשחרור נחתם במפתח ה-debug המקומי. זה מתאים לשיתוף APK, אבל לא ל-Play.
- **מה Play דורש:** כל AAB חייב להיות חתום ב-**upload key** קבוע. מפתח האפליקציה עצמו נשמר אצל Google (Play App Signing).
- **אם המפתח אובד:** מבקשים מ-Google לאפס אותו. התהליך לוקח ימים ועוצר עדכונים.
- **אם המפתח דולף:** מי שמחזיק אותו יכול להעלות גרסה בשמנו, עד שמאפסים אותו.

## ההחלטה

- **מי יוצר את המפתח:** יוסי, במחשב שלו, עם `keytool` (חינם). Claude לא מזין סיסמאות, ולכן לא יוצר את המפתח בעצמו.
- **איפה הוא נשמר:**
  - קובץ ה-keystore: `C:\Users\HP\secrets\travel-app-upload.jks`, לצד `google-services.json` ומחוץ לריפו.
  - הסיסמאות: `C:\Users\HP\.gradle\gradle.properties`. קובץ אישי של Gradle, לא בריפו.
  - שמות המאפיינים: `TRAVELAPP_UPLOAD_STORE_FILE`, ‏`TRAVELAPP_UPLOAD_STORE_PASSWORD`, ‏`TRAVELAPP_UPLOAD_KEY_ALIAS`, ‏`TRAVELAPP_UPLOAD_KEY_PASSWORD`.
- **גיבוי:** עותק של קובץ ה-keystore ושל הסיסמאות במנהל הסיסמאות של יוסי, או בכונן מוצפן. לא בענן משותף ולא במייל.
- **הבנייה:**
  - `plugins/withUploadSigning.js` מוסיף ל-`app/build.gradle` תצורת חתימה `upload`, שמתמלאת רק מהמאפיינים האלה.
  - במחשב שיש בו המאפיינים, ה-release נחתם ב-upload key.
  - במחשב בלי המאפיינים, כמו ה-CI, ה-release נחתם ב-debug key, כמו היום.
- **SHA-1:** אחרי ההעלאה הראשונה מוסיפים ל-OAuth client של Android ב-Google Cloud ול-Firebase גם את ה-SHA-1 של ה-App Signing key, וגם את זה של ה-upload key (`docs/setup/play-beta.md`, צעד 6).

## יצירת המפתח (יוסי, פעם אחת)

```powershell
& "C:\Program Files\Android\Android Studio\jbr\bin\keytool.exe" -genkeypair -v -keystore "C:\Users\HP\secrets\travel-app-upload.jks" -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

- `keytool` שואל על סיסמה ועל פרטי שם. אפשר להשאיר את הפרטים ריקים, חוץ מהשם.
- **אחר כך יוצרים** את `C:\Users\HP\.gradle\gradle.properties` (או מוסיפים לו, אם הוא כבר קיים), עם הסיסמה שבחרת:

```properties
TRAVELAPP_UPLOAD_STORE_FILE=C:/Users/HP/secrets/travel-app-upload.jks
TRAVELAPP_UPLOAD_STORE_PASSWORD=<הסיסמה>
TRAVELAPP_UPLOAD_KEY_ALIAS=upload
TRAVELAPP_UPLOAD_KEY_PASSWORD=<הסיסמה>
```

## חלופות שנשקלו

- **חתימה ב-EAS (Expo מנהלת את המפתח):** הבניות בענן מוגבלות בתוכנית החינמית, ושדרוג הוא בתשלום. בנוסף, המפתח נשמר אצל צד שלישי.
- **keystore בריפו עם סיסמה ב-CI secrets:** קובץ מפתח בהיסטוריית Git לא נמחק לעולם. נדחה.
- **להמשיך עם ה-debug key:** Play לא מקבל AAB חתום ב-debug key.

## השלכות

- **בנייה למעלה ל-Play:** רק מהמחשב של יוסי, או ממחשב שיוסי הגדיר בו את המאפיינים.
- **גרסה ראשונה מ-Play:** מי שהתקין APK מאיתנו צריך להסיר אותו, כי החתימה שונה (`play-beta.md`, צעד 11).
- **אובדן המפתח:** מבקשים upload key reset בקונסול של Play. לא מאבדים את האפליקציה.
