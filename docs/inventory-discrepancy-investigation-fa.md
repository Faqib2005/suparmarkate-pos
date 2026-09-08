# راهنمای بررسی اختلاف موجودی

## اصل ایمنی

- دیتابیس اصلی مشتری هرگز مقصد تست عملیاتی نیست.
- روی دیتابیس اصلی فقط audit خواندنی اجرا می‌شود.
- تست تصادفی فقط روی دیتابیسی اجرا می‌شود که نام آن به _supermarket_test ختم شود.
- هیچ finding تاریخی خودکار حذف، merge یا repair نمی‌شود.
- دستورهای prisma migrate reset، docker compose down -v و حذف volume ممنوع‌اند.

## مرحله اول: کپی دیتای مشتری

ورودی‌ها: backup سفارشی PostgreSQL، مسیر اختیاری uploads و شناسه یا بارکد
محصولات مورد شکایت.

از ریشه پروژه اجرا کنید:

    $env:STOCK_STRESS_COMPLAINT_PRODUCTS = "PRODUCT_ID_1,BARCODE_2"
    powershell -ExecutionPolicy Bypass -File .\scripts\windows\run-inventory-forensics.ps1 -BackupFile "D:\BelalBackups\customer.dump" -UploadsPath "D:\BelalBackups\uploads" -CloneDatabaseName "customer_clone_supermarket_test"

اسکریپت:

1. checksum backup و manifest فایل‌های uploads را می‌سازد.
2. PostgreSQL و Redis تست را جدا از سرویس مشتری بالا می‌آورد.
3. backup را پیش از restore با pg_restore --list بررسی می‌کند.
4. فقط دیتابیس customer_clone_supermarket_test را بازسازی می‌کند.
5. migrationهای افزایشی را روی کپی اجرا می‌کند.
6. preflight را در JSON ذخیره می‌کند.
7. ۱۰۰ محصول مورد شکایت، تاریخ‌دار، چندواحدی، پرتراکنش و تصادفی را انتخاب می‌کند.
8. برای هر محصول ۵۰ خرید، فروش، برگشت، افزایش، کاهش، ضایعات، انتقال و ابطال اجرا می‌کند.
9. بعد از هر حرکت، مدل مستقل حافظه را با lotهای دیتابیس مقایسه می‌کند.
10. retry هم‌زمان، ابطال هم‌زمان و سه چرخه reconciliation بدون repair را می‌آزماید.
11. postflight و comparison را ذخیره می‌کند.

خروجی‌ها در artifacts/inventory-forensics/TIMESTAMP قرار می‌گیرند:

- run-manifest.json
- uploads-manifest.json
- preflight.json
- postflight.json
- comparison.json

تفسیر:

- comparison.passed برابر true: finding جدیدی ایجاد نشده است.
- newIssues غیرخالی: یک اختلاف جدید نرم‌افزاری ایجاد شده است.
- historicalIssues: مشکل پیش از تست وجود داشته و خودکار اصلاح نمی‌شود.
- شکست oracle بعد از یک عملیات: دیتابیس با مدل مستقل اختلاف دارد.
- بیش از یک movement برای یک Idempotency-Key: خطای idempotency است.
- تغییر موجودی در reconciliation بدون repair: worker داده را تغییر داده است.

سبزشدن مرحله اول موجودی فیزیکی فروشگاه را ثابت نمی‌کند؛ فقط مسیرهای نرم‌افزاری
آزمایش‌شده را ارزیابی می‌کند.

## مرحله دوم: مشاهده فیزیکی

این مرحله فقط وقتی اجرا شود که مرحله اول سبز باشد ولی شکایت ادامه داشته باشد.
کاربر باید دسترسی inventory.manage داشته باشد.

ساخت جلسه:

    POST /api/inventory-verifications
    {
      "warehouseId": "WAREHOUSE_ID",
      "note": "بررسی هفت‌روزه اختلاف موجودی",
      "products": [
        {
          "productId": "PRODUCT_ID",
          "selectionReason": "شکایت تکراری",
          "precisionBase": 0.0001
        }
      ]
    }

حداکثر ۱۰۰ محصول در هر جلسه پذیرفته می‌شود.

برای هر checkpoint دو کاربر متفاوت باید cutoffAt و checkpointKey یکسان ثبت کنند:

    POST /api/inventory-verifications/SESSION_ID/counts
    {
      "productId": "PRODUCT_ID",
      "checkpointKey": "DAY-01-OPEN",
      "checkpointType": "OPENING",
      "cutoffAt": "2026-08-23T03:30:00.000Z",
      "quantityBase": 42,
      "note": "شمارش اول"
    }

برای بستن جلسه، همه محصولات باید دو شمارش OPENING و دو شمارش CLOSING تأییدشده
داشته باشند. cutoff آغاز همه محصولات و cutoff پایان همه محصولات باید مشترک باشد.

    POST /api/inventory-verifications/SESSION_ID/close

شواهد صفحه‌بندی‌شده:

    GET /api/inventory-verifications/SESSION_ID/evidence?page=1&limit=100

هر حرکت شامل سند، کاربر، operation ID، دستگاه، نسخه برنامه، channel و زمان است.

## طبقه‌بندی

- SYSTEM_LEDGER_MISMATCH: سیستم با شمارش آغاز و movementها برابر نیست.
- PHYSICAL_VARIANCE: سیستم و ledger برابرند، ولی شمارش فیزیکی فرق دارد.
- MATCHED: مدل مستقل، سیستم و شمارش فیزیکی برابرند.
- اختلاف دو شمارنده: جلسه بسته نمی‌شود و نتیجه نامشخص می‌ماند.

## معیار توقف

- مقصد غیر از _supermarket_test باشد.
- backup معتبر، checksum یا manifest کامل نباشد.
- migration یا preflight اجرا نشود.
- تست oracle، idempotency، worker یا postflight شکست بخورد.
- شمارش دو نفره توافق نداشته باشد.

در این حالت‌ها هیچ طرف مقصر اعلام نشود و ابتدا شواهد تکمیل گردد.

## اجرای تست بزرگ

این فرمان ۱۰۰۰ محصول و برای هر محصول ۵۰۰ عملیات، در مجموع ۵۰۰٬۰۰۰ عملیات،
را فقط روی clone ایمن اجرا می‌کند:

    powershell -ExecutionPolicy Bypass -File .\scripts\windows\run-inventory-forensics-large.ps1 -BackupFile "D:\BelalBackups\customer.dump" -UploadsPath "D:\BelalBackups\uploads" -Concurrency 10

برای اولویت‌دادن به محصولات مورد شکایت:

    -ComplaintProducts "PRODUCT_ID_1,BARCODE_2"

زمان پیش‌بینی‌شده حدود ۲ تا ۶ ساعت است. پنجره PowerShell را نبندید و در طول
اجرا فضای دیسک و سلامت `muhaseb_postgres_test` را کنترل کنید. خروجی preflight،
postflight و comparison مانند تست عادی در پوشه artifacts ذخیره می‌شود.
