/**
 * Version 0 of the terms and the privacy policy: a DRAFT that legal counsel
 * has not reviewed (sprint 1 decision 8, ADR-004). It is shown in the app
 * while `legal_documents.url` is null. The reviewed text is published as
 * version 1 before production, and every user is asked again (AC-18).
 */
import type { LegalDocType } from './consentStatus';

export const legalDrafts: Record<LegalDocType, { title: string; body: string }> = {
  terms: {
    title: 'תנאי השימוש (טיוטה, גרסה 0)',
    body: [
      'טיוטה לבדיקה פנימית. הנוסח לא עבר בדיקה משפטית ואינו מחייב.',
      'האפליקציה מציגה מידע כללי על יעדים: שעה מקומית, מטבע וגבולות. המידע ניתן כמות שהוא, ויש לבדוק פרטים חשובים מול מקור רשמי.',
      'החשבון אישי. אפשר להתנתק בכל רגע, ומחיקת חשבון תתווסף בהמשך.',
      'הנוסח המלא ייכתב עם עורך דין לפני ההשקה, ויוצג לאישור מחדש.',
    ].join('\n\n'),
  },
  privacy: {
    title: 'מדיניות הפרטיות (טיוטה, גרסה 0)',
    body: [
      'טיוטה לבדיקה פנימית. הנוסח לא עבר בדיקה משפטית ואינו מחייב.',
      'מה נשמר כשמתחברים עם Google: מזהה החשבון, השם, כתובת המייל וקישור לתמונת הפרופיל ש-Google שולחת. האפליקציה לא מציגה ולא מורידה את התמונה.',
      'מה נשמר כשמאשרים: יומן החלטות (אילו מסמכים ובחירות, באיזו גרסה ומתי), שנשמר גם אחרי מחיקת חשבון לתקופה שתיקבע עם עורך דין.',
      'נתוני שימוש: כרגע לא נאספים. איסוף ייעשה רק אחרי שאלה נפרדת.',
      'מפות: Mapbox מקבלת את הבקשות לתמונות המפה. הטלמטריה של Mapbox כבויה.',
      'הנתונים נשמרים ב-Supabase באיחוד האירופי (פרנקפורט).',
    ].join('\n\n'),
  },
};
