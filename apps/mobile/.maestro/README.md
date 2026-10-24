# בדיקות E2E על מכשיר (Maestro)

התסריטים כאן בודקים על טלפון אמיתי את F-001 (תסריטים 01–04, ספרינט 0) ואת חיפוש המדינות F-002 (תסריט 05, ספרינט 1), מול קריטריוני הקבלה.

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

## חיפוש (05-search.yaml)

התסריט מקליד בעברית ("מלד") דרך `inputText` של Maestro. אם המקלדת במכשיר לא מקבלת עברית מ-Maestro, מריצים את החלק הזה ידנית: פותחים חיפוש, מקלידים "מלד" ובודקים שהמלדיביים מופיעים. השלב "חזור, חזור" בודק את ההתנהגות של Android: הלחיצה הראשונה סוגרת את המקלדת והשנייה את החיפוש.
