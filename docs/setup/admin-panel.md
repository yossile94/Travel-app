# פאנל האדמין: הפעלה מקומית, כניסה ושחזור

ספרינט 10 (ADR-015). הפאנל רץ במחשב בלבד, כי אירוח בענן דורש פתיחת חשבון.

## הפעלה

1. בתיקייה `apps/admin` יוצרים קובץ `.env.local` לפי `.env.example`, עם כתובת פרויקט ה-dev והמפתח הציבורי (publishable). **אף פעם לא את המפתח הסודי.**
2. מריצים `npm run dev -w apps/admin`.
3. פותחים את http://localhost:3100.

## הגדרות חד-פעמיות (בחשבונות של יוסי)

| איפה | מה | למה |
|---|---|---|
| Google Cloud Console ← APIs & Services ← Credentials ← ה-OAuth client מסוג **Web application** (זה שהאפליקציה משתמשת בו) ← Authorized redirect URIs | להוסיף `https://xjnflplzqmcsodqyiyyj.supabase.co/auth/v1/callback` | בלי זה Google מחזיר `redirect_uri_mismatch` |
| Supabase Dashboard ← Authentication ← URL Configuration ← Redirect URLs | להוסיף `http://localhost:3100/auth/callback` | כדי ש-Supabase יחזיר את הכניסה לפאנל |
| טלפון | אפליקציית אימות חינמית, למשל Google Authenticator | לקוד בן 6 הספרות בכל כניסה |

## Admin ראשון

החשבון של יוסי בסביבת dev הוגדר כ-Admin ב-SQL (28.10.2026), ולא דרך הפאנל:

```sql
insert into public.admin_roles (user_id, role)
select id, 'admin' from auth.users where email = '<המייל>' and email_confirmed_at is not null
on conflict do nothing;
```

שאר התפקידים נוספים מהמסך "תפקידים" בפאנל. אי אפשר להסיר את ה-Admin האחרון.

## Runbook: איבוד הטלפון עם אפליקציית האימות

ב-TOTP של Supabase אין קודי שחזור. לכן Admin מאפס את הגורם ב-SQL (החלטת רז על שאלה 6 של שרונה):

1. מוודאים את הזהות של מי שמבקש, בערוץ נפרד (טלפון או פגישה).
2. ב-SQL Editor של הפרויקט מוחקים את גורם ה-TOTP שלו:
   ```sql
   delete from auth.mfa_factors
   where user_id = (select id from auth.users where email = '<המייל>')
     and factor_type = 'totp';
   ```
3. בכניסה הבאה הוא נרשם מחדש לאפליקציית האימות (`/mfa/enroll`).
4. רושמים את האיפוס ביומן התפעול (מי ביקש, מי איפס ומתי). היומן של הפאנל לא מכסה את `auth.mfa_factors`.

**אם ה-Admin היחיד איבד את הטלפון:** אותו תהליך, אבל מי שמבצע אותו הוא בעל חשבון Supabase (יוסי) דרך ה-Dashboard.
