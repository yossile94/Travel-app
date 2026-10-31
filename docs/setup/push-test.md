# בדיקת התראת טיסה במכשיר (ספרינט 13, AC-2 ו-AC-3)

הבדיקה שולחת התראה אמיתית מהשרת לטלפון: cron ← `flight-watch` ← Expo ← FCM ← המכשיר. השינוי עצמו מדומה, כשורה ב-`flight_events` של `travel-app-dev`. **בסוף מוחקים את השורות**, כדי שהיסטוריית הטיסה של המשתמש תישאר אמיתית.

## לפני
- **האפליקציה:** APK לשחרור שנבנה עם `GOOGLE_SERVICES_JSON`. בלי הקובץ אין FCM.
- **המשתמש:** מחובר. המתג "התראות טיסה" פעיל, ובטבלה `push_tokens` יש לו טוקן.
- **הטיסה:** טיסה שמשויכת למעקב (`flights.watch_id`). אפשר גם מעקב שהסתיים, כי `flight_notification_targets` לא בודק את המצב.
- **המצב במכשיר:** אסור לסגור את האפליקציה עם force-stop. אחרי force-stop, ‏Android לא מעביר הודעות FCM עד שהמשתמש פותח את האפליקציה.
  - **"סגורה":** ‏`adb shell input keyevent KEYCODE_HOME` ואחריו `adb shell am kill com.travelapp.companion`.

## השליחה

```sql
-- One simulated change on the user's flight (watch :watch_id). The flight-watch
-- cron (every minute) claims it and sends the alert.
insert into public.flight_events (watch_id, field, old_value, new_value)
values (:watch_id, 'dep_gate', 'B4', 'T1')
returning id;
```

- **השדות המותרים** (`flight_events_field_check`): ‏`dep_time`, ‏`arr_time`, ‏`dep_gate`, ‏`arr_gate`, ‏`status`.
- **ערך ייחודי:** כדאי ש-`new_value` יהיה ייחודי לכל סבב, למשל T1, ‏T2, וכן הלאה. כך קל למצוא את ההתראה ב-`dumpsys notification`.
- **אימות שנשלח:** `select notified_at from public.flight_events where id = :id`.

## הניקוי

```sql
delete from public.flight_events
where id in (:ids) and watch_id = :watch_id and field = 'dep_gate'
returning id;
```

## המדידה של AC-3

התסריט ב-`scratchpad/ac3.sh` של הסשן עושה את זה:
- מחכה להתראה ומקיש עליה.
- לוקח את זמן המכשיר לפני ההקשה (`date +%s%3N`).
- קורא מ-logcat את `[perf] flight-sheet wallClockMs`. השורה הזו קיימת רק בבנייה עם `EXPO_PUBLIC_PERF_LOG=1`.

## תוצאות (31.10, ‏A73, ‏v0.13.0 עם Firebase)

| מצב | התראה הגיעה | הקשה פותחת את הטיסה |
|---|---|---|
| האפליקציה סגורה (`am kill`) | כן, תוך כדקה | כן: הגלובוס על המדינה, גיליון הטיסה וההיסטוריה |
| ברקע | כן | כן |
| פתוחה | כן. ההתראה מוצגת בשורת ההתראות | — |
| הרשאת ההתראות נדחתה | **לא נבדק.** שינוי ההרשאה הוא הגדרת מערכת, ונמצא ברשימה של יוסי | — |
