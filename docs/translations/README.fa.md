[English](../../README.md) · **فارسی** · [العربية](README.ar.md)

<div align="center">

<img src="../assets/logo.svg" alt="نشان RTLY" width="88" height="88">

# RTLY

**راست‌چین و فونت فارسی برای چت‌های هوش مصنوعی.**

افزونهٔ رایگان و متن‌باز مرورگر برای کسانی که فارسی، عربی، عبری، اردو و دیگر زبان‌های راست‌به‌چپ می‌نویسند.<br>
فقط داخل مرورگر شما اجرا می‌شود. حساب کاربری، ردیابی و سرور ندارد.

[![Add to Chrome](https://img.shields.io/badge/Chrome%20Web%20Store-Add%20to%20Chrome-4285F4?logo=googlechrome&logoColor=white&style=for-the-badge)](https://chromewebstore.google.com/detail/hhifipkafndnildgldggiohfkbpikmkd)
[![User guide](https://img.shields.io/badge/User%20guide-Read%20online-0e7c95?style=for-the-badge)](https://ehsanenaloo.github.io/RTLY/fa/)
[![Buy me a coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-FFDD00?style=for-the-badge&logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/enaloo)

</div>

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="../assets/screenshots/before-after-dark.png">
  <img src="../assets/screenshots/before-after-light.png" alt="یک پاسخ فارسی بدون RTLY (چپ‌چین) و با RTLY (راست‌چین، فونت ایران‌یکان)">
</picture>

## RTLY چیست؟

بیشتر سایت‌های چت هوش مصنوعی برای متن چپ‌به‌راست ساخته شده‌اند. در متن فارسی یا عربی سطرها سمت اشتباه می‌چسبند، علامت‌های نگارشی جابه‌جا می‌شوند، جمله‌های ترکیبی فارسی و انگلیسی به‌هم می‌ریزند و فونت پیش‌فرض اغلب مناسب نیست.

RTLY این مشکل‌ها را روی خود صفحه برطرف می‌کند. هر پیام را از روی حرف‌هایش بررسی می‌کند؛ اگر بیشتر راست‌به‌چپ باشد، جهت را راست‌به‌چپ می‌کند و فونت ایران‌یکان را به کار می‌برد. پیام‌های انگلیسی چپ‌به‌راست می‌مانند و فونت سایت را نگه می‌دارند. RTLY بلوک‌های کد، آیکون‌ها، منوها و نوار کناری را دست‌نخورده می‌گذارد.

## امکانات

- **تشخیص خودکار جهت** برای هر پیام از روی نویسه‌ها.
- **فونت ایران‌یکان** همراه افزونه، فقط روی متنی که نویسهٔ خط عربی دارد.
- **سه حالت برای هر سایت:** کامل، فقط فونت، فقط راست‌چین. تغییر حالت بدون بارگذاری دوباره اعمال می‌شود.
- **روشن و خاموش برای هر سایت** از پنجرهٔ افزونه، صفحهٔ تنظیمات، منوی راست‌کلیک یا میان‌بر `Alt+Shift+R`.
- **اندازهٔ فونت** از ۸۵٪ تا ۱۲۰٪.
- **پوستهٔ روشن و تیره و چهار پالت رنگ**، و **۱۵ زبان رابط**.

<p align="center">
  <img src="../assets/screenshots/popup-light.png" alt="پنجرهٔ افزونه RTLY" width="260">
  &nbsp;&nbsp;
  <img src="../assets/screenshots/options-light.png" alt="صفحهٔ تنظیمات RTLY با پیش‌نمایش زنده" width="520">
</p>

## سایت‌های پشتیبانی‌شده

ChatGPT، Claude، Gemini، Perplexity، Microsoft Copilot، Google AI Studio، NotebookLM، Grok، Poe، Z.ai، DeepSeek، Qwen، Bing، Mistral، Hugging Face (فقط بخش `/chat`) و Cohere. RTLY جای دیگری اجرا نمی‌شود.

سایت‌ها ساختار صفحه‌شان را بی‌خبر عوض می‌کنند و ممکن است RTLY تا به‌روزرسانی روی یک سایت کار نکند. اگر سایتی خراب است، [گزارش دهید](https://github.com/ehsanenaloo/RTLY/issues/new?template=broken_site.yml).

## نصب

| مرورگر | وضعیت | روش |
| --- | --- | --- |
| **Chrome** (نسخهٔ ۱۱۱ به بالا) | آزموده‌شده | [Chrome Web Store](https://chromewebstore.google.com/detail/hhifipkafndnildgldggiohfkbpikmkd) |
| **Microsoft Edge** | همان بستهٔ Chrome | از [Microsoft Edge Add-ons](https://microsoftedge.microsoft.com/addons/detail/rtly-rtl-font-tool-for-ai-chats/babdpiodfdcobcfpkolpbpfofihllooa)، یا بستهٔ Chrome را از [Releases](https://github.com/ehsanenaloo/RTLY/releases) بگیرید و بسته‌نشده بارگذاری کنید |
| **Firefox ۱۲۸+** (رایانه) | آزمایشی | نصب موقت از صفحهٔ Releases |

**Firefox (آزمایشی):** فایل `rtly-<version>-firefox.zip` را از [Releases](https://github.com/ehsanenaloo/RTLY/releases) بگیرید، `about:debugging#/runtime/this-firefox` را باز کنید و **Load Temporary Add-on** را بزنید. Firefox افزونهٔ موقت را با بسته شدن حذف می‌کند. بستهٔ Firefox از `web-ext lint` می‌گذرد، ولی آزمون‌های این مخزن آن را در Firefox واقعی اجرا نکرده‌اند.

**از کد منبع:** مرحلهٔ ساخت وجود ندارد. در `chrome://extensions` حالت **Developer mode** را روشن کنید، **Load unpacked** را بزنید و پوشهٔ `extension` را انتخاب کنید.

## حریم خصوصی

- سرور، حساب کاربری، تحلیل‌گر و تبلیغ ندارد و هیچ درخواست شبکه‌ای نمی‌فرستد.
- تنظیم‌ها در حافظهٔ افزونهٔ مرورگر روی دستگاه شما می‌مانند.
- RTLY برای تنظیم جهت و فونت به صفحهٔ سایت‌های بالا دسترسی دارد. متن را فقط برای تشخیص جهت می‌خواند و هرگز جایی نمی‌فرستد.
- فقط دو مجوز `storage` و `contextMenus` را می‌خواهد، به‌علاوهٔ دسترسی به سایت‌های بالا.

[سیاست حریم خصوصی](../PRIVACY.md) را بخوانید (متن مرجع انگلیسی؛ نسخهٔ فارسی در [راهنما](https://ehsanenaloo.github.io/RTLY/fa/privacy.html) است).

## مستندات

- [راهنمای کاربر](https://ehsanenaloo.github.io/RTLY/fa/) (صفحه‌های فارسی: شروع سریع، نصب، حریم خصوصی؛ راهنمای کامل به انگلیسی)
- [تاریخچهٔ تغییرات](../../CHANGELOG.md)
- [مشارکت](../../.github/CONTRIBUTING.md) · [پشتیبانی](../../.github/SUPPORT.md) · [امنیت](../../.github/SECURITY.md)

## ترجمه‌ها

رابط به ۱۵ زبان است. همهٔ ترجمه‌ها را گویشور بومی بازبینی نکرده است و در ده زبان، هشت متن (بیشتر در صفحهٔ تنظیمات) هنوز انگلیسی است. اگر می‌توانید ترجمه‌ای را بهتر کنید، از [فرم اصلاح ترجمه](https://github.com/ehsanenaloo/RTLY/issues/new?template=translation_fix.yml) استفاده کنید.

## مشارکت و حمایت

گزارش خطا، گزارش سایت خراب، اصلاح ترجمه و درخواست‌های کوچک پذیرفته می‌شوند. اگر RTLY وقتتان را می‌گیرد، می‌توانید [یک قهوه بخرید](https://buymeacoffee.com/enaloo).

## مجوز

[MIT](../../LICENSE). حق نشر ۲۰۲۶ Ehsan Enaloo. مجوز MIT شامل کد این مخزن است؛ فایل‌های فونت ایران‌یکان و آرم‌های سایت‌ها مواد شخص ثالث‌اند و شرایط خودشان را دارند.
