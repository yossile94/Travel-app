# 8. מודל נתונים ו-RLS ב-Supabase

Row Level Security מופעל על כל טבלה ללא יוצא מן הכלל; משתמש רואה ועורך רק שורות שבהן user_id = auth.uid(). טבלאות התוכן הגלובלי קריאות לכולם וניתנות לכתיבה רק לתפקידי אדמין.

| טבלה | שדות עיקריים | RLS |
|---|---|---|
| profiles | id (= auth.users, on delete cascade), display_name, created_at, updated_at | בעלים בלבד. בלי שם כמו בדרכון ובלי שפה (החלטת יוסי, 2026-10-25) |
| consents | user_id, doc_type, doc_version, action, platform, app_version, created_at | Insert בלבד לבעלים; ללא Update/Delete. השרת קובע את user_id ואת created_at, ומאשר רק את הגרסה הנוכחית של התנאים והמדיניות. בלי מפתח זר ל-auth.users, כדי שהיומן יישאר אחרי מחיקת חשבון (ספרינט 1) |
| legal_documents | doc_type (terms/privacy), version, url, published_at | קריאה לכולם, כתיבה לאדמין (service role) בלבד. הגרסה הנוכחית: המאוחרת שכבר פורסמה (התצוגה current_legal_documents). גרסה חדשה מחייבת הסכמה מחדש (ספרינט 1, AC-18) |
| companions | user_id, display_name, birth_year | בעלים בלבד |
| countries | iso2, name_he, name_en, name_local, aliases[], languages[], emergency_numbers | קריאה לכולם, כתיבה לאדמין |
| missions | country_iso2, type, address, phones, hours, lat/lng, covers[], verified_at, source_url | קריאה לכולם, כתיבה לאדמין |
| trips | id (UUID שנוצר במכשיר), user_id (on delete cascade), country_adm0 (קוד האזור בגלובוס, למשל THA; לא ISO, כי שטחים חולקים קוד ISO עם המדינה הריבונית), title, start_date, end_date, notes; status מספרינט 3 | בעלים בלבד. יצירה ועריכה רק עם הסכמה לגרסה הנוכחית; מחיקה תמיד (ספרינט 2) |
| account_deletions | user_id, deleted_at, reason (user_request / no_consent_30d) | בלי גישה ללקוח. כתיבה רק בפונקציית המחיקה בשרת. ממנה נספרת תקופת השמירה של consents (ספרינט 2) |
| trip_travelers | trip_id, companion_id | דרך הבעלות על trip |
| flights | trip_id, flight_number, flight_date, pnr, seat, watch_key | דרך הבעלות על trip |
| flight_watch | watch_key (מספר+תאריך), last_snapshot (jsonb), next_check_at | Service role בלבד |
| flight_events | watch_key, field, old_value, new_value, detected_at | קריאה למשתמשים עם טיסה תואמת |
| hotels | trip_id, place_id, name_en, name_local, address_en, address_local, lang, phone, lat/lng, check_in, check_out, booking_ref | דרך הבעלות על trip |
| insurance | trip_id, provider, policy_number, valid_until, emergency_phone | דרך הבעלות על trip |
| curated_places | country_iso2, city, category, title, body, lat/lng, status | קריאה לכולם (published), כתיבה לאדמין |
| saved_places | trip_id, place_ref | דרך הבעלות על trip |
| push_tokens | user_id, token, platform | בעלים בלבד |
| admin_audit_log | actor_id, action, entity, entity_id, diff, created_at | Insert בלבד; קריאה לאדמין |

**תוספות לטבלאות (פיצ'רים 5.8, 5.9 ופרק 12):** טבלה חדשה exchange_rates (currency, rate_to_ils, rate_to_usd, source, fetched_at) – קריאה לכולם, כתיבה ל-Service role בלבד. בטבלת countries נוספים השדות timezones[], default_timezone, currency_code ו-region_color (גוון היעד בעיצוב), וכן entry_status ושדות nsc_level, nsc_updated_at ו-nsc_source_url לאזהרות מסע (5.10). בטבלת flights נוספים direction (out/return/internal), route_id, leg_order ו-same_booking (לקונקשנים, 5.3). טבלאות חדשות: itinerary_items (trip_id, day_date, time, title, place_ref, source manual/auto, sort_order) – RLS דרך הבעלות על trip; ו-min_connection_times לשדות תעופה – קריאה לכולם, כתיבה לאדמין. תאריך תפוגת הדרכון לא נשמר בשרת (6.4).

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
