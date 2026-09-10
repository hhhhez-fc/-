#define MyAppName "Label Print Helper"
#define MyAppVersion "0.1.0"
#define MyAppPublisher "Label Print Helper"
#define MyAppExeName "LabelPrintHelper.exe"

[Setup]
AppId={{1CB03C11-61F8-4682-80DD-546B747520A5}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
DefaultDirName={localappdata}\Programs\LabelPrintHelper
DefaultGroupName={#MyAppName}
PrivilegesRequired=lowest
OutputDir=..\..\artifacts
OutputBaseFilename=LabelPrintHelper-Setup
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
UninstallDisplayIcon={app}\{#MyAppExeName}
ChangesAssociations=yes

[Files]
Source: "..\src\LabelPrintHelper\bin\Release\net10.0-windows\win-x64\publish\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\卸载 {#MyAppName}"; Filename: "{uninstallexe}"

[Registry]
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; ValueType: string; ValueName: "LabelPrintHelper"; ValueData: """{app}\{#MyAppExeName}"""; Flags: uninsdeletevalue
Root: HKCU; Subkey: "Software\Classes\labelprint"; ValueType: string; ValueData: "URL:Label Print Helper Protocol"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\labelprint"; ValueType: string; ValueName: "URL Protocol"; ValueData: ""; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\labelprint\DefaultIcon"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"",0"; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\labelprint\shell\open\command"; ValueType: string; ValueData: """{app}\{#MyAppExeName}"" ""%1"""; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "启动 {#MyAppName}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
Type: filesandordirs; Name: "{localappdata}\LabelPrintHelper\jobs"
Type: dirifempty; Name: "{localappdata}\LabelPrintHelper"

[Code]
procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
var
  ShutdownStarted: Boolean;
  ShutdownCode: Integer;
  MaintenanceStarted: Boolean;
  CleanupCode: Integer;
begin
  if CurUninstallStep <> usUninstall then
    Exit;

  ShutdownStarted := Exec(
    ExpandConstant('{app}\{#MyAppExeName}'),
    '--shutdown', '', SW_HIDE, ewWaitUntilTerminated, ShutdownCode);
  if (not ShutdownStarted) or (ShutdownCode <> 0) then
  begin
    MsgBox('无法安全停止当前用户的 Label Print Helper（退出码 ' + IntToStr(ShutdownCode) + '）。卸载已取消，请关闭助手后重试。', mbError, MB_OK);
    RaiseException('无法安全停止 Label Print Helper，程序文件未删除。');
  end;

  MaintenanceStarted := Exec(
    ExpandConstant('{app}\{#MyAppExeName}'),
    '--maintenance-cleanup', '', SW_HIDE, ewWaitUntilTerminated, CleanupCode);
  if (not MaintenanceStarted) or (CleanupCode <> 0) then
  begin
    MsgBox('Label Print Helper 产品范围清理失败（退出码 ' + IntToStr(CleanupCode) + '）。卸载已取消，未删除程序文件。', mbError, MB_OK);
    RaiseException('Label Print Helper 产品范围清理失败，程序文件未删除。');
  end;
end;
