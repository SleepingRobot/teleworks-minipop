Teleworks MiniPop

Description:
Teleworks MiniPop is a screen pop application designed to lookup and display CRM API contact information that match incoming phone numbers.

Supported CRMs:
At this time Teleworks MiniPop has built-in support for Redtail CRM. Additional CRMs are not supported at this time.

Supported Platforms:
At this time Teleworks MiniPop is configured to run as a Windows portable exe. Additional platforms are not supported at this time.

Installation instructions:
1. Clone repository and then CD into it
2. npm install
3. npm run dist
4. Copy portable exe from repo's dist folder desired location

Usage instructions:
1. Configure phone system to pass incoming numbers to Teleworks MiniPop via CLI: <path_to_exe> --redtail-phone='<phone_number>'
2. Application can also be ran directly from CMD or PowerShell by manually running the above command.
3. On first number lookup, app will prompt for Redtail CRM credentials and then will complete lookup upon authentication.
4. Once authenticated, credentials will be cached in the Windows user's OS keychain for future lookups.
5. Click the history icon in upper-right corner to view past lookups.
6. Click the settings icon in upper-right corner to manually log out / log in to Redtail CRM, as well as to specify which display fields should be shown in the screen pop and call history windows.
7. Settings and call history data will be saved to encrypted file minipop.sec in the same directory as the portable exe. This file will only work for the active Windows user as it is encrypted with a unique key and iv stored in the active user's OS keychain. If the key or iv is lost from the active user's keychain, the old minipop.sec file will not be accessible and should be renamed or deleted so a new one can be generated on next lookup (will reset call history and require display fields be respecified in settings).
