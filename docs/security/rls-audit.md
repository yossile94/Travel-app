# ביקורת RLS ומסד הנתונים (ספרינט 13, AC-13)

**תאריך:** 2026-10-31
**איפה נבדק:** `travel-app-dev`, אחרי v0.13.0. בכל migration חדשה, הבדיקה הקבועה `supabase/tests/database/security_guards.test.sql` רצה ב-CI.
**מי סוקר:** דודי (`data-reviewer`).

## סיכום

- **RLS מופעל על כל 31 הטבלאות ב-`public`.** הבדיקה הקבועה נכשלת אם תתווסף טבלה בלי RLS.
- **10 טבלאות בלי מדיניות.** אלה טבלאות של השרת בלבד, ואין להן הרשאה ל-`anon` או ל-`authenticated`. גם את זה הבדיקה הקבועה מוודאת.
- **45 פונקציות `SECURITY DEFINER`:**
  - לכולן `search_path=""`.
  - אף אחת לא זמינה ל-`anon`.
  - 21 מהן זמינות למשתמש מחובר:
    - **בדיקה ידנית (דודי, 31.10):** כל אחת מהן בודקת בעלות. היא מסננת לפי `auth.uid()`, נועלת את הנסיעה של הקורא (`itinerary_gate`) או דורשת `has_role`.
    - **בדיקות קבועות:** הבדיקה מוודאת שהרשימה היא בדיוק 21 השמות שנסקרו, ושכל אחת קוראת את זהות הקורא מחוץ להערות. פונקציה חדשה נכשלת עד שמישהו סוקר אותה ומוסיף אותה לרשימה.
    - **חריגה מכוונת:** `register_push_token` מעביר לקורא טוקן שכבר שייך למשתמש אחר. זה מכשיר משותף: מי שמתחבר בו אחרון מקבל את ההתראות. ההגנה היא שטוקן Expo לא חשוף למשתמשים אחרים.
- **ממצאי advisors:** אין ממצא פתוח. כל ממצא מוסבר בהמשך.

## הטבלאות

"בדיקת pgTAP" היא הקובץ ב-`supabase/tests/database/` שבודק את הטבלה.

| טבלה | מדיניות | מי ניגש | בדיקת pgTAP |
|---|---|---|---|
| `trips` | קריאה, הוספה ועריכה עם הסכמה, מחיקה | הבעלים | `trips.test.sql` |
| `trip_cities` | קריאה, הוספה והסרה עם הסכמה | הבעלים | `trip_details.test.sql` |
| `trip_travelers` | קריאה, הוספה והסרה עם הסכמה | הבעלים | `trip_details.test.sql` |
| `profiles` | קריאה, יצירה, שינוי שם והמתג `flight_alerts` | הבעלים | `profiles.test.sql`, ‏`push.test.sql` |
| `consents` | קריאה והוספה | הבעלים | `consents.test.sql` |
| `flights` | קריאה. כתיבה רק דרך `save_flight` / `delete_flight` | הבעלים | `flights.test.sql`, ‏`connections.test.sql` |
| `hotels` | קריאה. כתיבה רק דרך `save_hotel` / `delete_hotel` | הבעלים | `travel_kit.test.sql` |
| `insurance` | קריאה. כתיבה רק דרך `save_insurance` / `delete_insurance` | הבעלים | `travel_kit.test.sql` |
| `itinerary_items` | קריאה. כתיבה רק דרך ה-RPC של הלוח | הבעלים | `places_itinerary.test.sql` |
| `trip_saved_places` | קריאה. כתיבה דרך `save_place` / `unsave_place` | הבעלים | `places_itinerary.test.sql` |
| `push_tokens` | קריאה ומחיקה. הרישום דרך `register_push_token` | הבעלים | `push.test.sql` |
| `admin_roles` | קריאה | אדמינים | `admin.test.sql` |
| `admin_audit_log` | קריאה | אדמינים | `admin.test.sql` |
| `country_advisories` | קריאה לכולם, עדכון לעורכים | ציבורי ועורכים | `destination_data.test.sql`, ‏`admin_cases.test.sql` |
| `curated_places` | קריאה של מה שפורסם, כתיבה לעורכים | ציבורי ועורכים | `places_itinerary.test.sql`, ‏`admin_cases.test.sql` |
| `min_connection_times` | קריאה לכולם, כתיבה לעורכים | ציבורי ועורכים | `connections.test.sql`, ‏`admin_cases.test.sql` |
| `emergency_numbers` | קריאה לכולם | ציבורי | `emergency.test.sql` |
| `missions` | קריאה לכולם | ציבורי | `emergency.test.sql` |
| `exchange_rates` | קריאה לכולם | ציבורי | `destination_data.test.sql` |
| `legal_documents` | קריאה לכולם | ציבורי | `consents.test.sql` |
| `places` | קריאה לכולם | ציבורי | `places_itinerary.test.sql` |
| `account_deletions` | אין. השרת בלבד | — | `account_deletion.test.sql` |
| `country_advisory_changes` | אין. השרת בלבד | — | `destination_data.test.sql` |
| `flight_coverage_probes` | אין. השרת בלבד | — | `flight_budget.test.sql` |
| `flight_events` | אין. השרת בלבד | — | `flights.test.sql`, ‏`push.test.sql` |
| `flight_lookups` | אין. השרת בלבד | — | `flights.test.sql` |
| `flight_watch` | אין. השרת בלבד | — | `flights.test.sql` |
| `job_runs` | אין. השרת בלבד | — | `destination_data.test.sql` |
| `provider_caps` | אין. השרת בלבד | — | `flight_budget.test.sql` |
| `provider_usage` | אין. השרת בלבד | — | `flight_budget.test.sql` |
| `push_receipts` | אין. השרת בלבד | — | `push.test.sql` |

**אין טבלה בלי בדיקה.** בכל טבלה, הבדיקה שמכסה אותה נמצאת בקובץ שמופיע בטבלה.

## ממצאי ה-advisors והסברם

### אבטחה

| ממצא | רמה | ההסבר |
|---|---|---|
| `rls_enabled_no_policy` (10 טבלאות) | INFO | זה מכוון: טבלאות של השרת בלבד, בלי הרשאה ל-`anon` או ל-`authenticated`. גישה דרך `service_role` או דרך פונקציה. |
| `authenticated_security_definer_function_executable` (21) | WARN | זה מכוון. זה מודל הכתיבה: RPC שבודק את הקורא, את הבעלות, את שער ההסכמה ואת המגבלות בטרנזקציה אחת (ADR-009, ‏ADR-016). כל אחת מהן בודקת `auth.uid()` או `has_role`, ויש לזה בדיקה קבועה. |
| `auth_leaked_password_protection` | WARN | לא רלוונטי. ההתחברות היא רק עם Google, ואין סיסמאות. אם תתווסף התחברות עם סיסמה, מפעילים את ההגנה. |

### ביצועים

| ממצא | רמה | ההסבר |
|---|---|---|
| `unindexed_foreign_keys`, ‏`(trip_id, user_id)` (7 טבלאות) | INFO | **לא מוסיפים אינדקס.** בכל אחת מהטבלאות כבר יש אינדקס שמתחיל ב-`trip_id`: ‏`flights_trip`, ‏`hotels_trip`, ‏`insurance_pkey`, ‏`itinerary_items_day`, ‏`trip_cities_pkey`, ‏`trip_saved_places_once`, ‏`trip_travelers_pkey`. ‏`trip_id` לבד מזהה נסיעה, ולכן המחיקה בשרשרת מ-`trips` מוצאת את השורות לפי האינדקס הקיים. אינדקס נוסף היה רק מאט כתיבות. |
| `unindexed_foreign_keys`, ‏`consents_document_fk` | INFO | **לא מוסיפים אינדקס.** המפתח הזר הוא `ON DELETE RESTRICT` אל `legal_documents`. מסמך שפורסם לא נמחק ולא משנה מפתח (`legal_documents_guard`). רק טיוטה שלא פורסמה נמחקת. זו פעולת אדמין נדירה, ו-seq scan אחד ב-`consents` בזמן כזה מקובל. |
| `unused_index` (8) | INFO | **משאירים.** ב-dev התנועה מעטה, ולכן אינדקס נראה לא בשימוש. כל אחד מהם משרת שאילתה מתועדת (יומן האדמין, מחיקת חשבון, היסטוריית האזהרות, הזמנה משותפת, הנציגויות). בודקים שוב ב-production אחרי חודש של תנועה. |

## בדיקות קבועות (`security_guards.test.sql`)

1. לכל טבלה ב-`public` מופעל RLS.
2. לכל פונקציית `SECURITY DEFINER` מוגדר `search_path=""`.
3. אף פונקציית `SECURITY DEFINER` לא זמינה בלי התחברות.
4. פונקציות `SECURITY DEFINER` שמשתמש יכול לקרוא להן: בדיוק 21 השמות שנסקרו.
5. כל אחת מהן קוראת את זהות הקורא (`auth.uid()` או `has_role`) מחוץ להערות.
6. טבלה בלי מדיניות לא נותנת הרשאה ל-`anon` או ל-`authenticated`.
7. אף טבלה לא ניתנת ל-TRUNCATE על ידי `anon` או `authenticated`, כי TRUNCATE עוקף RLS.
8. כל view שמשתמשים יכולים לקרוא רץ עם `security_invoker`. אין materialized view שאפשר לקרוא.
9. `call_daily_job` קורא רק לשתי הפונקציות היומיות.

כל השאילתות הורצו גם על `travel-app-dev` ב-31.10, ואף אחת לא החזירה ממצא.
