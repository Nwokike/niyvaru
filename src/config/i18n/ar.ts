import type { Dictionary } from "./en";

export const ar: Dictionary = {
  dir: "rtl",
  locale: "ar",
  labelLang: "ar",

  brand: { name: "نييفارو", tagline: "عِش المكان قبل أن تحجزه" },

  welcome: {
    eyebrow: "نييفارو",
    title: "أين تودّ أن تقف؟",
    lede: "ابحث عن أي مدينة في العالم. نييفارو يُنزّل المكان الحقيقي — الشوارع، المباني، الصور، وما حولك — ويمشي بك فيه.",
    searchPlaceholder: "ابحث عن أي مدينة أو حيّ…",
    featured: "مختارات",
    searching: "جارٍ البحث…",
    noResults: "لا نتائج. جرّب كتابة أخرى؟",
    choose: "استكشف",
    hint: "جرّب «مكة» أو «الرياض» أو «إسطنبول»…",
  },

  assembling: {
    title: "تجهيز {area}",
    steps: {
      places: "الشوارع والأماكن",
      photos: "الصور",
      story: "حكاية المكان",
      routes: "مسارات المشي",
      pulse: "ما الذي يحدث الآن",
    },
    ready: "جاهز",
    failed: "غير متاح حالياً",
    enter: "ادخل",
  },

  tabs: { explore: "استكشف", pulse: "الآن", brief: "الحكاية", memory: "الذاكرة" },

  explore: {
    askPlaceholder: "اسأل عن هذا المكان…",
    send: "أرسل",
    thinking: "أقرأ المكان…",
    greeting: "قل لي من المسافر وما يهمّه — وسأمشي بك خطوة بخطوة.",
    suggestions: [
      "امشِ بي إلى صيدلية قريبة",
      "مكان هادئ يناسب والدين مُسنّين",
      "ما الذي يحدث هنا الآن؟",
    ],
    focus: "أرني",
    walk: "امشِ إلى هناك",
    timeOfDay: { dawn: "الفجر", day: "النهار", golden: "الساعة الذهبية", night: "الليل" },
    layers: { hotels: "الفنادق", pharmacy: "الصيدليات", food: "المطاعم", worship: "المساجد", shops: "المتاجر", health: "الصحة", money: "البنوك", heritage: "التراث", green: "الحدائق", all: "الكل" },
  },

  walk: {
    stop: "توقف",
    realFrames: "{n} صورة حقيقية على هذا الطريق",
    routeOnly: "لا تغطية صورية لهذا الطريق بعد — سنحلّق فوقه",
    stepFree: "بلا درجات",
    of: "من",
  },

  pulse: {
    title: "الآن في {area}",
    empty: "لا جديد في هذه اللحظة.",
    share: "شارك ما تراه…",
    post: "انشر",
    you: "أنت",
    sources: { gdelt: "الأخبار", bluesky: "بلوسكي", mastodon: "ماستودون", wikipedia: "ويكيبيديا", local: "المسافرون", weather: "الطقس", prayer: "أوقات الصلاة", promotions: "إعلان ممول" },
  },

  brief: {
    title: "حكاية {area}",
    from: "من {source}",
    facts: "بنظرة",
  },

  memory: {
    title: "ما يتذكره نييفارو عنك",
    lede: "كل شيء يعيش على هذا الجهاز — لا على خادم. الوكيل يقرأ هذه الملفات ويحرّرها بنفسه أثناء التعلم.",
    export: "تصدير",
    import: "استيراد",
    clear: "امسح كل شيء",
    files: "ملفات الذاكرة",
    edited: "عُدّل {when}",
    confirmClear: "هل تمحو كل الذاكرة على هذا الجهاز؟",
    install: "ثبّت نييفارو على جهازك لتحفظ ذاكرتك من تنظيف المتصفح",
  },

  intake: {
    eyebrow: "البداية",
    title: "قل لنا ما تحتاجه",
    lede: "مجاني وخاص وبلا التزام. نييفارو يُجهّز المكان الحقيقي ويمشي بك فيه.",
    sectionStay: "إقامتك",
    sectionDetails: "تفاصيلك",
    area: "أين ستُقيم؟",
    checkin: "تاريخ الوصول",
    checkout: "تاريخ المغادرة",
    flexible: "تواريخي مرنة ± يومين",
    flexibleHint: "المرونة تفتح أسعاراً أفضل غالباً",
    party: "من المُقيمون؟",
    adults: "بالغون",
    children: "أطفال",
    rooms: "غرف",
    fewer: "أقل",
    more: "أكثر",
    standard: "مستوى الفندق",
    proximity: "ما مدى قربك المطلوب؟",
    proximityOptions: {
      courtyard: { label: "الساحة، صفر متر", hint: "تخرج مباشرة إلى الساحة" },
      within500: { label: "ضمن ٥٠٠ متر", hint: "٥–٧ دقائق مشياً" },
      shuttle: { label: "مع مكوك", hint: "أفضل قيمة مع مكوك موثوق" },
    },
    standardOptions: { star3: "3★", star4: "4★", star5: "5★", any: "الكل" },
    breakfast: "تفضيل الإفطار",
    breakfastOptions: { included: "مضمّن", preferred: "مُفضَّل", roomOnly: "الغرفة فقط" },
    accessibility: "إمكانية الوصول",
    elderly: { label: "السفر مع مسنّين", hint: "مسافات قصيرة ومصاعد سهلة" },
    wheelchair: { label: "كرسي متحرك بلا درجات", hint: "مسار بلا درجات إلى البوابة" },
    interests: "ما الذي يهمّك",
    interestOptions: { calm: "الهدوء", food: "الطعام", heritage: "التراث", nature: "الطبيعة", shopping: "التسوق", family: "مناسب للعائلة" },
    name: "الاسم (اختياري)",
    datesRequired: "الرجاء إضافة تاريخي الوصول والمغادرة.",
    cta: "ابدأ الاستكشاف",
    privacy: "إجاباتك تُحفظ على هذا الجهاز فقط — تعلّم وكيلك ما يهمّك. بلا حساب وبلا خادم.",
  },


  common: {
    loading: "جارٍ التحميل…",
    retry: "أعد المحاولة",
    close: "إغلاق",
    m: "م",
    min: "د",
    openNow: "مفتوح الآن",
    closed: "مغلق",
    hoursUnknown: "الساعات غير معروفة",
    wheelchairYes: "مدخل بلا درجات",
    photos: "الصور",
    kmAway: "على بُعد {d} م",
  },

  a11y: { mapLabel: "خريطة {area}", chatLabel: "محادثة مع نييفارو" },
};
