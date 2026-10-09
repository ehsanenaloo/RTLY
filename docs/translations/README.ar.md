[English](../../README.md) · [فارسی](README.fa.md) · **العربية**

<div align="center">

<img src="../assets/logo.svg" alt="شعار RTLY" width="88" height="88">

# RTLY

**اتجاه النص من اليمين إلى اليسار وخط فارسي لمواقع الدردشة بالذكاء الاصطناعي.**

إضافة متصفح مجانية ومفتوحة المصدر لمن يكتبون بالفارسية والعربية والعبرية والأردية وغيرها من اللغات التي تُكتب من اليمين إلى اليسار.<br>
تعمل داخل متصفحك فقط. بلا حساب ولا تتبّع ولا خادم.

[![Add to Chrome](https://img.shields.io/badge/Chrome%20Web%20Store-Add%20to%20Chrome-4285F4?logo=googlechrome&logoColor=white&style=for-the-badge)](https://chromewebstore.google.com/detail/hhifipkafndnildgldggiohfkbpikmkd)
[![User guide](https://img.shields.io/badge/User%20guide-Read%20online-0e7c95?style=for-the-badge)](https://ehsanenaloo.github.io/RTLY/)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/enaloo)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/before-after-dark.png">
  <img src="../assets/screenshots/before-after-light.png" alt="الإجابة الفارسية نفسها بدون RTLY (محاذاة لليسار) ومعه (محاذاة لليمين بخط IranYekan)">
</picture>

## ما هي RTLY؟

معظم مواقع الدردشة بالذكاء الاصطناعي مبنية للنص من اليسار إلى اليمين. عند الكتابة أو القراءة بالفارسية أو العربية أو العبرية تلتصق الأسطر بالجهة الخطأ، وتنتقل علامات الترقيم من مكانها، وتختلط الجمل التي تجمع الإنجليزية مع لغة أخرى، ويكون الخط الافتراضي غير مناسب غالبًا.

تعالج RTLY ذلك في الصفحة نفسها. تفحص كل رسالة من حروفها، وإذا كانت في معظمها بكتابة من اليمين إلى اليسار تضبط الاتجاه وتطبّق خط IranYekan المرفق. تبقى الرسائل الإنجليزية من اليسار إلى اليمين بخط الموقع نفسه. وتترك RTLY كتل الشيفرة والأيقونات والقوائم والشريط الجانبي كما هي.

## المزايا

- **اتجاه تلقائي** لكل رسالة اعتمادًا على الحروف.
- **خط IranYekan** مرفق بالإضافة، ويُطبَّق فقط على النص الذي يحوي حروفًا عربية الكتابة.
- **ثلاثة أوضاع لكل موقع:** كامل، الخط فقط، الاتجاه فقط. يسري تغيير الوضع دون إعادة تحميل.
- **تشغيل وإيقاف لكل موقع** من النافذة المنبثقة أو صفحة الإعدادات أو قائمة النقر الأيمن أو الاختصار `Alt+Shift+R`.
- **حجم الخط** من 85٪ إلى 120٪.
- **سمتان فاتحة وداكنة وأربع لوحات ألوان** و**15 لغة للواجهة**.

<p align="center">
  <img src="../assets/screenshots/popup-light.png" alt="النافذة المنبثقة لـ RTLY" width="260">
  &nbsp;&nbsp;
  <img src="../assets/screenshots/options-light.png" alt="صفحة إعدادات RTLY مع معاينة مباشرة" width="520">
</p>

## المواقع المدعومة

ChatGPT وClaude وGemini وPerplexity وMicrosoft Copilot وGoogle AI Studio وNotebookLM وGrok وPoe وZ.ai وDeepSeek وQwen وBing وMistral وHugging Face (قسم `/chat` فقط) وCohere. لا تعمل RTLY في أي موقع آخر.

تغيّر المواقع بنية صفحاتها دون إشعار، وقد تتوقف RTLY عن العمل في موقع ما حتى يُحدَّث. إذا بدا موقع خاطئًا فيرجى [الإبلاغ عنه](https://github.com/ehsanenaloo/RTLY/issues/new?template=broken_site.yml).

## التثبيت

| المتصفح | الحالة | الطريقة |
| --- | --- | --- |
| **Chrome** (الإصدار 111 فأحدث) | مُختبَر | [Chrome Web Store](https://chromewebstore.google.com/detail/hhifipkafndnildgldggiohfkbpikmkd) |
| **Microsoft Edge** | حزمة Chrome نفسها | من [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/rtly-rtl-font-tool-for-ai-chats/babdpiodfdcobcfpkolpbpfofihllooa)، أو نزّل حزمة Chrome من [Releases](https://github.com/ehsanenaloo/RTLY/releases) وحمّلها غير مضغوطة |
| **Firefox 128+** (حاسوب) | تجريبي | تثبيت مؤقت من صفحة Releases |

**Firefox (تجريبي):** نزّل `rtly-<version>-firefox.zip` من [Releases](https://github.com/ehsanenaloo/RTLY/releases)، وافتح `about:debugging#/runtime/this-firefox`، ثم اختر **Load Temporary Add-on**. يزيل Firefox الإضافات المؤقتة عند إغلاقه. تجتاز حزمة Firefox فحص `web-ext lint`، لكن اختبارات هذا المستودع لم تشغّلها في Firefox حقيقي.

**من الشيفرة المصدرية:** لا توجد خطوة بناء. فعّل **Developer mode** في `chrome://extensions` واختر **Load unpacked** ثم المجلد `extension`.

## الخصوصية

- لا خادم ولا حساب ولا تحليلات ولا إعلانات، ولا تُرسل RTLY أي طلب شبكة.
- تُحفظ الإعدادات في تخزين الإضافة داخل المتصفح على جهازك.
- تحتاج RTLY إلى الوصول إلى صفحات المواقع المذكورة لضبط الاتجاه والخط. تقرأ النص فقط لتحديد اتجاهه ولا ترسله إلى أي مكان.
- تطلب إذني `storage` و`contextMenus` فقط، إضافةً إلى الوصول إلى المواقع المذكورة.

اقرأ [سياسة الخصوصية](../PRIVACY.md) (بالإنجليزية).

## التوثيق

- [دليل المستخدم](https://ehsanenaloo.github.io/RTLY/) (بالإنجليزية، مع صفحات فارسية)
- [سجل التغييرات](../../CHANGELOG.md)
- [المساهمة](../../.github/CONTRIBUTING.md) · [الدعم](../../.github/SUPPORT.md) · [الأمان](../../.github/SECURITY.md)

## الترجمات

الواجهة متاحة بـ 15 لغة. لم يراجع متحدثون أصليون كل الترجمات، وفي عشر لغات ما زالت ثماني عبارات (معظمها في صفحة الإعدادات) بالإنجليزية. إن كان بوسعك تحسين ترجمة فاستخدم [نموذج تصحيح الترجمة](https://github.com/ehsanenaloo/RTLY/issues/new?template=translation_fix.yml).

## المساهمة والدعم

نرحب ببلاغات الأخطاء وبلاغات المواقع المعطلة وتصحيحات الترجمة والطلبات الصغيرة. وإذا وفّرت لك RTLY وقتًا فيمكنك [شراء قهوة](https://buymeacoffee.com/enaloo).

## الترخيص

[MIT](../../LICENSE). حقوق النشر 2026 Ehsan Enaloo. يغطي ترخيص MIT شيفرة هذا المستودع؛ أما ملفات خط IranYekan وشعارات المواقع فهي مواد طرف ثالث ولها شروطها.
