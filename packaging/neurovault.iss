; Inno Setup 6 script for NeuroVault's installer. Built by packaging/build_exe.py --installer, which passes DistDir
; (the PyInstaller folder), RedistDir (MicrosoftEdgeWebview2Setup.exe), OutDir and Commit.
; Per-user install, no admin prompt: %LOCALAPPDATA%\Programs\NeuroVault. The notes stay in %LOCALAPPDATA%\NeuroVault
; (utils.frozen_data_dir), which an uninstall leaves alone.

#define MyAppName "NeuroVault"
; The version comes from version.py, passed in by build_exe.py
#ifndef MyAppVersion
  #define MyAppVersion "0.0.0"
#endif
#define MyAppExe "NeuroVault.exe"
; WebView2 Runtime's client id (Microsoft's documented registry check)
#define WebView2Key "Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"

#ifndef DistDir
  #error Run through packaging/build_exe.py --installer (DistDir is not set)
#endif
#ifndef Commit
  #define Commit "dev"
#endif

[Setup]
AppId={{6B0E3C41-8F2A-4D5B-9A47-2C1E7D9F4A60}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppVerName={#MyAppName} {#MyAppVersion}
AppPublisher={#MyAppName}
AppComments=Notes, tasks and focus for ADHD and dyslexia. Licensed under the GNU GPL, version 3 (build {#Commit}).
VersionInfoVersion={#MyAppVersion}
PrivilegesRequired=lowest
DefaultDirName={autopf}\{#MyAppName}
DisableProgramGroupPage=yes
DisableDirPage=auto
OutputDir={#OutDir}
OutputBaseFilename=NeuroVault-Setup-{#MyAppVersion}
SetupIconFile={#DistDir}\_internal\neurovault.ico
UninstallDisplayIcon={app}\{#MyAppExe}
UninstallDisplayName={#MyAppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "Put NeuroVault on the desktop"; Flags: unchecked

[Files]
Source: "{#DistDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "{#RedistDir}\MicrosoftEdgeWebview2Setup.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall; Check: NeedsWebView2

; QC 80 (the user: the taskbar icon follows my theme): the shortcuts carry no AppUserModelID. The app sets its own,
; NeuroVault.App (winframe.set_app_id); a shortcut with that same id makes Windows draw the running button from the
; shortcut's static icon instead of the window's live themed one. Pin from the running button: that pin carries the
; app's id, so it groups with the window (and shows the static cube while closed, which is fine).
; The shortcuts are made fresh on every install, so an older install's ones (with the id) don't stay behind.
[InstallDelete]
Type: files; Name: "{autoprograms}\{#MyAppName}.lnk"
Type: files; Name: "{autodesktop}\{#MyAppName}.lnk"

[Icons]
Name: "{autoprograms}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"
Name: "{autodesktop}\{#MyAppName}"; Filename: "{app}\{#MyAppExe}"; Tasks: desktopicon

[Run]
Filename: "{tmp}\MicrosoftEdgeWebview2Setup.exe"; Parameters: "/silent /install"; \
  StatusMsg: "Installing Microsoft WebView2, which shows NeuroVault's window (needs the internet)..."; \
  Check: NeedsWebView2; Flags: waituntilterminated
Filename: "{app}\{#MyAppExe}"; Description: "Open NeuroVault"; Flags: nowait postinstall skipifsilent

[Code]
function HasWebView2(Root: Integer; Key: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(Root, Key, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0');
end;

function NeedsWebView2: Boolean;
begin
  Result := not (HasWebView2(HKLM, 'SOFTWARE\WOW6432Node\{#WebView2Key}')
              or HasWebView2(HKLM, 'SOFTWARE\{#WebView2Key}')
              or HasWebView2(HKCU, 'Software\{#WebView2Key}'));
end;

procedure CurStepChanged(CurStep: TSetupStep);
begin
  if (CurStep = ssPostInstall) and NeedsWebView2 and not WizardSilent then
    MsgBox('Microsoft WebView2 could not be installed (is the internet on?). NeuroVault needs it to show its window.' + #13#10 +
           'Get the "Evergreen Bootstrapper" from microsoft.com/edge/webview2, then open NeuroVault.', mbInformation, MB_OK);
end;

procedure CurUninstallStepChanged(CurUninstallStep: TUninstallStep);
begin
  if (CurUninstallStep = usPostUninstall) and not UninstallSilent then
    MsgBox('NeuroVault is removed. Your notes and settings are kept in:' + #13#10 +
           ExpandConstant('{localappdata}\NeuroVault') + #13#10 +
           'Delete that folder too if you want them gone.', mbInformation, MB_OK);
end;
