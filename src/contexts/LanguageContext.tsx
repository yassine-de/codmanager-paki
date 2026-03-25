import React, { createContext, useContext, useState, useCallback } from "react";

export type Language = "en" | "ar" | "fr";

type Translations = Record<string, Record<Language, string>>;

const translations: Translations = {
  // Sidebar
  "dashboard": { en: "Dashboard", ar: "لوحة التحكم", fr: "Tableau de bord" },
  "orders": { en: "Orders", ar: "الطلبات", fr: "Commandes" },
  "confirmations": { en: "Confirmations", ar: "التأكيدات", fr: "Confirmations" },
  "sourcing": { en: "Sourcing", ar: "التوريد", fr: "Approvisionnement" },
  "products": { en: "Products", ar: "المنتجات", fr: "Produits" },
  "analytics": { en: "Analytics", ar: "التحليلات", fr: "Analytique" },
  "confirmation": { en: "Confirmation", ar: "التأكيد", fr: "Confirmation" },
  "delivery": { en: "Delivery", ar: "التوصيل", fr: "Livraison" },
  "seller": { en: "Seller", ar: "البائع", fr: "Vendeur" },
  "finance": { en: "Finance", ar: "المالية", fr: "Finance" },
  "follow_up": { en: "Follow Up", ar: "المتابعة", fr: "Suivi" },
  "settings": { en: "Settings", ar: "الإعدادات", fr: "Paramètres" },
  "users": { en: "Users", ar: "المستخدمون", fr: "Utilisateurs" },
  "integrations": { en: "Integrations", ar: "التكاملات", fr: "Intégrations" },
  "sheets": { en: "Sheets", ar: "الأوراق", fr: "Feuilles" },
  "logout": { en: "Logout", ar: "تسجيل الخروج", fr: "Déconnexion" },

  // Filter bar
  "today": { en: "Today", ar: "اليوم", fr: "Aujourd'hui" },
  "yesterday": { en: "Yesterday", ar: "أمس", fr: "Hier" },
  "last_7_days": { en: "Last 7 days", ar: "آخر 7 أيام", fr: "7 derniers jours" },
  "this_month": { en: "This month", ar: "هذا الشهر", fr: "Ce mois" },
  "last_month": { en: "Last month", ar: "الشهر الماضي", fr: "Mois dernier" },
  "maximum": { en: "Maximum", ar: "الكل", fr: "Maximum" },
  "custom": { en: "Custom", ar: "مخصص", fr: "Personnalisé" },
  "reset": { en: "Reset", ar: "إعادة", fr: "Réinitialiser" },
  "clear": { en: "Clear", ar: "مسح", fr: "Effacer" },
  "apply": { en: "Apply", ar: "تطبيق", fr: "Appliquer" },
  "cancel": { en: "Cancel", ar: "إلغاء", fr: "Annuler" },
  "status": { en: "Status", ar: "الحالة", fr: "Statut" },
  "country": { en: "Country", ar: "البلد", fr: "Pays" },
  "product": { en: "Product", ar: "المنتج", fr: "Produit" },
  "all": { en: "All", ar: "الكل", fr: "Tout" },
  "search": { en: "Search", ar: "بحث", fr: "Rechercher" },
  "date_range": { en: "Date Range", ar: "نطاق التاريخ", fr: "Période" },
  "select_date": { en: "Select date", ar: "اختر التاريخ", fr: "Sélectionner la date" },
  "start_date": { en: "Start date", ar: "تاريخ البداية", fr: "Date début" },
  "end_date": { en: "End date", ar: "تاريخ النهاية", fr: "Date fin" },

  // KPIs & Analytics
  "total_orders": { en: "Total Orders", ar: "إجمالي الطلبات", fr: "Total commandes" },
  "confirmed": { en: "Confirmed", ar: "مؤكد", fr: "Confirmé" },
  "shipped": { en: "Shipped", ar: "تم الشحن", fr: "Expédié" },
  "delivered": { en: "Delivered", ar: "تم التسليم", fr: "Livré" },
  "cancelled": { en: "Cancelled", ar: "ملغى", fr: "Annulé" },
  "returned": { en: "Returned", ar: "مرتجع", fr: "Retourné" },
  "pending": { en: "Pending", ar: "قيد الانتظار", fr: "En attente" },
  "no_answer": { en: "No Answer", ar: "لا إجابة", fr: "Pas de réponse" },
  "postponed": { en: "Postponed", ar: "مؤجل", fr: "Reporté" },

  // Notifications
  "notifications": { en: "Notifications", ar: "الإشعارات", fr: "Notifications" },
  "mark_all_read": { en: "Mark all as read", ar: "تحديد الكل كمقروء", fr: "Tout marquer comme lu" },
  "no_notifications": { en: "No notifications", ar: "لا توجد إشعارات", fr: "Aucune notification" },

  // General
  "language": { en: "Language", ar: "اللغة", fr: "Langue" },
  "english": { en: "English", ar: "الإنجليزية", fr: "Anglais" },
  "arabic": { en: "العربية", ar: "العربية", fr: "Arabe" },
  "french": { en: "Français", ar: "الفرنسية", fr: "Français" },

  // Invoices
  "invoices": { en: "Invoices", ar: "الفواتير", fr: "Factures" },
  "manage_invoices": { en: "Manage and track all invoices", ar: "إدارة وتتبع جميع الفواتير", fr: "Gérer et suivre toutes les factures" },
  "invoice_number": { en: "Invoice #", ar: "رقم الفاتورة", fr: "N° Facture" },
  "invoice_id": { en: "Invoice ID", ar: "معرف الفاتورة", fr: "ID Facture" },
  "amount": { en: "Amount", ar: "المبلغ", fr: "Montant" },
  "payment_status": { en: "Payment", ar: "الدفع", fr: "Paiement" },
  "ready_status": { en: "Ready", ar: "الجاهزية", fr: "Prêt" },
  "paid": { en: "Paid", ar: "مدفوع", fr: "Payé" },
  "not_paid": { en: "Not Paid", ar: "غير مدفوع", fr: "Non payé" },
  "ready": { en: "Ready", ar: "جاهز", fr: "Prêt" },
  "not_ready": { en: "Not Ready", ar: "غير جاهز", fr: "Non prêt" },
  "paid_by": { en: "Paid By", ar: "الدفع عبر", fr: "Payé par" },
  "proof": { en: "Proof", ar: "إثبات", fr: "Preuve" },
  "generated_date": { en: "Generated", ar: "تاريخ الإنشاء", fr: "Généré le" },
  "paid_date": { en: "Paid Date", ar: "تاريخ الدفع", fr: "Date de paiement" },
  "rate": { en: "Rate", ar: "السعر", fr: "Tarif" },
  "actions": { en: "Actions", ar: "إجراءات", fr: "Actions" },
  "no_invoices": { en: "No invoices found", ar: "لا توجد فواتير", fr: "Aucune facture trouvée" },
  "total_amount": { en: "Total Amount", ar: "المبلغ الإجمالي", fr: "Montant total" },
  "need_to_pay": { en: "Need to Pay", ar: "يجب الدفع", fr: "À payer" },
  "show": { en: "Show", ar: "عرض", fr: "Afficher" },
  "of": { en: "of", ar: "من", fr: "sur" },
  "history": { en: "History", ar: "السجل", fr: "Historique" },
  "add_addon": { en: "Add Addon", ar: "إضافة ملحق", fr: "Ajouter un supplément" },
  "type": { en: "Type", ar: "النوع", fr: "Type" },
  "money_in": { en: "Money In", ar: "أموال داخلة", fr: "Argent entrant" },
  "money_out": { en: "Money Out", ar: "أموال خارجة", fr: "Argent sortant" },
  "money_in_desc": { en: "Money added to the invoice (e.g. extra payment)", ar: "أموال تُضاف للفاتورة", fr: "Argent ajouté à la facture" },
  "money_out_desc": { en: "Money deducted from the invoice (e.g. return, damage)", ar: "أموال تُخصم من الفاتورة", fr: "Argent déduit de la facture" },
  "reason": { en: "Reason", ar: "السبب", fr: "Raison" },
  "reason_placeholder": { en: "Describe the reason...", ar: "اكتب السبب...", fr: "Décrivez la raison..." },
  "confirm": { en: "Confirm", ar: "تأكيد", fr: "Confirmer" },
  "simulation": { en: "Simulation", ar: "المحاكاة", fr: "Simulation" },
};

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string) => string;
  dir: "ltr" | "rtl";
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    return (localStorage.getItem("app_language") as Language) || "en";
  });

  const setLanguage = useCallback((lang: Language) => {
    setLanguageState(lang);
    localStorage.setItem("app_language", lang);
    document.documentElement.dir = lang === "ar" ? "rtl" : "ltr";
    document.documentElement.lang = lang;
  }, []);

  const t = useCallback((key: string): string => {
    return translations[key]?.[language] || key;
  }, [language]);

  const dir = language === "ar" ? "rtl" : "ltr";

  return (
    <LanguageContext.Provider value={{ language, setLanguage, t, dir }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage() {
  const ctx = useContext(LanguageContext);
  if (!ctx) throw new Error("useLanguage must be used within LanguageProvider");
  return ctx;
}
