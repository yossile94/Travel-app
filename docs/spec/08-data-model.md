# 8. מודל נתונים ו-RLS ב-Supabase

Row Level Security מופעל על כל טבלה ללא יוצא מן הכלל; משתמש רואה ועורך רק שורות שבהן user_id = auth.uid(). טבלאות התוכן הגלובלי קריאות לכולם וניתנות לכתיבה רק לתפקידי אדמין.

| טבלה | שדות עיקריים | RLS |
|---|---|---|
| profiles | id (= auth.users, on delete cascade), display_name, created_at, updated_at | בעלים בלבד. בלי שם כמו בדרכון ובלי שפה (החלטת יוסי, 2026-10-25) |
| consents | user_id, doc_type, doc_version, action, platform, app_version, created_at | Insert בלבד לבעלים; ללא Update/Delete. השרת קובע את user_id ואת created_at, ומאשר רק את הגרסה הנוכחית של התנאים והמדיניות. בלי מפתח זר ל-auth.users, כדי שהיומן יישאר אחרי מחיקת חשבון (ספרינט 1) |
| legal_documents | doc_type (terms/privacy), version, url, published_at | קריאה לכולם, כתיבה לאדמין (service role) בלבד. הגרסה הנוכחית: המאוחרת שכבר פורסמה (התצוגה current_legal_documents). גרסה חדשה מחייבת הסכמה מחדש (ספרינט 1, AC-18) |
| companions | user_id, display_name, birth_year | בעלים בלבד. **נדחה** (ADR-007): בספרינט 3 נוסעים נשמרים לכל נסיעה, בלי רשימת מלווים קבועה |
| countries | iso2, name_he, name_en, name_local, aliases[], languages[], emergency_numbers | קריאה לכולם, כתיבה לאדמין |
| missions | country_iso2, type, address, phones, hours, lat/lng, covers[], verified_at, source_url | קריאה לכולם, כתיבה לאדמין |
| trips | id (UUID שנוצר במכשיר), user_id (on delete cascade), country_adm0 (קוד האזור בגלובוס, למשל THA; לא ISO, כי שטחים חולקים קוד ISO עם המדינה הריבונית), title, start_date, end_date, notes. הסטטוס (מתוכננת, בנסיעה, הסתיימה) מחושב בלקוח מהתאריכים ולא נשמר (ספרינט 3) | בעלים בלבד. יצירה ועריכה רק עם הסכמה לגרסה הנוכחית; מחיקה תמיד (ספרינט 2) |
| exchange_rates | currency, rate_to_ils, rate_to_usd, source (boi / erapi), rate_date, fetched_at | קריאה לשער האחרון בלבד, דרך תצוגה. כתיבה ל-service role (ספרינט 4) |
| country_advisories | adm0, entry_status, nsc_level, nsc_text, mfa_text, health_text, links, verified_at, fetched_at | קריאה לכולם, כתיבה ל-service role. במקום שדות בטבלה countries (ספרינט 4) |
| country_advisory_changes | adm0, field, old_value, new_value, changed_at | בלי גישה ללקוח. בסיס ל-Push בעתיד (ספרינט 4) |
| account_deletions | user_id, deleted_at, reason (user_request / no_consent_30d) | בלי גישה ללקוח. כתיבה רק בפונקציית המחיקה בשרת. ממנה נספרת תקופת השמירה של consents (ספרינט 2) |
| trip_travelers | trip_id, user_id, position (0–8), name (1–40), relation (partner/child/parent/friend/other או ריק) | בעלים בלבד, דרך מפתח זר מורכב (trip_id, user_id) ל-trips. Insert ו-Delete עם הסכמה, בלי Update. "אני" לא נשמר (ספרינט 3, ADR-007) |
| trip_cities | trip_id, user_id, position (0–9), geoname_id (או ריק לעיר שנכתבה ידנית), name (1–60, תמונת מצב של השם) | כמו trip_travelers. הנסיעה נשמרת כולה בקריאה אחת, `save_trip` (ספרינט 3, ADR-007) |
| flights | id (UUID שנוצר במכשיר), trip_id, user_id (מפתח זר מורכב ל-trips), direction (out/return/internal), flight_number_input (מה שהמשתמש הקליד), flight_number (מנורמל), dep_date_local, שדות מוצא ויעד (IATA) ואזור הזמן של כל אחד, שעות מתוכננות (timestamptz), terminal, gate, pnr, seat, cabin, watch_id. עד 20 לנסיעה | בעלים בלבד, דרך `save_flight` / `delete_flight` עם שער הסכמה. ה-PNR נקרא רק על ידי הבעלים, ולא נשלח לספק או ליומן (ספרינט 5) |
| flight_watch | id, flight_number, dep_date_local (ייחודיים יחד), last_snapshot (jsonb), last_notified (jsonb), next_check_at, attempts, locked_until, state (active/paused/stopped/failed) | Service role בלבד. משמש גם כתור, עם `for update skip locked` (ADR-010, ספרינט 5) |
| flight_events | watch_id, field, old_value, new_value, detected_at | קריאה רק דרך RPC של בעלי טיסה תואמת. נמחק 7 ימים אחרי הנחיתה, יחד עם תמונת המצב (רישיון AeroDataBox, ספרינט 5) |
| provider_usage | month, provider, units | Service role בלבד. תקרה קשיחה של 360 יחידות בחודש ב-POC (ספרינט 5) |
| hotels | trip_id, place_id, name_en, name_local, address_en, address_local, lang, phone, lat/lng, check_in, check_out, booking_ref | דרך הבעלות על trip |
| insurance | trip_id, provider, policy_number, valid_until, emergency_phone | דרך הבעלות על trip |
| curated_places | country_iso2, city, category, title, body, lat/lng, status | קריאה לכולם (published), כתיבה לאדמין |
| saved_places | trip_id, place_ref | דרך הבעלות על trip |
| push_tokens | user_id, token, platform | בעלים בלבד |
| admin_audit_log | actor_id, action, entity, entity_id, diff, created_at | Insert בלבד; קריאה לאדמין |

**תוספות לטבלאות (פיצ'רים 5.8, 5.9 ופרק 12):** טבלה חדשה exchange_rates (currency, rate_to_ils, rate_to_usd, source, fetched_at) – קריאה לכולם, כתיבה ל-Service role בלבד. בטבלת countries נוספים השדות timezones[], default_timezone, currency_code ו-region_color (גוון היעד בעיצוב), וכן entry_status ושדות nsc_level, nsc_updated_at ו-nsc_source_url לאזהרות מסע (5.10). בטבלת flights נוספים direction (out/return/internal), same_booking ו-same_booking_prev (לקונקשנים, 5.3; המסלול מוסק, בלי route_id ו-leg_order, ADR-012). טבלאות חדשות: itinerary_items (trip_id, day_date, time, title, place_ref, source manual/auto, sort_order) – RLS דרך הבעלות על trip; ו-min_connection_times לשדות תעופה (iata, minutes, source_url, verified_at) – קריאה לכולם, כתיבה ל-service role עד האדמין (ספרינט 8). תאריך תפוגת הדרכון לא נשמר בשרת (6.4).

**דגשים:**

- אין טבלת דרכונים – בכוונה (פרק 6).
- flight_watch מופרדת מ-flights כדי לרכז קריאות API לפי טיסה ולא לפי משתמש.
- כל שינוי סכמה הוא מיגרציה ב-Git (supabase/migrations), נבדק ב-PR ורץ אוטומטית מ-CI ל-staging ואז ל-prod. אסור לשנות סכמה ידנית מהדשבורד.
- בדיקות RLS אוטומטיות (pgTAP): משתמש A לא יכול לקרוא או לכתוב נסיעה של משתמש B.
- מחיקת חשבון = מחיקה מדורגת (cascade) של כל השורות של המשתמש, למעט consents שנשמרת כראיה משפטית לתקופה שיקבע היועץ המשפטי.
- שכפול offline: האפליקציה שומרת עותק של הנסיעות ב-SQLite, ומסנכרנת עם תור פעולות כשיש רשת. מנגנון הסנכרון נבנה בפרויקט:
  - כל שורה מקבלת מזהה (UUID) שנוצר במכשיר, כך שאפשר ליצור נתונים גם בלי רשת.
  - השרת מקצה לכל שינוי מספר גרסה עולה. סדר העדכונים נקבע לפי הגרסה בשרת ולא לפי שעון המכשיר, שאינו אמין (אזורי זמן, שעון שגוי).
  - מחיקה מסומנת בשורה (`deleted_at`) ולא מוחקת אותה מיד, כדי שמכשירים אחרים יקבלו את המחיקה בסנכרון הבא.
  - המכשיר מוריד רק שורות שהשתנו מאז הסנכרון האחרון שלו.
  - הפרטים יתועדו בהחלטת ארכיטקטורה (ADR) בספרינט 0.

**פער פתוח (2026-10-26):** הנסיעות מזוהות לפי קוד האזור בגלובוס (adm0), אבל countries, missions ו-curated_places עדיין לפי ISO. כשנסיעה תצטרך נציגויות או המלצות של היעד, צריך מיפוי adm0 ← ISO, ולשטחים שחולקים קוד ISO עם המדינה הריבונית צריך החלטה. נפתר בתכנון הספרינט שמחבר ביניהם.
