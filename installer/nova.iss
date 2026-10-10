; ============================================================================
;  نوفا الجمال — Nova Al-Jamal : Windows installer (Inno Setup 6.3 or newer)
;  Build with installer\build-installer.bat (see installer\README-ar.md)
; ============================================================================
#define AppName       "Nova Al-Jamal"
#define AppNameAr     "نوفا الجمال"
#define AppVersion    "1.0.0"
#define AppPublisher  "Eng. Mohamed Jamal Eldin"
#define ServiceName   "NovaAlJamal"
#define AppPort       "5173"
#define DataRoot      "{commonappdata}\NovaAlJamal"
#define BrandIco      "{commonappdata}\NovaAlJamal\data\branding\app.ico"

#define ArabicIsl SourcePath + "Languages\Arabic.isl"

[Setup]
AppId={{B7D2C6E4-5A1F-4C77-9E0A-4F2D7A6B1C93}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppContact=jamalmohamed942@gmail.com
AppSupportPhone=+249965269898
DefaultDirName={autopf}\NovaAlJamal
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
MinVersion=10.0
#if Ver >= EncodeVer(6,3,0)
ArchitecturesInstallIn64BitMode=x64compatible
ArchitecturesAllowed=x64compatible
#else
ArchitecturesInstallIn64BitMode=x64
ArchitecturesAllowed=x64
#endif
OutputDir=output
OutputBaseFilename=NovaAlJamal-Setup-{#AppVersion}
SetupIconFile=assets\nova.ico
UninstallDisplayIcon={app}\nova.ico
UninstallDisplayName={#AppName} - {#AppNameAr}
WizardStyle=modern
WizardImageFile=assets\wizard-large.bmp
WizardSmallImageFile=assets\wizard-small.bmp
LicenseFile=EULA.txt
Compression=lzma2/ultra
SolidCompression=yes
CloseApplications=no
RestartApplications=no
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#AppPublisher}
VersionInfoDescription={#AppName} Setup
ShowLanguageDialog=auto

[Languages]
#if FileExists(ArabicIsl)
Name: "arabic"; MessagesFile: "{#ArabicIsl}"
#endif
Name: "english"; MessagesFile: "compiler:Default.isl"

[CustomMessages]
english.LaunchApp=Launch Nova Al-Jamal now
english.DesktopIcons=Create desktop shortcuts (application + license manager)
english.DeleteData=Do you also want to delete all system data (database, uploads, backups, license)?%n%nChoose No to keep your data for a future re-installation.
english.Installing=Installing the background service...
#if FileExists(ArabicIsl)
arabic.LaunchApp=تشغيل نوفا الجمال الآن
arabic.DesktopIcons=إنشاء اختصارات على سطح المكتب (التطبيق + إدارة الترخيص)
arabic.DeleteData=هل تريد أيضاً حذف كل بيانات النظام (قاعدة البيانات والصور والنسخ الاحتياطية والترخيص)؟%n%nاختر "لا" للاحتفاظ ببياناتك عند إعادة التثبيت لاحقاً.
arabic.Installing=جارٍ تثبيت خدمة النظام الخلفية...
#endif

[Tasks]
Name: "desktopicon"; Description: "{cm:DesktopIcons}"; GroupDescription: "{cm:AdditionalIcons}"

[Dirs]
Name: "{#DataRoot}"; Permissions: admins-full system-full
Name: "{#DataRoot}\data"; Permissions: admins-full system-full
Name: "{#DataRoot}\data\branding"; Permissions: admins-full system-full
Name: "{#DataRoot}\logs"; Permissions: admins-full system-full

[Files]
Source: "stage\node\*"; DestDir: "{app}\node"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\NovaService.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "stage\server\*"; DestDir: "{app}\server"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\public\*"; DestDir: "{app}\public"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "stage\package.json"; DestDir: "{app}"; Flags: ignoreversion
Source: "assets\nova.ico"; DestDir: "{app}"; Flags: ignoreversion
; default brand icon used by the shortcuts until the customer uploads their own logo (never overwritten on upgrade)
Source: "assets\nova.ico"; DestDir: "{#DataRoot}\data\branding"; DestName: "app.ico"; Flags: onlyifdoesntexist uninsneveruninstall

[Icons]
Name: "{commondesktop}\نوفا الجمال"; Filename: "{code:BrowserExe}"; Parameters: "{code:BrowserArgs|http://localhost:{#AppPort}/}"; IconFilename: "{#BrandIco}"; Comment: "نظام نوفا الجمال لإدارة الصالونات ومحلات التجميل"; Tasks: desktopicon
Name: "{commondesktop}\نوفا الجمال - إدارة الترخيص"; Filename: "{code:BrowserExe}"; Parameters: "{code:BrowserArgs|http://localhost:{#AppPort}/activate.html}"; IconFilename: "{#BrandIco}"; Comment: "إدارة ترخيص وتفعيل نظام نوفا الجمال"; Tasks: desktopicon
Name: "{group}\نوفا الجمال"; Filename: "{code:BrowserExe}"; Parameters: "{code:BrowserArgs|http://localhost:{#AppPort}/}"; IconFilename: "{#BrandIco}"
Name: "{group}\نوفا الجمال - إدارة الترخيص"; Filename: "{code:BrowserExe}"; Parameters: "{code:BrowserArgs|http://localhost:{#AppPort}/activate.html}"; IconFilename: "{#BrandIco}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
Filename: "{code:BrowserExe}"; Parameters: "{code:BrowserArgs|http://localhost:{#AppPort}/}"; Description: "{cm:LaunchApp}"; Flags: postinstall nowait skipifsilent

[Code]
function Sc(const Params: String): Integer;
var
  Rc: Integer;
begin
  if not Exec(ExpandConstant('{sys}\sc.exe'), Params, '', SW_HIDE, ewWaitUntilTerminated, Rc) then
    Rc := -1;
  Result := Rc;
end;

function BrowserExe(Param: String): String;
var
  Edge, Chrome: String;
begin
  Edge := ExpandConstant('{commonpf32}\Microsoft\Edge\Application\msedge.exe');
  Chrome := ExpandConstant('{commonpf}\Google\Chrome\Application\chrome.exe');
  if FileExists(Edge) then Result := Edge
  else if FileExists(Chrome) then Result := Chrome
  else Result := ExpandConstant('{win}\explorer.exe');
end;

function BrowserArgs(Param: String): String;
begin
  // Edge/Chrome app mode gives a clean window (no tabs) whose taskbar icon is the shop logo.
  if SameText(ExtractFileName(BrowserExe('')), 'explorer.exe') then Result := Param
  else Result := '--app=' + Param;
end;

function PrepareToInstall(var NeedsRestart: Boolean): String;
begin
  Sc('stop {#ServiceName}');
  Sleep(3000);
  Result := '';
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Bin: String;
begin
  if CurStep = ssPostInstall then
  begin
    WizardForm.StatusLabel.Caption := ExpandConstant('{cm:Installing}');
    Bin := '"' + ExpandConstant('{app}\NovaService.exe') + '"';
    if Sc('query {#ServiceName}') <> 0 then
      Sc('create {#ServiceName} binPath= ' + Bin + ' start= auto DisplayName= "Nova Al-Jamal Service"')
    else
      Sc('config {#ServiceName} binPath= ' + Bin + ' start= auto');
    Sc('description {#ServiceName} "Nova Al-Jamal salon management server"');
    Sc('failure {#ServiceName} reset= 86400 actions= restart/5000/restart/5000/restart/30000');
    Sc('start {#ServiceName}');
  end;
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if CurUninstallStep = usUninstall then
  begin
    Sc('stop {#ServiceName}');
    Sleep(2500);
    Sc('delete {#ServiceName}');
  end;
  if CurUninstallStep = usPostUninstall then
  begin
    if (not UninstallSilent) and (MsgBox(ExpandConstant('{cm:DeleteData}'), mbConfirmation, MB_YESNO or MB_DEFBUTTON2) = IDYES) then
      DelTree(ExpandConstant('{#DataRoot}'), True, True, True);
  end;
end;
