# בדיקות E2E על מכשיר (Maestro)

התסריטים כאן בודקים את F-001 על טלפון אמיתי, מול קריטריוני הקבלה של ספרינט 0.

## דרישות

1. **בנייה במצב E2E:** `npx eas-cli build --profile e2e --platform android`. במצב הזה הגלובוס לא מסתובב, ואפשר לכוון את המצלמה בקישור, למשל `travelapp://?lng=12&lat=42.8&zoom=4`. כך תסריט יודע איזו מדינה נמצאת במרכז המסך.
2. **טלפון מחובר ב-USB ומאושר** (`adb devices` מציג `device`).
3. **Maestro מותקן** במחשב: [docs.maestro.dev](https://docs.maestro.dev/getting-started/installing-maestro).

## הרצה

מתוך `apps/mobile`:

```bash
maestro test .maestro
```

## בדיקות שמכינים בעזרת adb

**הסרת אנימציות (AC-6):** מפעילים לפני ההרצה, ואחריה מחזירים לערכים הקודמים (1).

```bash
adb shell settings put global animator_duration_scale 0
```

```bash
adb shell settings put global transition_animation_scale 0
```

**מצב כהה (AC-7):**

```bash
adb shell cmd uimode night yes
```

## למה השעה נבדקת כאן

ב-Jest השעה מחושבת עם ICU מלא של Node. בטלפון רץ Hermes, שהתמיכה שלו ב-Intl חלקית. רק כאן מוודאים שהשעה וההפרש משעון ישראל באמת מופיעים בטלפון.
