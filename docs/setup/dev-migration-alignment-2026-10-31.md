# יישור היסטוריית ה-migrations ב-travel-app-dev (ספרינט 13, דודי 3)

**תאריך:** 2026-10-31
**סביבה:** `travel-app-dev` בלבד. ב-production ההיסטוריה תיבנה מהריפו מהיום הראשון.

## הבעיה

כלי ה-MCP (`apply_migration`) רושם כל migration עם חותמת הזמן שבה היא הורצה, ולא עם הגרסה שבשם הקובץ. לכן ב-dev:
- **22 מתוך 30 השורות** ב-`supabase_migrations.schema_migrations` רשומות עם גרסה שלא קיימת בריפו.
- `supabase db push` או `migration list` מול dev יראו אותן כ-migrations זרות, ואת קבצי הריפו כאילו לא הורצו.

## התיקון

- **מה משתנה:** הגרסה של כל שורה מתעדכנת לגרסה שבריפו, לפי השם. השמות זהים אחד לאחד.
- **מה לא משתנה:** הסכמה והנתונים.
- **גיבוי:** קודם נשמר עותק של הטבלה (`schema_migrations_backup_20261031`).

```sql
-- Sprint 13 (Dudi 3): travel-app-dev's migration history takes the repo's
-- versions, matched by name. Metadata only: no schema or data changes.
begin;
create table supabase_migrations.schema_migrations_backup_20261031 as
  select * from supabase_migrations.schema_migrations;
with map(name, dev_version, repo_version) as (values
  ('trip_details', '20261026065917', '20261026120000'),
  ('destination_data', '20261026184632', '20261026200000'),
  ('job_claim_window', '20261026191235', '20261026210000'),
  ('flight_provider_budget_and_coverage', '20261026225411', '20261027090000'),
  ('flights', '20261026230848', '20261027100000'),
  ('provider_budget_rolling', '20261026231133', '20261027110000'),
  ('flight_watch_worker', '20261026232456', '20261027120000'),
  ('flights_details', '20261026233503', '20261027130000'),
  ('flights_review', '20261027000608', '20261027140000'),
  ('failed_watch_time', '20261027001558', '20261027150000'),
  ('push', '20261027015138', '20261028090000'),
  ('push_targets', '20261027020512', '20261028100000'),
  ('push_scale', '20261027023248', '20261028110000'),
  ('connections', '20261027025558', '20261029090000'),
  ('connection_targets', '20261027031124', '20261029100000'),
  ('connection_review', '20261027032941', '20261029110000'),
  ('connection_watches', '20261027033418', '20261029120000'),
  ('connection_tidy', '20261027034013', '20261029130000'),
  ('travel_kit', '20261028113804', '20261030090000'),
  ('emergency', '20261028113807', '20261030100000'),
  ('admin', '20261028191206', '20261031090000'),
  ('places_itinerary', '20261029071148', '20261101090000')
)
update supabase_migrations.schema_migrations m
set version = map.repo_version
from map
where m.name = map.name and m.version = map.dev_version;
-- Every name now carries the repo's version, and nothing else changed.
select count(*) as rows, count(distinct version) as versions from supabase_migrations.schema_migrations;
commit;```

## הכלל מעכשיו

- **migration חדשה ב-dev:** לא עוברת דרך `apply_migration`. מריצים את קובץ הריפו עם `execute_sql`, ומוסיפים שורה ל-`schema_migrations` עם הגרסה והשם שבשם הקובץ.
- **גרסת קובץ חדש:** גדולה מהגרסה האחרונה בריפו. כרגע זו `20261101100000`, ולכן גדולה ממנה.
- **בדיקה אחרי כל פריסה:** כל שורה בהיסטוריה של dev קיימת כקובץ בריפו, באותה גרסה.
