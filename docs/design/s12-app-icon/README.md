# אייקון ומסך פתיחה חדשים (ספרינט 12)

יוסי אישר ב-29.10 להכניס לתכולת ספרינט 12 את האייקון החדש, אפשרות ד' (כדור ארץ זוהר בחלל), ואת מסך הפתיחה. הנוסח שלו: "Yes, add the new icon and opening screen to the next sprint's scope".

העיצוב נעשה בסשן ערכת המותג. לוח המוקאפים, כולל "ד: אנימציית פתיחה": https://claude.ai/artifact/CT8nZ8w8Hyv9cJ1BPaHzkp

## הקבצים

השמות והגדלים זהים לאלה שב-`apps/mobile/assets`, ולכן מחליפים אחד-לאחד. **חוץ מ-`splash-icon.png`** (30.10): באפליקציה הוא מחולק ל-`splash-icon-noglow.png` ול-`splash-glow.png` בסקריפט (s12-design 1.1, ‏ADR-018). מי שמחליף אותו מריץ את החלוקה מחדש:

| קובץ | גודל |
|---|---|
| `icon.png` | 1024 |
| `android-icon-foreground.png` | 512 |
| `android-icon-background.png` | 512 |
| `android-icon-monochrome.png` | 432 |
| `splash-icon.png` | 1024 |

## היישום, כפי שהוצע (יעבור תכנון ובדיקה של רז לפני אישור התכולה)

- **ב-`app.json`:**
  - `adaptiveIcon.backgroundColor` → `#060B18`.
  - הפלאגין `expo-splash-screen`: התמונה `splash-icon.png`, והרקע `#060B18`, גם במצב כהה.
- **אופציונלי:** אנימציית פתיחה של ~1.5 שניות. המסלול נמשך והפין קופץ, והיא מכבדת "הפחתת תנועה".
- **בדיקה במכשיר:**
  - iOS.
  - Android, בצורה עגולה ובצורת squircle.
  - אייקון ערכת נושא (themed).
